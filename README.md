# Sequelize [![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/lebretr/sequelize-oracle/trend.png)](https://bitdeli.com/free "Bitdeli Badge") [![Build Status](https://travis-ci.org/lebretr/sequelize-oracle.svg?branch=1.7.0-Oracle)](https://travis-ci.org/lebretr/sequelize-oracle) [![Dependency Status](https://david-dm.org/lebretr/sequelize-oracle.png)](https://david-dm.org/lebretr/sequelize-oracle) [![Code Climate](https://codeclimate.com/github/lebretr/sequelize-oracle/badges/gpa.svg)](https://codeclimate.com/github/lebretr/sequelize-oracle) [![Test Coverage](https://codeclimate.com/github/lebretr/sequelize-oracle/badges/coverage.svg)](https://codeclimate.com/github/lebretr/sequelize-oracle)

MySQL, MariaDB, PostgresSQL, SQLite and Oracle Object Relational Mapper (ORM) for [node](http://nodejs.org).

### Note
sequelize-oracle is a fork of [sequelize@1.7.0](https://github.com/sequelize/sequelize/tree/1.7.0)  
this fork add support of DML statements for Oracle  
If you don't need Oracle support, prefer the original [Sequelize](http://sequelizejs.com/)  

### Test passed on Oracle 11G XE:
  * configuration.test.js: 100%
  * data-types.test.js: 100%
  * language.test.js: 100%
  * query-chainer.test.js: 100%
  * sequelize.test.js: All except Transaction
  * transaction-manager.test.js: 100%
  * utils.test.js: 100%
  * dao/values.test.js: 100%
  * emitters/custom-event-emitter.test.js: 100%