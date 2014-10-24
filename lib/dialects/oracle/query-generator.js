var Utils     = require("../../utils")
  , DataTypes = require("../../data-types")
  , util      = require("util")

module.exports = (function() {
  var QueryGenerator = {
    dialect: 'oracle',
    
    addSchema: function(opts) {
      var tableName
      var schema        = (!!opts && !!opts.options && !!opts.options.schema ? opts.options.schema : undefined)
      var schemaDelimiter  = (!!opts && !!opts.options && !!opts.options.schemaDelimiter ? opts.options.schemaDelimiter : undefined)

      if (!!opts && !!opts.tableName) {
        tableName = opts.tableName
      }
      else if (typeof opts === "string") {
        tableName = opts
      }

      if (!schema || schema.toString().trim() === "") {
        return tableName
      }

      return this.quoteIdentifier(schema + (!schemaDelimiter ? '.' : schemaDelimiter) + tableName, false)
    },

    createSchema: function(schema) {
      var query = "CREATE SCHEMA AUTHORIZATION <%= schema%>"
      return Utils._.template(query)({schema: schema})
    },

    dropSchema: function(schema) {
      var query = "DROP SCHEMA SAMP <%= schema%> RESTRICT"
      return Utils._.template(query)({schema: schema})
    },

    showSchemasQuery: function() {
      return "SELECT owner, table_name FROM all_tables"
    },

    createTableQuery: function(tableName, attributes, options) {
      options = Utils._.extend({
        engine: 'InnoDB',
        charset: null
      }, options || {})

      var query   = "CREATE TABLE IF NOT EXISTS <%= table %> (<%= attributes%>)<%= comment %> ENGINE=<%= engine %> <%= charset %> <%= collation %>"
        , primaryKeys = []
        , foreignKeys = {}
        , attrStr = []

      for (var attr in attributes) {
        if (attributes.hasOwnProperty(attr)) {
          var dataType = this.mysqlDataTypeMapping(tableName, attr, attributes[attr])

          if (Utils._.includes(dataType, 'PRIMARY KEY')) {
            primaryKeys.push(attr)
            dataType = dataType.replace(/PRIMARY KEY/, '');
          }

          if (Utils._.includes(dataType, 'REFERENCES')) {
            // MySQL doesn't support inline REFERENCES declarations: move to the end
            var m = dataType.match(/^(.+) (REFERENCES.*)$/)
            dataType = m[1];
            foreignKeys[attr] = m[2]
          }

          attrStr.push(this.quoteIdentifier(attr) + " " + dataType)
        }
      }

      var values = {
        table: this.quoteIdentifier(tableName),
        attributes: attrStr.join(", "),
        comment: options.comment && Utils._.isString(options.comment) ? " COMMENT " + this.escape(options.comment) : "",
        engine: options.engine,
        charset: (options.charset ? "DEFAULT CHARSET=" + options.charset : ""),
        collation: (options.collate ? "COLLATE " + options.collate : "")
      }
      , pkString = primaryKeys.map(function(pk) { return this.quoteIdentifier(pk) }.bind(this)).join(", ")

      if (!!options.uniqueKeys) {
        Utils._.each(options.uniqueKeys, function(columns) {
          values.attributes += ", UNIQUE uniq_" + tableName + '_' + columns.fields.join('_') + " (" + columns.fields.join(', ') + ")"
        })
      }

      if (pkString.length > 0) {
        values.attributes += ", PRIMARY KEY (" + pkString + ")"
      }

      for (var fkey in foreignKeys) {
        if(foreignKeys.hasOwnProperty(fkey)) {
          values.attributes += ", FOREIGN KEY (" + this.quoteIdentifier(fkey) + ") " + foreignKeys[fkey]
        }
      }

      return Utils._.template(query)(values).trim() + ";"
    },

    dropTableQuery: function(tableName, options) {
      throwMethodUndefined('dropTableQuery')
    },

    showTablesQuery: function() {
      return 'SELECT table_name FROM user_tables'
    },

    uniqueConstraintMapping: {
      code: 'ORA-00001',
      map: function(str) {
        // we're manually remvoving uniq_ here for a future capability of defining column names explicitly
        var match = str.replace('uniq_', '').match(/unique constraint '(.*?)' violated$/)
        if (match === null || match.length < 2) {
          return false
        }

        return match[1].split('_')
      }
    },

    addColumnQuery: function(tableName, attributes) {
      throwMethodUndefined('addColumnQuery')
    },

    removeColumnQuery: function(tableName, attributeName) {
      throwMethodUndefined('removeColumnQuery')
    },

    changeColumnQuery: function(tableName, attributes) {
      throwMethodUndefined('changeColumnQuery')
    },

    renameColumnQuery: function(tableName, attrBefore, attributes) {
      throwMethodUndefined('renameColumnQuery')
    },

    bulkInsertQuery: function(tableName, attrValueHashes, options) {
      var query = "INSERT<%= ignoreDuplicates %> INTO <%= table %> (<%= attributes %>) VALUES <%= tuples %>;"
        , tuples = []
        , allAttributes = []

      Utils._.forEach(attrValueHashes, function(attrValueHash, i) {
        Utils._.forOwn(attrValueHash, function(value, key, hash) {
          if (allAttributes.indexOf(key) === -1) allAttributes.push(key)
        })
      })

      Utils._.forEach(attrValueHashes, function(attrValueHash, i) {
        tuples.push("(" +
          allAttributes.map(function (key) {
            return this.escape(attrValueHash[key])
          }.bind(this)).join(",") +
        ")")
      }.bind(this))

      var replacements  = {
        ignoreDuplicates: options && options.ignoreDuplicates ? ' IGNORE' : '',
        table: this.quoteIdentifier(tableName),
        attributes: allAttributes.map(function(attr){
                      return this.quoteIdentifier(attr)
                    }.bind(this)).join(","),
        tuples: tuples
      }

      return Utils._.template(query)(replacements)
    },

    deleteQuery: function(tableName, where, options) {
      options = options || {}

      var table = this.quoteIdentifier(tableName)
      if (options.truncate === true) {
        // Truncate does not allow LIMIT and WHERE
        return "TRUNCATE " + table
      }

      where = this.getWhereConditions(where)
      var limit = ""

      if(Utils._.isUndefined(options.limit)) {
        options.limit = 1;
      }

      if(!!options.limit) {
        limit = " AND ROWNUM <= " + this.escape(options.limit)
      }

      return "DELETE FROM " + table + " WHERE " + where + limit
    },

    bulkDeleteQuery: function(tableName, where, options) {
      options = options || {}

      var table = this.quoteIdentifier(tableName)
      where = this.getWhereConditions(where)

      var query = "DELETE FROM " + table + " WHERE " + where

      return query
    },

    addIndexQuery: function(tableName, attributes, options) {
      throwMethodUndefined('addIndexQuery')
    },

    showIndexQuery: function(tableName, options) {
      throwMethodUndefined('showIndexQuery')
    },

    removeIndexQuery: function(tableName, indexNameOrAttributes) {
      throwMethodUndefined('removeIndexQuery')
    },
    
    attributesToSQL: function(attributes) {
      var result = {}

      for (var name in attributes) {
        var dataType = attributes[name]

        if (Utils.isHash(dataType)) {
          var template

          if (dataType.type.toString() === DataTypes.ENUM.toString()) {
            if (Array.isArray(dataType.values) && (dataType.values.length > 0)) {
              template = "ENUM(" + Utils._.map(dataType.values, function(value) {
                return this.escape(value)
              }.bind(this)).join(", ") + ")"
            } else {
              throw new Error('Values for ENUM haven\'t been defined.')
            }
          } else {
            template = dataType.type.toString();
          }

          if (dataType.type === "STRING") {
            dataType.originalType = "STRING"
            dataType.type = 'VARCHAR2'
          }

          if (dataType.type === "TEXT") {
            dataType.originalType = "TEXT"
            dataType.type = 'CLOB'
          }

          if (dataType.type === "BIGINT") {
            dataType.originalType = "BIGINT"
            dataType.type = 'NUMBER'
          }

          if (dataType.hasOwnProperty('allowNull') && (!dataType.allowNull)) {
            template += " NOT NULL"
          }

          if (dataType.autoIncrement) {
            template += " auto_increment"
          }

          // Blobs/texts cannot have a defaultValue
          if (dataType.type !== "TEXT" && dataType.type._binary !== true && Utils.defaultValueSchemable(dataType.defaultValue)) {
            template += " DEFAULT " + this.escape(dataType.defaultValue)
          }

          if (dataType.unique === true) {
            template += " UNIQUE"
          }

          if (dataType.primaryKey) {
            template += " PRIMARY KEY"
          }

          if(dataType.references) {
            template += " REFERENCES " + this.quoteIdentifier(dataType.references)

            if(dataType.referencesKey) {
              template += " (" + this.quoteIdentifier(dataType.referencesKey) + ")"
            } else {
              template += " (" + this.quoteIdentifier('id') + ")"
            }

            if(dataType.onDelete) {
              template += " ON DELETE " + dataType.onDelete.toUpperCase()
            }

            if(dataType.onUpdate) {
              template += " ON UPDATE " + dataType.onUpdate.toUpperCase()
            }

          }

          if (dataType.comment && Utils._.isString(dataType.comment) && dataType.comment.length) {
            template += " COMMENT " + this.escape(dataType.comment)
          }

          result[name] = template
        } else {
          result[name] = dataType
        }
      }

      return result
    },

    findAutoIncrementField: function(factory) {
      var fields = []

      // for (var name in factory.attributes) {
      //   if (factory.attributes.hasOwnProperty(name)) {
      //     var definition = factory.attributes[name]

      //     if (definition && (definition.indexOf('auto_increment') > -1)) {
      //       fields.push(name)
      //     }
      //   }
      // }

      return fields
    },

    addLimitAndOffset: function(options, query){
      query = query || ""
      if (!options.offset && options.limit) {
        query = " SELECT * FROM (" + query + ") WHERE ROWNUM <=" + options.limit
      }

      if (options.offset && !options.limit) {
        query = " SELECT * FROM (" + query + ") WHERE ROWNUM >" + options.offset
      }
      if (options.offset && options.limit) {
        query = " SELECT * FROM (" + query + ") WHERE ROWNUM BETWEEN" + (parseInt(options.offset,10) + 1) + " AND " +  (parseInt(options.offset,10) + parseInt(options.limit,10));
      }
      return query;
    },

    quoteIdentifier: function(identifier, force) {
      //identifier=identifier.replace(/\./g,'_');
      // identifier=identifier.replace(/ AS /g,' ');
      if (identifier === '*') return identifier
      if(!force && this.options && this.options.quoteIdentifiers === false) { // default is `true`
        // In Oracle, if tables or attributes are created double-quoted,
        // they are also case sensitive. If they contain any lowercase
        // characters, they must always be double-quoted. This makes it
        // impossible to write queries in portable SQL if tables are created in
        // this way. Hence, we strip quotes if we don't want case sensitivity.
        return Utils.removeTicks(identifier, '"')
      } else {
        return Utils.addTicks(identifier, '"')
      }
    },

    quoteIdentifiers: function(identifiers, force) {
      return identifiers.split('.').map(function(v) { return this.quoteIdentifier(v, force) }.bind(this)).join('.')
    },

    quoteTable: function(table) {
      return this.quoteIdentifier(table)
    },

    /**
     * Generates an SQL query that returns all foreign keys of a table.
     *
     * @param  {String} tableName  The name of the table.
     * @param  {String} schemaName The name of the schema.
     * @return {String}            The generated sql query.
     */
    getForeignKeysQuery: function(tableName, schemaName) {
      throwMethodUndefined('getForeignKeysQuery')
    },

    /**
     * Generates an SQL query that removes a foreign key from a table.
     *
     * @param  {String} tableName  The name of the table.
     * @param  {String} foreignKey The name of the foreign key constraint.
     * @return {String}            The generated sql query.
     */
    dropForeignKeyQuery: function(tableName, foreignKey) {
      throwMethodUndefined('dropForeignKeyQuery')
    },

    selectQuery: function(tableName, options, factory) {
      // Enter and change at your own peril -- Mick Hansen

      options = options || {}

      var table               = null
        , self                = this
        , query
        , limit               = options.limit
        , mainQueryItems      = []
        , mainAttributes      = options.attributes
        , mainJoinQueries     = []
        // We'll use a subquery if we have hasMany associations and a limit and a filtered/required association
        , subQuery            = limit && (options.hasIncludeWhere || options.hasIncludeRequired || options.hasMultiAssociation)
        , subQueryItems       = []
        , subQueryAs          = []
        , subQueryAttributes  = null
        , subJoinQueries      = []

      // Escape table
      options.table = table = !Array.isArray(tableName) ? this.quoteIdentifiers(tableName) : tableName.map(function(t) {
        return this.quoteIdentifiers(t)
      }.bind(this)).join(", ")

      if (subQuery && mainAttributes) {
        if (factory.hasPrimaryKeys) {
          factory.primaryKeyAttributes.forEach(function(keyAtt){
            if(mainAttributes.indexOf(keyAtt) == -1){
              mainAttributes.push(keyAtt)
            }
          })
        } else {
          mainAttributes.push("id")
        }          
      }

      // Escape attributes
      mainAttributes = mainAttributes && mainAttributes.map(function(attr){
        var addTable = true

        if (attr instanceof Utils.literal) {
          return attr.toString(this)
        }

        if (attr instanceof Utils.fn || attr instanceof Utils.col) {
          return attr.toString(self)
        }

        if(Array.isArray(attr) && attr.length == 2) {
          if (attr[0] instanceof Utils.fn || attr[0] instanceof Utils.col) {
            attr[0] = attr[0].toString(self)
            addTable = false
          }
          attr = [attr[0], this.quoteIdentifier(attr[1])].join(' as ')
        } else {
          attr = attr.indexOf(Utils.TICK_CHAR) < 0 && attr.indexOf('"') < 0 ? this.quoteIdentifiers(attr) : attr
        }

        if (options.include && attr.indexOf('.') === -1 && addTable) {
          attr = this.quoteIdentifier(options.table) + '.' + attr
        }

        return attr
      }.bind(this))

      // If no attributes specified, use *
      mainAttributes = mainAttributes || (options.include ? [options.table+'.*'] : ['*'])

      // If subquery, we ad the mainAttributes to the subQuery and set the mainAttributes to select * from subquery
      if (subQuery) {
        // We need primary keys
        subQueryAttributes = mainAttributes
        !Array.isArray(tableName) ? subQueryAs.push(tableName) : subQueryAs.concat(tableName)
        mainAttributes = [options.table+'.*']
      }

      if (options.include) {
        var generateJoinQueries = function(include, parentTable) {
          var table         = include.daoFactory.tableName
            , as            = include.as
            , joinQueryItem = ""
            , joinQueries = {
              mainQuery: [],
              subQuery: []
            }
            , attributes
            , association   = include.association
            , through       = include.through
            , joinType      = include.required ? ' INNER JOIN ' : ' LEFT OUTER JOIN '
            , includeWhere  = {}
            , whereOptions  = Utils._.clone(options)

          whereOptions.keysEscaped = true

          if (tableName !== parentTable) {
            as = parentTable+'.'+include.as
          }
          
          if (include.subQuery && subQuery){
            subQueryAs.push(as);
          }

          // includeIgnoreAttributes is used by aggregate functions
          if (options.includeIgnoreAttributes !== false) {
            attributes  = include.attributes.map(function(attr) {
              return self.quoteIdentifier(as) + "." + self.quoteIdentifier(attr) + " " + self.quoteIdentifier(as + "_" + attr)
            })

            if (include.subQuery && subQuery) {
              subQueryAttributes = subQueryAttributes.concat(attributes)
            } else {
              mainAttributes = mainAttributes.concat(attributes)
            }
          }

          if (through) {
            var throughTable      = through.daoFactory.tableName
              , throughAs         = as + "." + through.as
              , throughAttributes = through.attributes.map(function(attr) {
                return self.quoteIdentifier(throughAs) + "." + self.quoteIdentifier(attr) + " " + self.quoteIdentifier(throughAs + "_" + attr)
              })
              , primaryKeysSource = Object.keys(association.source.primaryKeys)
              , tableSource       = parentTable
              , identSource       = association.identifier
              , attrSource        = ((!association.source.hasPrimaryKeys || primaryKeysSource.length !== 1) ? 'id' : primaryKeysSource[0])
              , where

              , primaryKeysTarget = Object.keys(association.target.primaryKeys)
              , tableTarget       = as
              , identTarget       = association.foreignIdentifier
              , attrTarget        = ((!include.association.target.hasPrimaryKeys || primaryKeysTarget.length !== 1) ? 'id' : primaryKeysTarget[0])

              , sourceJoinOn
              , targetJoinOn
              , targetWhere

            if (options.includeIgnoreAttributes !== false) {
              // Through includes are always hasMany, so we need to add the attributes to the mainAttributes no matter what (Real join will never be executed in subquery)
              mainAttributes = mainAttributes.concat(throughAttributes)
            }

            // Filter statement for left side of through
            // Used by both join and subquery where
            sourceJoinOn = self.quoteIdentifier(tableSource) + "." + self.quoteIdentifier(attrSource) + " = "
              sourceJoinOn += self.quoteIdentifier(throughAs) + "." + self.quoteIdentifier(identSource)

            // Filter statement for right side of through
            // Used by both join and subquery where
            targetJoinOn = self.quoteIdentifier(tableTarget) + "." + self.quoteIdentifier(attrTarget) + " = "
              targetJoinOn += self.quoteIdentifier(throughAs) + "." + self.quoteIdentifier(identTarget)

            // Generate join SQL for left side of through
            joinQueryItem += joinType + self.quoteIdentifier(throughTable) + " " + self.quoteIdentifier(throughAs) + " ON "
              joinQueryItem += sourceJoinOn

            // Generate join SQL for right side of through
            joinQueryItem += joinType + self.quoteIdentifier(table) + " " + self.quoteIdentifier(as) + " ON "
              joinQueryItem += targetJoinOn


            if (include.where) {
              targetWhere = self.getWhereConditions(include.where, self.sequelize.literal(self.quoteIdentifier(as)), include.daoFactory, whereOptions)
              joinQueryItem += " AND "+ targetWhere
              if (subQuery) {
                if (!options.where) options.where = {}

                // Creating the as-is where for the subQuery, checks that the required association exists
                var _where = "(";
                  _where += "SELECT "+self.quoteIdentifier(identSource)+" FROM " + self.quoteIdentifier(throughTable) + " " + self.quoteIdentifier(throughAs);
                  _where += joinType + self.quoteIdentifier(table) + " " + self.quoteIdentifier(as) + " ON "+targetJoinOn;
                  _where += " WHERE " + sourceJoinOn + " AND " + targetWhere + " AND ROWNUM = 1"
                _where += ")";
                _where += " IS NOT NULL"

                options.where["__"+throughAs] = self.sequelize.asIs(_where)
              }
            }
          } else {
            var primaryKeysLeft = ((association.associationType === 'BelongsTo') ? Object.keys(association.target.primaryKeys) : Object.keys(include.association.source.primaryKeys))
              , tableLeft       = ((association.associationType === 'BelongsTo') ? as : parentTable)
              , attrLeft        = ((primaryKeysLeft.length !== 1) ? 'id' : primaryKeysLeft[0])
              , tableRight      = ((association.associationType === 'BelongsTo') ? parentTable : as)
              , attrRight       = association.identifier
              , where

            // Filter statement
            // Used by both join and subquery where

            if (subQuery && !include.subQuery && include.parent.subQuery) {
              where = self.quoteIdentifier(tableLeft + "." + attrLeft) + " = "
            } else {
              where = self.quoteIdentifier(tableLeft) + "." + self.quoteIdentifier(attrLeft) + " = "
            }
            where += self.quoteIdentifier(tableRight) + "." + self.quoteIdentifier(attrRight)

            // Generate join SQL
            joinQueryItem += joinType + self.quoteIdentifier(table) + " " + self.quoteIdentifier(as) + " ON "
              joinQueryItem += where

            if (include.where) {
              joinQueryItem += " AND "+self.getWhereConditions(include.where, self.sequelize.literal(self.quoteIdentifier(as)), include.daoFactory, whereOptions)

              // If its a multi association we need to add a where query to the main where (executed in the subquery)
              if (subQuery && association.isMultiAssociation) {
                if (!options.where) options.where = {}
                // Creating the as-is where for the subQuery, checks that the required association exists
                options.where["__"+as] = self.sequelize.asIs("(SELECT "+self.quoteIdentifier(attrRight)+" FROM " + self.quoteIdentifier(tableRight) + " WHERE " + where + " AND ROWNUM = 1) IS NOT NULL")
              }
            }
          }

          if (include.subQuery && subQuery) {
            joinQueries.subQuery.push(joinQueryItem);
          } else {
            joinQueries.mainQuery.push(joinQueryItem);
          }

          if (include.include) {
            include.include.forEach(function(childInclude) {
              if (childInclude._pseudo) return
              var childJoinQueries = generateJoinQueries(childInclude, as)

              if (childInclude.subQuery && subQuery) {
                joinQueries.subQuery = joinQueries.subQuery.concat(childJoinQueries.subQuery)
              } else {
                joinQueries.mainQuery = joinQueries.mainQuery.concat(childJoinQueries.mainQuery)
              }
            }.bind(this))
          }
          return joinQueries
        }

        // Loop through includes and generate subqueries
        options.include.forEach(function(include) {
          var joinQueries = generateJoinQueries(include, tableName)

          subJoinQueries = subJoinQueries.concat(joinQueries.subQuery)
          mainJoinQueries = mainJoinQueries.concat(joinQueries.mainQuery)
        }.bind(this))
      }

      // If using subQuery select defined subQuery attributes and join subJoinQueries
      if (subQuery) {
        subQueryItems.push("SELECT " + subQueryAttributes.join(', ') + " FROM " + options.table)
        subQueryItems.push(subJoinQueries.join(''))

      // Else do it the reguar way
      } else {
        mainQueryItems.push("SELECT " + mainAttributes.join(', ') + " FROM " + options.table)
        mainQueryItems.push(mainJoinQueries.join(''))
      }

      // Add WHERE to sub or main query
      if (options.hasOwnProperty('where')) {
        options.where = this.getWhereConditions(options.where, tableName, factory, options)
        if (subQuery) {
          subQueryItems.push(" WHERE " + options.where)
        } else {
          mainQueryItems.push(" WHERE " + options.where)
        }
      }

      // Add GROUP BY to sub or main query
      if (options.group) {
        options.group = Array.isArray(options.group) ? options.group.map(function (t) { return this.quote(t, factory) }.bind(this)).join(', ') : options.group
        if (subQuery) {
          subQueryItems.push(" GROUP BY " + options.group)
        } else {
          mainQueryItems.push(" GROUP BY " + options.group)
        }
      }
      
      // Add HAVING to sub or main query
      if (options.hasOwnProperty('having')) {
        options.having = this.getWhereConditions(options.having, tableName, factory, options, false)
        if (subQuery) {
          subQueryItems.push(" HAVING " + options.having)
        } else {
          mainQueryItems.push(" HAVING " + options.having)
        }
      }

      // Add ORDER to sub or main query
      if (options.order) {
        var mainQueryOrder = [];
        var subQueryOrder = [];

        if (Array.isArray(options.order)) {
          options.order.forEach(function (t) {
            var strOrder = this.quote(t, factory)
            var tableName = this.getTableNameOrder(t)
            if (subQuery && !(t[0] instanceof daoFactory) && !(t[0].model instanceof daoFactory)) {
              if(tableName && subQueryAs.indexOf(tableName) > -1){
                subQueryOrder.push(strOrder)
              }              
            }
            
            if(subQuery && tableName !== subQueryAs[0] && subQueryAs.indexOf(tableName) > -1){
              mainQueryOrder.push(this.getSpecificQuoteOrder(t))
            }else{
              mainQueryOrder.push(strOrder)
            }
          }.bind(this))
        } else {
          mainQueryOrder.push(options.order)
        }
        
        if (mainQueryOrder.length) {
          mainQueryItems.push(" ORDER BY " + mainQueryOrder.join(', '))
        }
        if (subQueryOrder.length) {
          subQueryItems.push(" ORDER BY " + subQueryOrder.join(', '))
        }
      }



      // If using subQuery, select attributes from wrapped subQuery and join out join tables
      if (subQuery) {
        query = "SELECT " + mainAttributes.join(', ') + " FROM ("
          query += subQueryItems.join('')
        query += ") "+options.table
        query += mainJoinQueries.join('')
        query += mainQueryItems.join('')
      } else {
        query = mainQueryItems.join('')
      }


      var query = this.addLimitAndOffset(options, query)

      // Add LIMIT, OFFSET to sub or main query
      // if (limitOrder) {
      //   if (subQuery) {
      //     subQueryItems.push(limitOrder)
      //   } else {
      //     mainQueryItems.push(limitOrder)
      //   }
      // }

      //query += ";";

      return query
    },

    mysqlDataTypeMapping: function(tableName, attr, dataType) {
      if (Utils._.includes(dataType, 'UUID')) {
        dataType = dataType.replace(/UUID/, 'CHAR(36) BINARY')
      }

      return dataType
    }
  }

  return Utils._.extend(Utils._.clone(require("../abstract/query-generator")), QueryGenerator)
})()
