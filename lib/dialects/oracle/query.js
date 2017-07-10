var Utils         = require("../../utils")
  , AbstractQuery = require('../abstract/query')

module.exports = (function() {
  var Query = function(client, sequelize, callee, options) {
    this.client    = client
    this.callee    = callee
    this.sequelize = sequelize
    this.options   = Utils._.extend({
      logging: console.log,
      plain: false,
      raw: false
    }, options || {})


    this.maxRows= options.maxRows || 100;
    this.outFormat= options.outFormat || this.sequelize.connectionManager.lib.OBJECT;
    this.autoCommit= (options.autoCommit===false? false : true);

    this.checkLoggingOption()
  }

  Utils.inherit(Query, AbstractQuery)
  Query.prototype.run = function(sql) {
    // this.sql = sql.replace(/; *$/,'');
    if(sql.match(/^(SELECT|INSERT|DELETE)/)){
      this.sql = sql.replace(/; *$/,'');
    }else{
      this.sql = sql;
    }

    if (this.options.logging !== false) {
      this.options.logging('Executing (' + this.options.uuid + '): ' + this.sql)
    }

    this.client.execute(this.sql, [], { maxRows:this.maxRows, outFormat: this.outFormat, autoCommit : this.autoCommit }, function(err, results, fields) {
      this.emit('sql', this.sql)

      if (err) {
        err.sql = sql
        this.emit('error', err, this.callee)
      } else {
        var rslt;
        if(results && results.rows){
          rslt=[];
          results.rows.forEach(function(_result) {
            var obj={};
            results.metaData.forEach(function(col,i) {
              obj[col.name]=_result[col.name];
            });
            rslt.push(obj);
          });
        }else{
          rslt=results;
        }
        this.emit('success', this.formatResults(rslt))
      }
    }.bind(this))//.setMaxListeners(100)
    return this
  }

  return Query
})()


