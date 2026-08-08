'use strict'

const deepEqual = require('fast-deep-equal')
const dnsEqual = require('./utils/dnsEqual')

module.exports = {
  /**
     * Whether b is already in the registry as a. Delegates to isSameRecord so that
     * "already registered" and "the record to remove" cannot disagree: comparing
     * names exactly here while unregister compared them case-insensitively meant
     * Foo.local and foo.local registered as two entries but unregistered as one.
     */
  isDuplicateRecord: function (a) {
    return module.exports.isSameRecord(a)
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
