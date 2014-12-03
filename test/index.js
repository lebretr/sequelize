// var chai        = require('chai')
//   , expect      = chai.expect
//   , assert      = chai.assert
//   , DataTypes   = require(__dirname + "/../lib/data-types")
//   , dialect     = 'oracle'
//   , _           = require('lodash')
//   , Sequelize   = require(__dirname + '/../index')
//   , Config      = require(__dirname + "/config/config")
//   , moment      = require('moment')
//   , Transaction = require(__dirname + '/../lib/transaction')
//   , path        = require('path')
//   , sinon       = require('sinon')



// var options = options || {}
// options.dialect = dialect

// var config = Config[options.dialect]

// options.logging = (options.hasOwnProperty('logging') ? options.logging : false)
// options.pool    = options.pool !== undefined ? options.pool : config.pool

// var sequelizeOptions = {
//   host:           options.host || config.host,
//   logging:        options.logging,
//   dialect:        options.dialect,
//   port:           options.port || process.env.SEQ_PORT || config.port,
//   pool:           options.pool,
//   dialectOptions: options.dialectOptions || {}
// }

// if (!!options.define) {
//   sequelizeOptions.define = options.define
// }

// if (!!config.storage) {
//   sequelizeOptions.storage = config.storage
// }

// if (process.env.DIALECT === 'postgres-native') {
//   sequelizeOptions.native = true
// }

// sequelizeOptions = sequelizeOptions || {}
// sequelizeOptions.dialect = sequelizeOptions.dialect 


// var sequelize= new Sequelize(config.database, config.username, config.password, sequelizeOptions);


// var qq = function(str) {
//   if (dialect == 'postgres' || dialect == 'sqlite' || dialect == 'oracle') {
//     return '"' + str + '"'
//   } else if (Support.dialectIsMySQL()) {
//     return '`' + str + '`'
//   } else {
//     return str
//   }
// }

          
//           	sequelize.transaction(function(t) {
//           		expect(t).to.be.instanceOf(Transaction)
          
//             })



      
