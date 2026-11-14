'use strict'

const deepEqual = require('fast-deep-equal')
const dnsEqual = require('./utils/dnsEqual')

// A TXT record's data is text when the record is built, and bytes once it has been
// sent (encoding a packet swaps the text for bytes in place) or received. Compare
// what goes on the wire, or a stopped service's TXT record is never found again
// and stays behind, still answered for
function txtBlocks (data) {
  return [].concat(data).map(block => Buffer.from(block).toString('hex'))
}

// An SRV record read from the network always carries a priority and weight, which
// one built here leaves out (they mean 0). Compared field by field they never
// matched, so an SRV answer the querier already held was sent again every time
function sameSrv (a, b) {
  return Boolean(a && b) &&
    a.port === b.port &&
    dnsEqual(String(a.target), String(b.target)) &&
    (a.priority || 0) === (b.priority || 0) &&
    (a.weight || 0) === (b.weight || 0)
}

function sameData (type, a, b) {
  if (type === 'TXT') return deepEqual(txtBlocks(a), txtBlocks(b))
  if (type === 'SRV') return sameSrv(a, b)
  return deepEqual(a, b)
}

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
                sameData(a.type, a.data, b.data)
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
