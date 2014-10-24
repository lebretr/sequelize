var _ = require('lodash')
  , Abstract = require('../abstract')

var OracleDialect = function(sequelize) {
  this.sequelize = sequelize
}

OracleDialect.prototype.supports = _.defaults({
	//'RETURNING': true,
	'VALUES ()': true
}, Abstract.prototype.supports)

module.exports = OracleDialect
