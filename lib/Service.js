'use strict'

const os = require('os')
const util = require('util')
const net = require('net')
const assert = require('assert')
const EventEmitter = require('events').EventEmitter
const serviceName = require('multicast-dns-service-types')
const network = require('./utils/network')

const TLD = '.local'
const REANNOUNCE_MAX_MS = 60 * 60 * 1000
const REANNOUNCE_FACTOR = 3
// How often to look for a change of address (a new DHCP lease, a move between networks)
const ADDRESS_CHECK_MS = 60 * 1000

// DNS sends a name as parts ("labels") split at the dots, each at most 63 bytes.
// A longer one went out as a packet no other device could read, without any error
const MAX_LABEL_BYTES = 63

function checkLabels (what, name) {
  for (const label of String(name).split('.')) {
    if (Buffer.byteLength(label) > MAX_LABEL_BYTES) {
      throw new Error(`Service ${what} "${name}" is longer than ${MAX_LABEL_BYTES} bytes`)
    }
  }
}

// A TXT record is a list of "key=value" entries, each at most 255 bytes. A longer
// one also went out as an unreadable packet
const MAX_TXT_ENTRY_BYTES = 255

function txtEntries (txt) {
  return Object.keys(txt || {}).map(key => {
    const entry = key + '=' + txt[key]
    if (Buffer.byteLength(entry) > MAX_TXT_ENTRY_BYTES) {
      throw new Error(`TXT entry "${key}" is longer than ${MAX_TXT_ENTRY_BYTES} bytes`)
    }
    return entry
  })
}

const Service = function (opts) {
  if (!opts.name) throw new Error('Required name not given')
  if (!opts.type) throw new Error('Required type not given')
  if (!opts.port) throw new Error('Required port not given')

  this.name = opts.name
  this.protocol = opts.protocol || 'tcp'
  this.probe = opts.probe !== false
  this.type = serviceName.stringify(opts.type, this.protocol)
  this.host = opts.host || os.hostname()
  checkLabels('name', this.name)
  checkLabels('host', this.host)
  this.port = opts.port
  this.fqdn = this.name + '.' + this.type + TLD
  this.subtypes = opts.subtypes || null
  txtEntries(opts.txt) // throws when an entry is too long
  this.txt = opts.txt || null
  this.published = false

  // adds the meta query to the records array
  // this option can only be turned on if only one service is advertised on the responder
  // otherwise it will break when one service is removed from the network
  this.addUnsafeServiceEnumerationRecord = opts.addUnsafeServiceEnumerationRecord || false

  this.restrictedAddresses = undefined
  if (opts.restrictedAddresses) {
    assert(opts.restrictedAddresses.length, "The service property 'restrictedAddresses' cannot be an empty array!")
    this.restrictedAddresses = new Map()

    for (const entry of opts.restrictedAddresses) {
      if (net.isIP(entry)) {
        if (entry === '0.0.0.0' || entry === '::') {
          throw new Error(`[${this.fqdn}] Unspecified ip address (${entry}) cannot be used to restrict on to!`)
        }

        const interfaceName = network.resolveInterface(entry)
        if (!interfaceName) {
          throw new Error(`[${this.fqdn}] Could not restrict service to address ${entry} as we could not resolve it to an interface name!`)
        }

        const current = this.restrictedAddresses.get(interfaceName)
        if (current) {
          // empty interface signals "catch all" was already configured for this
          if (current.length && !current.includes(entry)) {
            current.push(entry)
          }
        } else {
          this.restrictedAddresses.set(interfaceName, [entry])
        }
      } else {
        this.restrictedAddresses.set(entry, []) // empty array signals "use all addresses for interface"
      }
    }
  }

  this.disabledIpv6 = opts.disabledIpv6 || false

  this._activated = false // indicates intent - true: starting/started, false: stopping/stopped
  this._announced = false // whether its records have gone out to the network since it started
}

util.inherits(Service, EventEmitter)

Object.assign(Service.prototype, {

  start: function () {
    if (this._activated) { return }

    this._activated = true

    this.emit('service-publish', this)
  },

  stop: function (cb) {
    if (!this._activated) {
      if (cb) cb()
      return
    }

    this.emit('service-unpublish', this, cb)
  },

  updateTxt: function (txt, silent) {
    txtEntries(txt) // throws when an entry is too long, before anything changes
    this.txt = txt

    // Nothing of this service is on the network (not started, still probing, or
    // stopped): just rebuild the records at the next announcement. Withdrawing the
    // old ones here took the address records away from every other service on the
    // host, which shares them
    if (!this._announced) {
      this.packet = null
      return
    }

    // Swap the old records for the new ones in one go, also when the first
    // announcement is still on its way out. Dropping the old ones without
    // announcing the new left the service with no records at all, and its next
    // re-announcement crashed the process
    this.emit('service-packet-change', this.packet)
    this.packet = null

    // Announce the new TXT, restarting the announcement schedule. The service stays
    // published throughout - marking it unpublished first made every TXT update
    // fire 'up' again, as though the service had only just come online
    this.announce(silent)
  },

  announce: function (silent) {
    if (this._destroyed) { return }

    if (!this.packet) { this.packet = this._records() }

    // From here the network may know these records, so stopping has to withdraw them
    this._announced = true
    this._watchAddresses()

    if (this.timer) { clearTimeout(this.timer) }

    this.delay = 1000
    this._emitAnnounce(silent)
  },

  _emitAnnounce: function (silent) {
    if (this._destroyed) { return }
    this.emit('service-announce-request', this.packet, silent || false, this.onAnnounceComplete.bind(this))
  },

  onAnnounceComplete: function () {
    if (this._destroyed || !this._activated) return

    if (!this.published) {
      this.published = true
      this.emit('up')
      // An 'up' listener may have stopped the service: scheduling the next
      // re-announcement regardless put its records back 3 seconds later
      if (this._destroyed || !this._activated) return
    }

    // Two announcements can be in flight at once (a TXT update sent while another
    // was still going out): keep one re-announcement schedule, not one for each
    if (this.timer) { clearTimeout(this.timer) }

    this.delay = this.delay * REANNOUNCE_FACTOR
    if (this.delay < REANNOUNCE_MAX_MS) {
      this.timer = setTimeout(this._emitAnnounce.bind(this), this.delay).unref()
    } else {
      this.timer = undefined
      this.delay = undefined
    }
  },

  deactivate: function () {
    this._unpublish()
    this._stopWatchingAddresses()
    this._activated = false
    this._announced = false
    // Built again at the next start: the old list held the addresses of that time,
    // and a restarted service announced them until the next address check
    this.packet = null
  },

  destroy: function () {
    this._unpublish()
    this._stopWatchingAddresses()
    this.removeAllListeners()
    this._destroyed = true
  },

  // The address records are worked out once, at the first announcement, and the
  // re-announcements stop after an hour - so when the host's address changed, the
  // old one was advertised until a restart. Check now and then, and announce the
  // new addresses when they change: they carry the cache-flush bit, so listeners
  // drop the old ones
  _watchAddresses: function () {
    if (this._addressTimer) return
    this._addressTimer = setInterval(this._checkAddresses.bind(this), ADDRESS_CHECK_MS)
    this._addressTimer.unref()
  },

  _stopWatchingAddresses: function () {
    if (!this._addressTimer) return
    clearInterval(this._addressTimer)
    this._addressTimer = undefined
  },

  _checkAddresses: function () {
    if (!this.packet || this._destroyed || !this._activated) return

    const addressesOf = records => records
      .filter(record => record.type === 'A' || record.type === 'AAAA')
      .map(record => record.data)
      .sort()
    const announced = addressesOf(this.packet)
    const current = addressesOf(this._addressRecords())
    if (announced.length === current.length && announced.every((address, i) => address === current[i])) return

    this.emit('service-packet-change', this.packet)
    this.packet = null
    this.announce()
  },

  _unpublish: function () {
    if (this.timer) { clearTimeout(this.timer) }

    this.published = false
  },

  _records: function () {
    const records = [this._rrPtr(), this._rrSrv(), this._rrTxt()]

    records.push(...this._addressRecords())

    if (this.addUnsafeServiceEnumerationRecord) {
      records.push(this._rrMetaPtr())
    }

    return records
  },

  _addressRecords: function () {
    const records = []
    const addresses = []

    Object.entries(os.networkInterfaces()).forEach(([name, interfaces]) => {
      let restrictedAddresses = this.restrictedAddresses ? this.restrictedAddresses.get(name) : undefined
      if (this.restrictedAddresses && !restrictedAddresses) {
        return
      }

      if (restrictedAddresses && restrictedAddresses.length === 0) {
        restrictedAddresses = undefined
      }

      interfaces.forEach(iface => {
        if (iface.internal || addresses.includes(iface.address)) {
          return
        }

        // Restricted to particular addresses on this interface: advertise only those.
        // This was inverted, so a service bound to an IP advertised every other
        // address on the interface and never the one it was actually listening on.
        if (restrictedAddresses && !restrictedAddresses.includes(iface.address)) {
          return
        }

        if (iface.family === 'IPv4') {
          records.push(this._rrA(iface.address))
          addresses.push(iface.address)
        } else if (!this.disabledIpv6) {
          records.push(this._rrAaaa(iface.address))
          addresses.push(iface.address)
        }
      })
    })

    return records
  },

  _rrMetaPtr: function () {
    return {
      name: '_services._dns-sd._udp.local',
      type: 'PTR',
      ttl: 4500,
      data: this.type + TLD
    }
  },

  _rrPtr: function () {
    return {
      name: this.type + TLD,
      type: 'PTR',
      ttl: 4500,
      data: this.fqdn
    }
  },

  _rrSrv: function () {
    return {
      name: this.fqdn,
      type: 'SRV',
      ttl: 120,
      flush: true,
      data: {
        port: this.port,
        target: this.host
      }
    }
  },

  _rrTxt: function () {
    const data = txtEntries(this.txt)
    // A TXT record with nothing to say still holds one empty entry, a single zero
    // byte: a record with no data at all is not allowed (RFC 6763 section 6.1)
    if (data.length === 0) { data.push('') }
    return {
      name: this.fqdn,
      type: 'TXT',
      ttl: 4500,
      flush: true,
      data
    }
  },

  _rrA: function (ip) {
    return {
      name: this.host,
      type: 'A',
      ttl: 120,
      flush: true,
      data: ip
    }
  },

  _rrAaaa: function (ip) {
    return {
      name: this.host,
      type: 'AAAA',
      ttl: 120,
      flush: true,
      data: ip
    }
  }

})

module.exports = Service
