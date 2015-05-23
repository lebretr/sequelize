'use strict';

var Utils = require('../../utils')
  , DataTypes = require('../../data-types')
  , SqlString = require('./sql-string')
  , Model = require('../../model')
  , util = require('util')
  , _ = require('lodash');

module.exports = (function() {
  var QueryGenerator = {
    dialect: 'oracle',

    createTableQuery: function(tableName, attributes, options) {
      //Warning: you must have CREATE ANY TABLE system privilege
      //Warning: you must have CREATE ANY SEQUENCE system privilege
      //Warning: you must have CREATE ANY TRIGGER system privilege
      var self = this;

      options = Utils._.extend({
      }, options || {});

      var query = [
          '-- drop table before if exist',
          'BEGIN ' ,
          '   DECLARE ' ,
          '       e_table_non_exists EXCEPTION; ' ,
          '       PRAGMA EXCEPTION_INIT(e_table_non_exists, -00942); ' ,
          '   BEGIN ' ,
          '       EXECUTE IMMEDIATE (\'DROP TABLE <%= table %> CASCADE CONSTRAINTS\'); ' ,
          '   EXCEPTION ' ,
          '       WHEN e_table_non_exists ' ,
          '       THEN NULL; ' ,
          '   END; ' ,
          '   EXECUTE IMMEDIATE (\' ' ,
          '       CREATE TABLE <%= table %> ( ' ,
          '           <%= attributes%> ' ,
          '       ) <%= comment %> ' ,
          '   \'); ' ,
          '',
          '<%= sequence %> ',
          '',
          '<%= trigger %> ',
          '',
          'END;' 
        ].join(' \n')
        , sequenceTpl =[
          '   -- drop sequence before if exist',
          '   DECLARE  ',
          '     e_sequence_non_exists EXCEPTION;  ',
          '     PRAGMA EXCEPTION_INIT(e_sequence_non_exists, -02289);  ',
          '   BEGIN  ',
          '     EXECUTE IMMEDIATE (\'DROP SEQUENCE <%= sequence %> \');  ',
          '   EXCEPTION  ',
          '     WHEN e_sequence_non_exists  ',
          '     THEN NULL;  ',
          '   END;  ',
          '   EXECUTE IMMEDIATE (\' CREATE  SEQUENCE <%= sequence %> START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE \');  ',
        ].join(' \n')
        , triggerTpl = [
          '   -- replace trigger if exist',
          '   EXECUTE IMMEDIATE (\' CREATE OR REPLACE TRIGGER <%= trigger %>' ,
          '   BEFORE INSERT ON <%= table %>' ,
          '   FOR EACH ROW' ,
          '   ' ,
          '   BEGIN' ,
          '     :new.<%= column %> := <%= sequence %>.NEXTVAL;' +
          '   END;' ,
          '   \');'
        ].join(' \n')
        , primaryKeys = []
        , autoIncrementKeys = []
        , foreignKeys = {}
        , attrStr = []
        , sequences = ''
        , triggers = ''
        ;
      //var query = [ 
      //     '-- create table if not exist',
      //     'DECLARE ' ,
      //     '   e_table_exists EXCEPTION; ' ,
      //     '   PRAGMA EXCEPTION_INIT(e_table_exists, -00955); ' ,
      //     'BEGIN ' ,
      //     '' ,
      //     '  EXECUTE IMMEDIATE (\'CREATE TABLE <%= table %> (<%= attributes%>) <%= comment %> \'); ' ,
      //     '' ,
      //     'EXCEPTION ' ,
      //     '  WHEN e_table_exists ' ,
      //     '    THEN NULL; ' ,
      //     'END; ' 
      //   ].join(' \n')
      //   , primaryKeys = []
      //   , autoIncrementKeys = []
      //   , foreignKeys = {}
      //   , attrStr = []
      //   , sequences = ''
      //   , triggers = ''
      //   ;

      for (var attr in attributes) {
        if (attributes.hasOwnProperty(attr)) {
          var dataType = attributes[attr]
            , match;

          if (Utils._.includes(dataType, 'auto_increment')) {
            autoIncrementKeys.push(attr);
            dataType=dataType.replace(/auto_increment/, '');
          }

          if (Utils._.includes(dataType, 'PRIMARY KEY')) {
            primaryKeys.push(attr);
            dataType=dataType.replace(/PRIMARY KEY/, '');
          }

          if (Utils._.includes(dataType, 'REFERENCES')) {
            // MySQL doesn't support inline REFERENCES declarations: move to the end
            match = dataType.match(/^(.+) (REFERENCES.*)$/);
            dataType = match[1];
            foreignKeys[attr] = match[2];
          }

          attrStr.push(this.quoteIdentifier(attr) + ' ' + dataType);
        }
      }

      if (autoIncrementKeys.length > 0) {
        for (var ikey in autoIncrementKeys) {

          sequences+='\n\n'+Utils._.template(sequenceTpl)({
            sequence:this.quoteIdentifier( tableName + '_'+autoIncrementKeys[ikey]+'_SEQ')
          }).trim() ;

          triggers+='\n\n'+Utils._.template(triggerTpl)({
            trigger: this.quoteIdentifier( tableName + '_'+autoIncrementKeys[ikey]+'_TRG'),
            table: this.quoteIdentifier( tableName ),
            sequence: this.quoteIdentifier( tableName + '_'+autoIncrementKeys[ikey]+'_SEQ'),
            column: this.quoteIdentifier(autoIncrementKeys[ikey])
          }).trim() ;
        }
      }

      var values = {
        table: this.quoteTable(tableName),
        attributes: attrStr.join(', '),
        comment: options.comment && Utils._.isString(options.comment) ? ' COMMENT ' + this.escape(options.comment) : '',
        sequence: sequences,
        trigger: triggers
        // engine: options.engine,
        // charset: (options.charset ? ' DEFAULT CHARSET=' + options.charset : ''),
        // collation: (options.collate ? ' COLLATE ' + options.collate : ''),
        // initialAutoIncrement: (options.initialAutoIncrement ? ' AUTO_INCREMENT=' + options.initialAutoIncrement : '')
      }
      , pkString = primaryKeys.map(function(pk) { return this.quoteIdentifier(pk); }.bind(this)).join(', ');

      if (!!options.uniqueKeys) {
        Utils._.each(options.uniqueKeys, function(columns, indexName) {  
          if (!Utils._.isString(indexName)) {
            indexName = 'uniq_' + tableName + '_' + columns.fields.join('_');
          }
          values.attributes += ', UNIQUE ' + self.quoteIdentifier(indexName) + ' (' + Utils._.map(columns.fields, self.quoteIdentifier).join(', ') + ')';
          
          // values.attributes += ', UNIQUE uniq_' + tableName + '_' + columns.fields.join('_') + ' (' + columns.fields.join(', ') + ')';
        });
      }

      if (pkString.length > 0) {
        values.attributes += ', CONSTRAINT '+this.quoteIdentifier(tableName+'_PK')+' PRIMARY KEY (' + pkString + ')';
      }

      for (var fkey in foreignKeys) {
        if(foreignKeys.hasOwnProperty(fkey)) {
          values.attributes += ', FOREIGN KEY (' + this.quoteIdentifier(fkey) + ') ' + foreignKeys[fkey];
        }
      }

      return Utils._.template(query)(values).trim();
    },
    
    removeColumnQuery: function(tableName, attributeName) {
      var query = 'ALTER TABLE <%= tableName %> DROP COLUMN <%= attributeName %>;';
      return Utils._.template(query)({
        tableName: this.quoteTable(tableName),
        attributeName: this.quoteIdentifier(attributeName)
      });
    },

    showIndexesQuery: function(tableName, options) {
      if (!Utils._.isString(tableName)) {
        tableName = tableName.tableName;
      }

      // tableName = this.quoteTable(tableName);

      var query = 'SELECT index_name FROM user_indexes ' +
          'WHERE table_name = \'<%= tableName %>\'';

      return Utils._.template(query)({ tableName: tableName });
    },

    selectQuery: function(tableName, options, model) {
      // Enter and change at your own peril -- Mick Hansen

      options = options || {};

      var table = null
        , self = this
        , query
        , limit = options.limit
        , mainModel = model
        , mainQueryItems = []
        , mainAttributes = options.attributes && options.attributes.slice(0)
        , mainJoinQueries = []
        // We'll use a subquery if we have a hasMany association and a limit
        , subQuery = options.subQuery === undefined ?
                     limit && options.hasMultiAssociation :
                     options.subQuery
        , subQueryItems = []
        , subQueryAttributes = null
        , subJoinQueries = []
        , mainTableAs = null;

      if (options.tableAs) {
        mainTableAs = this.quoteTable(options.tableAs);
      } else if (!Array.isArray(tableName) && model) {
        options.tableAs = mainTableAs = this.quoteTable(model.name);
      }

      options.table = table = !Array.isArray(tableName) ? this.quoteTable(tableName) : tableName.map(function(t) {
        if (Array.isArray(t)) {
          return this.quoteTable(t[0], t[1]);
        }
        return this.quoteTable(t, true);
      }.bind(this)).join(', ');

      if (subQuery && mainAttributes) {
        model.primaryKeyAttributes.forEach(function(keyAtt) {
          // Check if mainAttributes contain the primary key of the model either as a field or an aliased field
          if (!_.find(mainAttributes, function (attr) {
            return keyAtt === attr || keyAtt === attr[0] || keyAtt === attr[1];
          })) {
            mainAttributes.push(model.rawAttributes[keyAtt].field ? [keyAtt, model.rawAttributes[keyAtt].field] : keyAtt);
          }
        });
      }

      // Escape attributes
      mainAttributes = mainAttributes && mainAttributes.map(function(attr) {
        var addTable = true;

        if (attr._isSequelizeMethod) {
          return self.handleSequelizeMethod(attr);
        }

        if (Array.isArray(attr) && attr.length === 2) {
          if (attr[0]._isSequelizeMethod) {
            attr[0] = self.handleSequelizeMethod(attr[0]);
            addTable = false;
          } else {
            if (attr[0].indexOf('(') === -1 && attr[0].indexOf(')') === -1) {
              attr[0] = self.quoteIdentifier(attr[0]);
            }
          }
          attr = [attr[0], self.quoteIdentifier(attr[1])].join(' ');
        } else {
          attr = attr.indexOf(Utils.TICK_CHAR) < 0 && attr.indexOf('"') < 0 ? self.quoteIdentifiers(attr) : attr;
        }

        if (options.include && attr.indexOf('.') === -1 && addTable) {
          attr = mainTableAs + '.' + attr;
        }
        return attr;
      });

      // If no attributes specified, use *
      mainAttributes = mainAttributes || (options.include ? [mainTableAs + '.*'] : ['*']);

      // If subquery, we ad the mainAttributes to the subQuery and set the mainAttributes to select * from subquery
      if (subQuery) {
        // We need primary keys
        subQueryAttributes = mainAttributes;
        mainAttributes = [mainTableAs + '.*'];
      }

      if (options.include) {
        var generateJoinQueries = function(include, parentTable) {
          var table = include.model.getTableName()
            , as = include.as
            , joinQueryItem = ''
            , joinQueries = {
              mainQuery: [],
              subQuery: []
            }
            , attributes
            , association = include.association
            , through = include.through
            , joinType = include.required ? ' INNER JOIN ' : ' LEFT OUTER JOIN '
            , whereOptions = Utils._.clone(options)
            , targetWhere;

          whereOptions.keysEscaped = true;

          if (tableName !== parentTable && mainTableAs !== parentTable) {
            as = parentTable + '.' + include.as;
          }

          // includeIgnoreAttributes is used by aggregate functions
          if (options.includeIgnoreAttributes !== false) {

            attributes = include.attributes.map(function(attr) {
              var attrAs = attr,
                  verbatim = false;

              if (Array.isArray(attr) && attr.length === 2) {
                if (attr[0]._isSequelizeMethod) {
                  if (attr[0] instanceof Utils.literal ||
                    attr[0] instanceof Utils.cast ||
                    attr[0] instanceof Utils.fn
                  ) {
                    verbatim = true;
                  }
                }

                attr = attr.map(function($attr) {
                  return $attr._isSequelizeMethod ? self.handleSequelizeMethod($attr) : $attr;
                });

                attrAs = attr[1];
                attr = attr[0];
              } else if (attr instanceof Utils.literal) {
                return attr.val; // We trust the user to rename the field correctly
              } else if (attr instanceof Utils.cast ||
                attr instanceof Utils.fn
              ) {
                throw new Error(
                  'Tried to select attributes using Sequelize.cast or Sequelize.fn without specifying an alias for the result, during eager loading. ' +
                  'This means the attribute will not be added to the returned instance'
                );
              }

              var prefix;
              if (verbatim === true) {
                prefix = attr;
              } else {
                prefix = self.quoteIdentifier(as) + '.' + self.quoteIdentifier(attr);
              }
              return prefix + ' ' + self.quoteIdentifier(as + '.' + attrAs);
            });
            if (include.subQuery && subQuery) {
              subQueryAttributes = subQueryAttributes.concat(attributes);
            } else {
              mainAttributes = mainAttributes.concat(attributes);
            }
          }

          if (through) {
            var throughTable = through.model.getTableName()
              , throughAs = as + '.' + through.as
              , throughAttributes = through.attributes.map(function(attr) {
                return self.quoteIdentifier(throughAs) + '.' + self.quoteIdentifier(Array.isArray(attr) ? attr[0] : attr) +
                       ' ' +
                       self.quoteIdentifier(throughAs + '.' + (Array.isArray(attr) ? attr[1] : attr));
              })
              , primaryKeysSource = association.source.primaryKeyAttributes
              , tableSource = parentTable
              , identSource = association.identifierField
              , attrSource = primaryKeysSource[0]
              , primaryKeysTarget = association.target.primaryKeyAttributes
              , tableTarget = as
              , identTarget = association.foreignIdentifierField
              , attrTarget = association.target.rawAttributes[primaryKeysTarget[0]].field || primaryKeysTarget[0]

              , sourceJoinOn
              , targetJoinOn

              , throughWhere;

            if (options.includeIgnoreAttributes !== false) {
              // Through includes are always hasMany, so we need to add the attributes to the mainAttributes no matter what (Real join will never be executed in subquery)
              mainAttributes = mainAttributes.concat(throughAttributes);
            }

            // Figure out if we need to use field or attribute
            if (!subQuery) {
              attrSource = association.source.rawAttributes[primaryKeysSource[0]].field;
            }
            if (subQuery && !include.subQuery && !include.parent.subQuery && include.parent.model !== mainModel) {
              attrSource = association.source.rawAttributes[primaryKeysSource[0]].field;
            }

            // Filter statement for left side of through
            // Used by both join and subquery where

            // If parent include was in a subquery need to join on the aliased attribute
            if (subQuery && !include.subQuery && include.parent.subQuery) {
              sourceJoinOn = self.quoteIdentifier(tableSource + '.' + attrSource) + ' = ';
            } else {
              sourceJoinOn = self.quoteTable(tableSource) + '.' + self.quoteIdentifier(attrSource) + ' = ';
            }
            sourceJoinOn += self.quoteIdentifier(throughAs) + '.' + self.quoteIdentifier(identSource);

            // Filter statement for right side of through
            // Used by both join and subquery where
            targetJoinOn = self.quoteIdentifier(tableTarget) + '.' + self.quoteIdentifier(attrTarget) + ' = ';
            targetJoinOn += self.quoteIdentifier(throughAs) + '.' + self.quoteIdentifier(identTarget);

            if (include.through.where) {
              throughWhere = self.getWhereConditions(include.through.where, self.sequelize.literal(self.quoteIdentifier(throughAs)), include.through.model);
            }

            if (self._dialect.supports.joinTableDependent) {
              // Generate a wrapped join so that the through table join can be dependent on the target join
              joinQueryItem += joinType + '(';
              joinQueryItem += self.quoteTable(throughTable, throughAs);
              joinQueryItem += ' INNER JOIN ' + self.quoteTable(table, as) + ' ON ';
              joinQueryItem += targetJoinOn;

              if (throughWhere) {
                joinQueryItem += ' AND ' + throughWhere;
              }

              joinQueryItem += ') ON '+sourceJoinOn;
            } else {
              // Generate join SQL for left side of through
              joinQueryItem += joinType + self.quoteTable(throughTable, throughAs)  + ' ON ';
              joinQueryItem += sourceJoinOn;

              // Generate join SQL for right side of through
              joinQueryItem += joinType + self.quoteTable(table, as) + ' ON ';
              joinQueryItem += targetJoinOn;

              if (throughWhere) {
                joinQueryItem += ' AND ' + throughWhere;
              }

            }

            if (include.where || include.through.where) {
              if (include.where) {
                targetWhere = self.getWhereConditions(include.where, self.sequelize.literal(self.quoteIdentifier(as)), include.model, whereOptions);
                if (targetWhere) {
                  joinQueryItem += ' AND ' + targetWhere;
                }
              }
              if (subQuery && include.required) {
                if (!options.where) options.where = {};
                (function (include) {
                  // Closure to use sane local variables

                  var parent = include
                    , child = include
                    , nestedIncludes = []
                    , topParent
                    , topInclude
                    , $query;

                  while (parent = parent.parent) {
                    nestedIncludes = [_.extend({}, child, {include: nestedIncludes})];
                    child = parent;
                  }

                  topInclude = nestedIncludes[0];
                  topParent = topInclude.parent;

                  if (topInclude.through && Object(topInclude.through.model) === topInclude.through.model) {
                    $query = self.selectQuery(topInclude.through.model.getTableName(), {
                      attributes: [topInclude.through.model.primaryKeyAttributes[0]],
                      include: [{
                        model: topInclude.model,
                        as: topInclude.model.name,
                        attributes: [],
                        association: {
                          associationType: 'BelongsTo',
                          isSingleAssociation: true,
                          source: topInclude.association.target,
                          target: topInclude.association.source,
                          identifier: topInclude.association.foreignIdentifier,
                          identifierField: topInclude.association.foreignIdentifierField
                        },
                        required: true,
                        include: topInclude.include,
                        _pseudo: true
                      }],
                      where: self.sequelize.and(
                        self.sequelize.asIs([
                          self.quoteTable(topParent.model.name) + '.' + self.quoteIdentifier(topParent.model.primaryKeyAttributes[0]),
                          self.quoteIdentifier(topInclude.through.model.name) + '.' + self.quoteIdentifier(topInclude.association.identifierField)
                        ].join(' = ')),
                        topInclude.through.where
                      ),
                      limit: 1,
                      includeIgnoreAttributes: false
                    }, topInclude.through.model);
                  } else {
                    $query = self.selectQuery(topInclude.model.tableName, {
                      attributes: [topInclude.model.primaryKeyAttributes[0]],
                      include: topInclude.include,
                      where: {
                        $join: self.sequelize.asIs([
                          self.quoteTable(topParent.model.name) + '.' + self.quoteIdentifier(topParent.model.primaryKeyAttributes[0]),
                          self.quoteIdentifier(topInclude.model.name) + '.' + self.quoteIdentifier(topInclude.association.identifierField)
                        ].join(' = '))
                      },
                      limit: 1,
                      includeIgnoreAttributes: false
                    }, topInclude.model);
                  }

                  options.where['__' + throughAs] = self.sequelize.asIs([
                    '(',
                      $query.replace(/\;$/, ''),
                    ')',
                    'IS NOT NULL'
                  ].join(' '));
                })(include);
              }
            }
          } else {
            var left = association.source
              , right = association.target
              , primaryKeysLeft = left.primaryKeyAttributes
              , primaryKeysRight = right.primaryKeyAttributes
              , tableLeft = parentTable
              , attrLeft = association.associationType === 'BelongsTo' ?
                           association.identifierField || association.identifier :
                           primaryKeysLeft[0]

              , tableRight = as
              , attrRight = association.associationType !== 'BelongsTo' ?
                            association.identifierField || association.identifier :
                            right.rawAttributes[primaryKeysRight[0]].field || primaryKeysRight[0]
              , joinOn
              , subQueryJoinOn;

            // Filter statement
            // Used by both join and where
            if (subQuery && !include.subQuery && include.parent.subQuery && (include.hasParentRequired || include.hasParentWhere || include.parent.hasIncludeRequired || include.parent.hasIncludeWhere)) {
              joinOn = self.quoteIdentifier(tableLeft + '.' + attrLeft);
            } else {
              if (association.associationType !== 'BelongsTo') {
                // Alias the left attribute if the left attribute is not from a subqueried main table
                // When doing a query like SELECT aliasedKey FROM (SELECT primaryKey FROM primaryTable) only aliasedKey is available to the join, this is not the case when doing a regular select where you can't used the aliased attribute
                if (!subQuery || (subQuery && include.parent.model !== mainModel)) {
                  if (left.rawAttributes[attrLeft].field) {
                    attrLeft = left.rawAttributes[attrLeft].field;
                  }
                }
              }
              joinOn = self.quoteTable(tableLeft) + '.' + self.quoteIdentifier(attrLeft);
            }
            subQueryJoinOn = self.quoteTable(tableLeft) + '.' + self.quoteIdentifier(attrLeft);

            joinOn += ' = ' + self.quoteTable(tableRight) + '.' + self.quoteIdentifier(attrRight);
            subQueryJoinOn += ' = ' + self.quoteTable(tableRight) + '.' + self.quoteIdentifier(attrRight);

            if (include.where) {
              targetWhere = self.getWhereConditions(include.where, self.sequelize.literal(self.quoteIdentifier(as)), include.model, whereOptions);
              if (targetWhere) {
                joinOn += ' AND ' + targetWhere;
                subQueryJoinOn += ' AND ' + targetWhere;
              }
            }

            // If its a multi association and the main query is a subquery (because of limit) we need to filter based on this association in a subquery
            if (subQuery && association.isMultiAssociation && include.required) {
              if (!options.where) options.where = {};
              // Creating the as-is where for the subQuery, checks that the required association exists
              var $query = self.selectQuery(include.model.getTableName(), {
                tableAs: as,
                attributes: [attrRight],
                where: self.sequelize.asIs(subQueryJoinOn ? [subQueryJoinOn] : [joinOn]),
                limit: 1
              }, include.model);

              var subQueryWhere = self.sequelize.asIs([
                '(',
                  $query.replace(/\;$/, ''),
                ')',
                'IS NOT NULL'
              ].join(' '));

              if (options.where instanceof Utils.and) {
                options.where.args.push(subQueryWhere);
              } else if (Utils._.isPlainObject(options.where)) {
                options.where['__' + as] = subQueryWhere;
              } else {
                options.where = { $and: [options.where, subQueryWhere] };
              }
            }

            // Generate join SQL
            joinQueryItem += joinType + self.quoteTable(table, as) + ' ON ' + joinOn;
          }

          if (include.subQuery && subQuery) {
            joinQueries.subQuery.push(joinQueryItem);
          } else {
            joinQueries.mainQuery.push(joinQueryItem);
          }

          if (include.include) {
            include.include.forEach(function(childInclude) {
              if (childInclude._pseudo) return;
              var childJoinQueries = generateJoinQueries(childInclude, as);

              if (childInclude.subQuery && subQuery) {
                joinQueries.subQuery = joinQueries.subQuery.concat(childJoinQueries.subQuery);
              }
              if (childJoinQueries.mainQuery) {
                joinQueries.mainQuery = joinQueries.mainQuery.concat(childJoinQueries.mainQuery);
              }

            }.bind(this));
          }

          return joinQueries;
        };

        // Loop through includes and generate subqueries
        options.include.forEach(function(include) {
          var joinQueries = generateJoinQueries(include, options.tableAs);

          subJoinQueries = subJoinQueries.concat(joinQueries.subQuery);
          mainJoinQueries = mainJoinQueries.concat(joinQueries.mainQuery);

        }.bind(this));
      }

      // If using subQuery select defined subQuery attributes and join subJoinQueries
      if (subQuery) {
        subQueryItems.push('SELECT ' + subQueryAttributes.join(', ') + ' FROM ' + options.table);
        if (mainTableAs) {
          subQueryItems.push(' ' + mainTableAs);
        }
        subQueryItems.push(subJoinQueries.join(''));

      // Else do it the reguar way
      } else {
        mainQueryItems.push('SELECT ' + mainAttributes.join(', ') + ' FROM ' + options.table);
        if (mainTableAs) {
          mainQueryItems.push(' ' + mainTableAs);
        }
        mainQueryItems.push(mainJoinQueries.join(''));
      }

      // Add WHERE to sub or main query
      if (options.hasOwnProperty('where')) {
        options.where = this.getWhereConditions(options.where, mainTableAs || tableName, model, options);
        if (options.where) {
          if (subQuery) {
            subQueryItems.push(' WHERE ' + options.where);
          } else {
            mainQueryItems.push(' WHERE ' + options.where);
          }
        }
      }

      // Add GROUP BY to sub or main query
      if (options.group) {
        options.group = Array.isArray(options.group) ? options.group.map(function(t) { return this.quote(t, model); }.bind(this)).join(', ') : options.group;
        if (subQuery) {
          subQueryItems.push(' GROUP BY ' + options.group);
        } else {
          mainQueryItems.push(' GROUP BY ' + options.group);
        }
      }

      // Add HAVING to sub or main query
      if (options.hasOwnProperty('having')) {
        options.having = this.getWhereConditions(options.having, tableName, model, options, false);
        if (subQuery) {
          subQueryItems.push(' HAVING ' + options.having);
        } else {
          mainQueryItems.push(' HAVING ' + options.having);
        }
      }
      // Add ORDER to sub or main query
      if (options.order) {
        var mainQueryOrder = [];
        var subQueryOrder = [];

        var validateOrder = function(order) {
          if (order instanceof Utils.literal) return;

          if (!_.contains([
            'ASC',
            'DESC',
            'ASC NULLS LAST',
            'DESC NULLS LAST',
            'ASC NULLS FIRST',
            'DESC NULLS FIRST',
            'NULLS FIRST',
            'NULLS LAST'
          ], order.toUpperCase())) {
            throw new Error(util.format('Order must be \'ASC\' or \'DESC\', \'%s\' given', order));
          }
        };

        if (Array.isArray(options.order)) {
          options.order.forEach(function(t) {
            if (Array.isArray(t) && _.size(t) > 1) {
              if (t[0] instanceof Model || t[0].model instanceof Model) {
                if (typeof t[t.length - 2] === 'string') {
                  validateOrder(_.last(t));
                }
              } else {
                validateOrder(_.last(t));
              }
            }

            if (subQuery && (Array.isArray(t) && !(t[0] instanceof Model) && !(t[0].model instanceof Model))) {
              subQueryOrder.push(this.quote(t, model));
            }

            mainQueryOrder.push(this.quote(t, model));
          }.bind(this));
        } else {
          mainQueryOrder.push(this.quote(typeof options.order === 'string' ? new Utils.literal(options.order) : options.order, model));
        }

        if (mainQueryOrder.length) {
          mainQueryItems.push(' ORDER BY ' + mainQueryOrder.join(', '));
        }
        if (subQueryOrder.length) {
          subQueryItems.push(' ORDER BY ' + subQueryOrder.join(', '));
        }
      }

      // If using subQuery, select attributes from wrapped subQuery and join out join tables
      if (subQuery) {
        query = 'SELECT ' + mainAttributes.join(', ') + ' FROM (';
        query += subQueryItems.join('');
        query += ') ' + options.tableAs;
        query += mainJoinQueries.join('');
        query += mainQueryItems.join('');
      } else {
        query = mainQueryItems.join('');
      }

      // Add LIMIT, OFFSET to sub or main query
      // var limitOrder = this.addLimitAndOffset(options, model);
      // if (limitOrder) {
      //   if (subQuery) {
      //     subQueryItems.push(limitOrder);
      //   } else {
      //     mainQueryItems.push(limitOrder);
      //   }
      // }
      query = this.addLimitAndOffset(options, query);

      if (options.lock && this._dialect.supports.lock) {
        var lock = options.lock;
        if (typeof options.lock === 'object') {
          lock = options.lock.level;
        }
        if (this._dialect.supports.lockKey && (lock === 'KEY SHARE' || lock === 'NO KEY UPDATE')) {
          query += ' FOR ' + lock;
        } else if (lock === 'SHARE') {
          query += ' ' + this._dialect.supports.forShare;
        } else {
          query += ' FOR UPDATE';
        }
        if (this._dialect.supports.lockOf && options.lock.of instanceof Model) {
          query += ' OF ' + this.quoteTable(options.lock.of.name);
        }
      }

      // query += ';';

      return query;
      // return {sql:query, bind:{}};
    },

    findAutoIncrementField: function(factory) {
      var fields = [];
      for (var name in factory.attributes) {
        if (factory.attributes.hasOwnProperty(name)) {
          var definition = factory.attributes[name];

          if (definition && definition.autoIncrement) {
            fields.push(name);
          }
        }
      }

      return fields;
    },

    addLimitAndOffset: function(options, query){
      query = query || '';
      if (!options.offset && options.limit) {
        query = ' SELECT * FROM (  SELECT t.*, ROWNUM ROWNUM_1 FROM (' + query + ')t )t2 WHERE t2.ROWNUM_1 <=' + options.limit;
      }

      if (options.offset && !options.limit) {
        query = ' SELECT * FROM (  SELECT t.*, ROWNUM ROWNUM_1 FROM (' + query + ')t )t2 WHERE t2.ROWNUM_1 >' + options.offset;
      }
      if (options.offset && options.limit) {
        query = ' SELECT * FROM (  SELECT t.*, ROWNUM ROWNUM_1 FROM (' + query + ')t )t2 WHERE t2.ROWNUM_1 BETWEEN ' + (parseInt(options.offset,10) + 1) + ' AND ' +  (parseInt(options.offset,10) + parseInt(options.limit,10));
      }
      return query;
    },

    attributeToSQL: function(attribute) {
      if (!Utils._.isPlainObject(attribute)) {
        attribute = {
          type: attribute
        };
      }

      var template;

      if (attribute.type instanceof DataTypes.ENUM) {
        var len=1;
        for (var i in attribute.type.values){
          if(len<attribute.type.values[i].length){
            len=attribute.type.values[i].length;
          }
        }
        if (Array.isArray(attribute.type.values) && (attribute.type.values.length > 0)) {
          template = 'VARCHAR2('+len+') CHECK( "'+attribute.name+'" IN (' + Utils._.map(attribute.type.values, function(value) {
            return this.escape(this.escape(value));
          }.bind(this)).join(', ') + '))';
        } else {
          throw new Error('Values for ENUM haven\'t been defined.');
        }
        // if (attribute.type.values && !attribute.values) attribute.values = attribute.type.values;
        // template = 'ENUM(' + Utils._.map(attribute.values, function(value) {
        //   return this.escape(value);
        // }.bind(this)).join(', ') + ')';
      } else {
        template = attribute.type.toString();
      }

      if (attribute.allowNull === false) {
        template += ' NOT NULL';
      }

      if (attribute.autoIncrement) {
        template += ' auto_increment';
      }

      // Blobs/texts cannot have a defaultValue
      if (attribute.type !== 'TEXT' && attribute.type._binary !== true && Utils.defaultValueSchemable(attribute.defaultValue)) {
        template += ' DEFAULT ' + this.escape(attribute.defaultValue);
      }

      if (attribute.unique === true) {
        template += ' UNIQUE';
      }

      if (attribute.primaryKey) {
        template += ' PRIMARY KEY';
      }

      if (attribute.references) {
        attribute = Utils.formatReferences(attribute);
        template += ' REFERENCES ' + this.quoteTable(attribute.references.model);

        if (attribute.references.key) {
          template += ' (' + this.quoteIdentifier(attribute.references.key) + ')';
        } else {
          template += ' (' + this.quoteIdentifier('id') + ')';
        }

        if (attribute.onDelete) {
          template += ' ON DELETE ' + attribute.onDelete.toUpperCase();
        }

        //Oracle no support
        // if (attribute.onUpdate) {
        //   template += ' ON UPDATE ' + attribute.onUpdate.toUpperCase();
        // }
      }

      return template;
    },

    attributesToSQL: function(attributes, options) {
      var result = {}
        , key
        , attribute;

      for (key in attributes) {
        attribute = attributes[key];
        result[attribute.field || key] = this.attributeToSQL(attribute, options);
      }

      return result;
    },


    quoteTable: function(param, as) {
      var table = '';

      if (as === true) {
        as = param.as || param.name || param;
      }

      if (_.isObject(param)) {
        if (this._dialect.supports.schemas) {
          if (param.schema) {
            table += this.quoteIdentifier(param.schema) + '.';
          }

          table += this.quoteIdentifier(param.tableName);
        } else {
          if (param.schema) {
            table += param.schema + (param.delimiter || '.');
          }

          table += param.tableName;
          table = this.quoteIdentifier(table);
        }


      } else {
        table = this.quoteIdentifier(param);
      }

      if (as) {
        table += ' ' + this.quoteIdentifier(as);
      }
      return table;
    },

    quoteIdentifier: function(identifier, force) {
      //identifier=identifier.replace(/\./g,'_');
      // identifier=identifier.replace(/ AS /g,' ');
      if (identifier === '*') return identifier;
      if(!force && this.options && this.options.quoteIdentifiers === false) { // default is `true`
        // In Oracle, if tables or attributes are created double-quoted,
        // they are also case sensitive. If they contain any lowercase
        // characters, they must always be double-quoted. This makes it
        // impossible to write queries in portable SQL if tables are created in
        // this way. Hence, we strip quotes if we don't want case sensitivity.
        return Utils.removeTicks(identifier, '"');
      } else {
        return Utils.addTicks(identifier, '"');
      }
    },

    /*
      Escape a value (e.g. a string, number or date)
    */
    escape: function(value, field) {
      if (value && value._isSequelizeMethod) {
        return this.handleSequelizeMethod(value);
      } else {
        return SqlString.escape(value, false, this.options.timezone, this.dialect, field);
      }
    },

    /*
      Escape a value (e.g. a string, number or date)
    */
    // escape: function(value, field) {
    //   if (value && value._isSequelizeMethod) {
    //     return this.handleSequelizeMethod(value);
    //   } else if (value instanceof Date && !isNaN(value.valueOf())) {

    //     var newVal = value;
    //     if (value instanceof Date) {
    //       newVal = SqlString.dateToString(value, this.options.timezone || 'Z', this.dialect);
    //     }

    //     return 'TO_TIMESTAMP_TZ(\''+newVal+'\',\'YYYY-MM-DD HH24:MI:SS.FF3 TZH:TZM\')';
    //   } else {
    //     return SqlString.escape(value, false, this.options.timezone, this.dialect, field);
    //   }
    // }

  };

  return Utils._.extend(Utils._.clone(require('../abstract/query-generator')), QueryGenerator);
})();