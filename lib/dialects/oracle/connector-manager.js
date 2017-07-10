var oracle
  , Pooling = require('generic-pool')
  , Query   = require("./query")
  , Utils   = require("../../utils")
  , without = function(arr, elem) { return arr.filter(function(e) { return e != elem }) }

module.exports = (function() {
  var ConnectorManager = function(sequelize, config) {
    try {
      if (config.dialectModulePath) {
        oracle = require(config.dialectModulePath)
      } else {
        oracle = require('oracledb')
      }
    } catch (err) {
      console.log('You need to install oracle package manually')
    }

    sequelize.connectionManager=this;

    this.lib=oracle;
    this.sequelize = sequelize
    this.client = null
    this.config = config || {}
    this.config.port = this.config.port || 1521
    this.disconnectTimeoutId = null
    this.queue = []
    this.activeQueue = []
    this.maxConcurrentQueries = (this.config.maxConcurrentQueries || 50)
    this.poolCfg = Utils._.defaults(this.config.pool, {
      maxConnections: 10,
      minConnections: 0,
      maxIdleTime: 1000,
      handleDisconnects: false,
      validate: validateConnection
    });
    this.pendingQueries = 0;
    this.useReplicaton = false; //!!config.replication; This File is duplicate to Mysql. For Oracle, we don't support replication
    this.useQueue = config.queue !== undefined ? config.queue : true;

    var self = this

    if (this.useReplicaton) {
      var reads = 0
        , writes = 0;

      // Init configs with options from config if not present
      for (var i in config.replication.read) {
        config.replication.read[i] = Utils._.defaults(config.replication.read[i], {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          password: this.config.password,
          database: this.config.database
        });
      }
      config.replication.write = Utils._.defaults(config.replication.write, {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        database: this.config.database
      });

      // I'll make my own pool, with blackjack and hookers!
      this.pool = {
        release: function (client) {
          if (client.queryType == 'read') {
            return this.read.release(client);
          } else {
            return this.write.release(client);
          }
        },
        acquire: function (callback, priority, queryType) {
          if (queryType == 'SELECT') {
            this.read.acquire(callback, priority);
          } else {
            this.write.acquire(callback, priority);
          }
        },
        drain: function () {
          this.read.drain();
          this.write.drain();
        },
        read: Pooling.Pool({
          name: 'sequelize-read',
          create: function (done) {
            if (reads >= self.config.replication.read.length) {
              reads = 0
            }
            var config = self.config.replication.read[reads++];

            connect.call(self, function (err, connection) {
              if (connection) {
                connection.queryType = 'read'
              }

              done(err, connection)
            }, config);
          },
          destroy: function(client) {
            disconnect.call(self, client)
          },
          validate: self.poolCfg.validate,
          max: self.poolCfg.maxConnections,
          min: self.poolCfg.minConnections,
          idleTimeoutMillis: self.poolCfg.maxIdleTime
        }),
        write: Pooling.Pool({
          name: 'sequelize-write',
          create: function (done) {
            connect.call(self, function (err, connection) {
              if (connection) {
                connection.queryType = 'write'
              }

              done(err, connection)
            }, self.config.replication.write);
          },
          destroy: function(client) {
            disconnect.call(self, client)
          },
          validate: self.poolCfg.validate,
          max: self.poolCfg.maxConnections,
          min: self.poolCfg.minConnections,
          idleTimeoutMillis: self.poolCfg.maxIdleTime
        })
      };
    } else if (this.poolCfg) {
      //the user has requested pooling, so create our connection pool
      this.pool = Pooling.Pool({
        name: 'sequelize-oracle',
        create: function (done) {
          connect.call(self, function (err, connection) {
            // This has to be nested for some reason, else the error won't propagate correctly
            done(err, connection);
          })
        },
        destroy: function(client) {
          disconnect.call(self, client)
        },
        max: self.poolCfg.maxConnections,
        min: self.poolCfg.minConnections,
        validate: self.poolCfg.validate,
        idleTimeoutMillis: self.poolCfg.maxIdleTime
      })
    }

    this.onProcessExit = function () {
      //be nice & close our connections on exit
      if (self.pool) {
        self.pool.drain()
      } else if (self.client) {
        disconnect(self.client)
      }

      return
    }.bind(this);

    process.on('exit', this.onProcessExit)
  }

  Utils._.extend(ConnectorManager.prototype, require("../connector-manager").prototype);

  ConnectorManager.prototype.query = function(sql, callee, options) {
    if (this.useQueue) {
      // If queueing we'll let the execQueueItem method handle connecting
      var queueItem = {
        query: new Query(null, this.sequelize, callee, options || {}),
        sql: sql
      };

      queueItem.query.options.uuid = this.config.uuid
      enqueue.call(this, queueItem, options);
      return queueItem.query;
    }

    var self = this, query = new Query(null, this.sequelize, callee, options || {});
    this.pendingQueries++;

    query.options.uuid = this.config.uuid
    query.done(function() {
      self.pendingQueries--;
      if (self.pool) {
        self.pool.release(query.client);
      } else {
        if (self.pendingQueries === 0) {
          setTimeout(function() {
            if (self.pendingQueries === 0){
              self.disconnect.call(self);
            }
          }, 100);
        }
      }
    });

    this.getConnection(options, function (err, client) {
      if (err) {
        return query.emit('error', err)
      }
      query.client = client
      query.run(sql)
    });

    return query;
  };

  ConnectorManager.prototype.getConnection = function(options, callback) {
    var self = this;

    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    return new Utils.CustomEventEmitter(function (emitter) {
      if (!self.pool) {
        // Regular client caching
        if (self.client) {
          return emitter.emit('success', self.client);
        } else {
          // Cache for concurrent queries
          if (self._getConnection) {
            self._getConnection.proxy(emitter);
            return;
          }

          // Set cache and acquire connection
          self._getConnection = emitter;
          connect.call(self, function(err, client) {
            if (err) {
              return emitter.emit('error', err);
            }

            // Unset caching, should now be caught by the self.client check
            self._getConnection = null;
            self.client = client;
            emitter.emit('success', client);
          });
        }
      }
      if (self.pool) {
        // Acquire from pool
        self.pool.acquire(function(err, client) {
          if (err) {
            return emitter.emit('error', err);
          }
          emitter.emit('success', client);
        }, options.priority, options.type);
      }
    }).run().done(callback);
  };

  ConnectorManager.prototype.disconnect = function() {
    if (this.client) {
      disconnect.call(this, this.client)
    }
    return
  };


  // private

  var disconnect = function(client) {
    var self = this;
    this.client = null;

    // client.end(function() {
      if (!self.useQueue) {
        var c=function(err){
          if (err) {
            console.error(err.message);
            return;
          }
        }
        return client.close ? client.close(c) : (client.release ?  client.release(c) : null);
      }

      var intervalObj = null
      var cleanup = function () {
        var retryCt = 0
        // make sure to let client finish before calling destroy
        if (client._queue && (client._queue.length > 0)) {
          return
        }
        // needed to prevent oracle connection leak
        var c=function(err){
          if (err) {
            console.error(err.message);
            return;
          }
        }
        client.close && client.close(c)|| client.release && client.release(c);
        clearInterval(intervalObj)
      }
      intervalObj = setInterval(cleanup, 10)
      cleanup()
      return
    // })
  }

  var connect = function(done, config) {
    var self=this;
    config = config || this.config

    var emitter = new (require('events').EventEmitter)()

  var connectionConfig = {
      user: config.username,
      password: config.password
      // timezone: 'Z'
    };


    // if(config.database && config.database.indexOf('DESCRIPTION=')>=0){
    //   connectionConfig.tns=config.database;
    // }else{
    //   connectionConfig.database=config.database;
    //   connectionConfig.port=config.port;
    //   connectionConfig.host=config.host;
    // }

    if(config.database && config.database.indexOf('DESCRIPTION=')>=0){
      connectionConfig.connectString=config.database;
    }else{
      connectionConfig.connectString='//'+config.host+':'+config.port+'/'+config.database;
    }


    if (config.dialectOptions) {
      Object.keys(config.dialectOptions).forEach(function (key) {
        connectionConfig[key] = config.dialectOptions[key];
      });
    }

    emitter.on('error', function (err) {
      done(err);
    });
    emitter.on('success', function (connection) {
      done(null, connection);
    });

    oracle.getConnection(connectionConfig, function(err, connection){
      // .connect(connectionConfig,function(err, connection) {
      if (err) {
        switch(err.code) {
        case 'ECONNREFUSED':
        case 'ER_ACCESS_D2ENIED_ERROR':
          emitter.emit('error', 'Failed to authenticate for ORACLE. Please double check your settings.')
          break
        case 'ENOTFOUND':
        case 'EHOSTUNREACH':
        case 'EINVAL':
          emitter.emit('error', 'Failed to find ORACLE server. Please double check your settings.')
          break
        default:
          emitter.emit('error', err);
          break;
        }

        return;
      }

      emitter.emit('success', connection);

      // connection.query("SET time_zone = '+0:00'");
      // connection.setMaxListeners(self.maxConcurrentQueries)
      self.isConnecting = false
      if (config.pool !== null && config.pool.handleDisconnects) {
        handleDisconnect(self.pool, connection)
      }
    })
  }

  var handleDisconnect = function(pool, client) {
    client.on('error', function(err) {
      if (err.code !== 'PROTOCOL_CONNECTION_LOST') {
        throw err
      }
      pool.destroy(client)
    })
  }

  var validateConnection = function(client) {
    return client && client.state !== 'disconnected'
  }

  var enqueue = function(queueItem, options) {
    options = options || {}
    if (this.activeQueue.length < this.maxConcurrentQueries) {
      this.activeQueue.push(queueItem)
      execQueueItem.call(this, queueItem)
    } else {
      this.queue.push(queueItem)
    }
  }

  var dequeue = function(queueItem) {
    //return the item's connection to the pool
    if (this.pool) {
      this.pool.release(queueItem.client)
    }
    this.activeQueue = without(this.activeQueue, queueItem)
  }

  var transferQueuedItems = function(count) {
    for(var i = 0; i < count; i++) {
      var queueItem = this.queue.shift();
      if (queueItem) {
        enqueue.call(this, queueItem)
      }
    }
  }

  var afterQuery = function(queueItem) {
    dequeue.call(this, queueItem)
    transferQueuedItems.call(this, this.maxConcurrentQueries - this.activeQueue.length)
    disconnectIfNoConnections.call(this)
  }


  var execQueueItem = function(queueItem) {
    var self = this

    self.getConnection({
      priority: queueItem.query.options.priority,
      type: queueItem.query.options.type
    }, function (err, connection) {
      if (err) {
        queueItem.query.emit('error', err)
        return
      }

      queueItem.query.client = connection
      queueItem.client = connection
      queueItem.query
        .success(function(){ afterQuery.call(self, queueItem) })
        .error(function(){ afterQuery.call(self, queueItem) })

      queueItem.query.run(queueItem.sql, queueItem.client)
    })
  }

  ConnectorManager.prototype.__defineGetter__('hasQueuedItems', function() {
    return (this.queue.length > 0) || (this.activeQueue.length > 0) || (this.client && this.client._queue && (this.client._queue.length > 0))
  })

  // legacy
  ConnectorManager.prototype.__defineGetter__('hasNoConnections', function() {
    return !this.hasQueuedItems
  })

  ConnectorManager.prototype.__defineGetter__('isConnected', function() {
    return this.client != null
  })

  var disconnectIfNoConnections = function() {
    var self = this

    this.disconnectTimeoutId && clearTimeout(this.disconnectTimeoutId)
    this.disconnectTimeoutId = setTimeout(function() {
      self.isConnected && !self.hasQueuedItems && self.disconnect()
    }, 100)
  }

  return ConnectorManager
})()
