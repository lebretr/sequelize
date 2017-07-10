var moment = require("moment")
  , isArrayBufferView
  , SqlString = exports;

if (typeof ArrayBufferView === 'function') {
  isArrayBufferView = function(object) { return object && (object instanceof ArrayBufferView) }
} else {
  var arrayBufferViews = [
    Int8Array, Uint8Array, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array
  ]
  isArrayBufferView = function(object) {
    for (var i=0; i<8; i++) {
      if (object instanceof arrayBufferViews[i]) {
        return true
      }
    }
    return false
  };
}


SqlString.escapeId = function (val, forbidQualified) {
  if (forbidQualified) {
    return '`' + val.replace(/`/g, '``') + '`'
  }
  return '`' + val.replace(/`/g, '``').replace(/\./g, '`.`') + '`'
}

SqlString.escape = function(val, stringifyObjects, timeZone, dialect, field) {
  if (arguments.length === 1 && typeof arguments[0] === "object") {
    val = val.val || val.value || null
    stringifyObjects = val.stringifyObjects || val.objects || undefined
    timeZone = val.timeZone || val.zone || null
    dialect = val.dialect || null
    field = val.field || null
  }
  else if (arguments.length < 3 && typeof arguments[1] === "object") {
    timeZone = stringifyObjects.timeZone || stringifyObjects.zone || null
    dialect = stringifyObjects.dialect || null
    field = stringifyObjects.field || null
  }

  if (dialect==='oracle' && (val === undefined || val === null)) {
    return 'CAST(NULL AS VARCHAR2(1))';
  }else if (val === undefined || val === null) {
    return 'NULL';
  }

  switch (typeof val) {
  case 'boolean':
    // SQLite doesn't have true/false support. MySQL aliases true/false to 1/0
    // for us. Postgres actually has a boolean type with true/false literals,
    // but sequelize doesn't use it yet.
    return dialect === 'sqlite' ? +!!val : ('' + !!val);
  case 'number':
    return val+'';
  }
  
  var newVal = val;
  if (val instanceof Date) {
    newVal = SqlString.dateToString(val, timeZone || "Z", dialect)
  }

  if (Buffer.isBuffer(newVal)) {
    return SqlString.bufferToString(newVal, dialect)
  }
  if (Array.isArray(newVal) || isArrayBufferView(newVal)) {
    return SqlString.arrayToList(newVal, timeZone, dialect, field)
  }

  if (typeof newVal === 'object') {
    if (stringifyObjects) {
      newVal = newVal.toString()
    } else {
      return SqlString.objectToValues(newVal, timeZone)
    }
  }

  if (dialect === 'postgres' || dialect === 'sqlite') {
    // http://www.postgresql.org/docs/8.2/static/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS
    // http://stackoverflow.com/q/603572/130598
    newVal = newVal.replace(/'/g, "''")
  }else {
    newVal = newVal.replace(/[\0\n\r\b\t\\\'\"\x1a]/g, function(s) {
      switch(s) {
        case "\0": return "\\0";
        case "\n": return "\\n";
        case "\r": return "\\r";
        case "\b": return "\\b";
        case "\t": return "\\t";
        case "\x1a": return "\\Z";
        default: return "\\"+s;
      }
    })
  }
  if(dialect === 'oracle' && val instanceof Date){
    return "TO_TIMESTAMP_TZ('"+newVal+"','YYYY-MM-DD HH24:MI:SS.FF3 TZH:TZM')";
  }else{
    return "'"+newVal+"'";
  }
  
}

SqlString.arrayToList = function(array, timeZone, dialect, field) {
  if (dialect === 'postgres') {
    if (array.map) {
      var valstr = array.map(function(v) {
        return SqlString.escape(v, true, timeZone, dialect, field)
      }).join(',')
    } else {
      var valstr = ""
      for (var i = 0; i < array.length; i++) {
        valstr += SqlString.escape(array[i], true, timeZone, dialect, field) + ','
      }
      valstr = valstr.slice(0,-1)
    }
    var ret = 'ARRAY[' + valstr + ']'
    if (!!field && !!field.type) {
      ret += '::' + field.type.replace(/\(\d+\)/g, '')
    }
    return ret
  } else {
    if (array.map) {
      return array.map(function(v) {
        if (Array.isArray(v)) {
          return '(' + SqlString.arrayToList(v, timeZone, dialect) + ')'
        }
        return SqlString.escape(v, true, timeZone, dialect)
      }).join(', ')
    } else {
      var valstr = ""
      for (var i = 0; i < array.length; i++) {
        valstr += SqlString.escape(array[i], true, timeZone, dialect) + ', '
      }
      return valstr.slice(0, -2)
    }
  }
}

SqlString.format = function(sql, values, timeZone, dialect) {
  values = [].concat(values);

  return sql.replace(/\?/g, function(match) {
    if (!values.length) {
      return match
    }

    return SqlString.escape(values.shift(), false, timeZone, dialect)
  })
}

SqlString.formatNamedParameters = function(sql, values, timeZone, dialect) {
  return sql.replace(/\:(?!\d)(\w+)/g, function (value, key) {
    if (values.hasOwnProperty(key)) {
      return SqlString.escape(values[key], false, timeZone, dialect)
    } else {
      throw new Error('Named parameter "' + value + '" has no value in the given object.')
    }
  })
}

SqlString.dateToString = function(date, timeZone, dialect) {
  date = moment(date).zone(timeZone);

  if (dialect === 'mysql' || dialect === 'mariadb') {
    return date.format('YYYY-MM-DD HH:mm:ss');
  } else {
    // ZZ here means current timezone, _not_ UTC
    return date.format('YYYY-MM-DD HH:mm:ss.SSS Z');
  }
}

SqlString.bufferToString = function(buffer, dialect) {
  var hex = ''
  try {
    hex = buffer.toString('hex')
  } catch (err) {
    // node v0.4.x does not support hex / throws unknown encoding error
    for (var i = 0; i < buffer.length; i++) {
      var byte = buffer[i]
      hex += zeroPad(byte.toString(16))
    }
  }

  if (dialect === 'postgres') {
    // bytea hex format http://www.postgresql.org/docs/current/static/datatype-binary.html
    return "E'\\\\x" + hex+ "'"
  }
  return "X'" + hex+ "'"
}

SqlString.objectToValues = function(object, timeZone) {
  var values = []
  for (var key in object) {
    var value = object[key]
    if(typeof value === 'function') {
      continue;
    }

    values.push(this.escapeId(key) + ' = ' + SqlString.escape(value, true, timeZone))
  }

  return values.join(', ')
}

function zeroPad(number) {
  return (number < 10) ? '0' + number : number
}
