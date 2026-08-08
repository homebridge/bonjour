'use strict'

const deepEqual = require('fast-deep-equal')
const dnsEqual = require('./utils/dnsEqual')

module.exports = {
  isDuplicateRecord: function (a) {
    return function (b) {
      return a.type === b.type &&
                a.name === b.name &&
                deepEqual(a.data, b.data)
    }
  },
  /**
     * Whether b is the same record as a: same type, same name (compared the way DNS
     * compares names, case-insensitively) and the same rdata.
     *
     * Names alone do not identify a record. Every service of the same type shares the
     * type PTR name, and every service on the host shares the A/AAAA name.
     */
  isSameRecord: function (a) {
    return function (b) {
      return a.type === b.type &&
                dnsEqual(a.name, b.name) &&
                deepEqual(a.data, b.data)
    }
  },
  unique: function () {
    const set = []
    return function (obj) {
      if (~set.indexOf(obj)) return false
      set.push(obj)
      return true
    }
  }
}
