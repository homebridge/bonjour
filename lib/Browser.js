'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const serviceName = require('multicast-dns-service-types')
const deepEqual = require('fast-deep-equal')
const dnsEqual = require('./utils/dnsEqual')
const dnsTxt = require('./utils/txtDecoder')

const TLD = '.local'
const WILDCARD = '_services._dns-sd._udp' + TLD

module.exports = Browser

util.inherits(Browser, EventEmitter)

/**
 * Start a browser
 *
 * The browser listens for services by querying for PTR records of a given
 * type, protocol and domain, e.g. _http._tcp.local.
 *
 * If no type is given, a wild card search is performed.
 *
 * An internal list of online services is kept which starts out empty. When
 * ever a new service is discovered, it's added to the list and an "up" event
 * is emitted with that service. When it's discovered that the service is no
 * longer available, it is removed from the list and a "down" event is emitted
 * with that service.
 */
function Browser (mdns, opts, onup) {
  if (typeof opts === 'function') return new Browser(mdns, null, opts)

  EventEmitter.call(this)

  this._mdns = mdns
  this._onresponse = null
  this._serviceMap = {}
  // Address records seen in any packet, by lower-case hostname: { address: expiry in ms }.
  // A response for many services on one host can span several packets, and only the
  // first may carry the host's A/AAAA records (#12) - so they have to be remembered.
  this._addressCache = {}
  // Hostnames already asked for their addresses, so each is only queried once
  this._addressQueries = {}
  // Timers that re-ask for a service before its PTR record runs out, then drop it
  // when nothing answered: by lower-case fqdn
  this._expiryTimers = {}
  // When each browsed name was last asked for, so services sharing it share a query
  this._lastQueried = {}
  this._txt = dnsTxt(opts && opts.txt)

  if (!opts || !opts.type) {
    this._name = WILDCARD
    this._wildcard = true
  } else {
    this._name = serviceName.stringify(opts.type, opts.protocol || 'tcp') + TLD
    if (opts.name) this._name = opts.name + '.' + this._name
    this._wildcard = false
  }

  this.services = []

  if (onup) this.on('up', onup)

  this.start()
}

Browser.prototype.start = function () {
  if (this._onresponse) return

  const self = this

  // List of names for the browser to listen for. In a normal search this will
  // be the primary name stored on the browser. In case of a wildcard search
  // the names will be determined at runtime as responses come in.
  const nameMap = {}
  if (!this._wildcard) nameMap[this._name] = true

  this._onresponse = function (packet, rinfo) {
    if (self._wildcard) {
      packet.answers.forEach(function (answer) {
        if (answer.type !== 'PTR' || !dnsEqual(answer.name, self._name) || answer.data in nameMap) return
        nameMap[answer.data] = true
        self._mdns.query(answer.data, 'PTR')
      })
    }

    // Every record in the packet, built once: in a wildcard search each browsed
    // name used to rebuild this list several times over for every packet
    const records = packet.answers.concat(packet.additionals)
    const liveRecords = records.filter(function (rr) { return rr.ttl > 0 }) // not goodbyes

    const hosts = self._cacheAddresses(records)
    const cachedAddresses = self._cachedAddresses.bind(self)
    // Services this packet's PTRs already updated, by lower-case fqdn
    const updated = {}

    Object.keys(nameMap).forEach(function (name) {
      // unregister all services shutting down
      goodbyes(name, records).forEach(self._removeService.bind(self))

      // register all new services
      const matches = buildServicesFor(name, liveRecords, self._txt, rinfo, cachedAddresses)
      if (matches.length === 0) return

      matches.forEach(function (service) {
        updated[service.fqdn.toLowerCase()] = true
        if (self._serviceMap[service.fqdn]) {
          self._updateService(service)
        } else {
          self._addService(service)
        }
      })

      // Each PTR seen restarts its service's clock (RFC 6762 5.2)
      liveRecords.forEach(function (rr) {
        if (rr.type === 'PTR' && dnsEqual(rr.name, name)) {
          self._scheduleExpiry(name, rr.data, rr.ttl)
        }
      })
    })

    // A service's TXT or SRV can change on its own, in a packet without the PTR -
    // a changed TXT is announced alone. Apply those to the services already known
    liveRecords.forEach(function (rr) {
      if ((rr.type !== 'TXT' && rr.type !== 'SRV') || updated[rr.name.toLowerCase()]) return
      const known = self.services.find(function (service) { return dnsEqual(service.fqdn, rr.name) })
      if (!known) return
      const service = Object.assign({}, known)
      if (rr.type === 'TXT') {
        service.rawTxt = rr.data
        service.txt = self._txt.decodeBlocks(rr.data)
      } else {
        service.port = rr.data.port
        if (!dnsEqual(service.host, rr.data.target)) {
          service.host = rr.data.target
          service.addresses = cachedAddresses(service.host)
        }
      }
      self._updateService(service)
    })

    // An address can also arrive after its service, in a later packet - give it
    // to any service still waiting for one, and ask for the rest
    self.services.forEach(function (service) {
      if (service.addresses.length > 0 || !service.host) return
      const addresses = hosts.includes(service.host.toLowerCase()) ? cachedAddresses(service.host) : []
      if (addresses.length > 0) {
        self._updateService(Object.assign({}, service, { addresses }))
      } else {
        self._queryAddresses(service.host)
      }
    })
  }

  this._mdns.on('response', this._onresponse)
  this.update()
}

Browser.prototype.stop = function () {
  if (!this._onresponse) return

  this._mdns.removeListener('response', this._onresponse)
  this._onresponse = null
  Object.keys(this._expiryTimers).forEach(this._clearExpiry.bind(this))
}

// The longest a Node timer can wait; anything longer fires immediately
const MAX_TIMER_MS = 2147483647

// A service that vanishes without a goodbye (a crash, a pulled cable) used to stay
// in the list forever. Ask for it again at 80% and 90% of its PTR's ttl, and drop
// it at 100% if nothing has answered by then (RFC 6762 5.2)
Browser.prototype._scheduleExpiry = function (name, fqdn, ttl) {
  const self = this
  const key = fqdn.toLowerCase()
  this._clearExpiry(key)
  const ms = Math.min(ttl * 1000, MAX_TIMER_MS)
  // Services announced together reach 80% within moments of each other
  const sameMoment = Math.min(ms * 0.05, 1000)
  const timers = [
    setTimeout(function () { self._requery(name, sameMoment) }, ms * 0.8),
    setTimeout(function () { self._requery(name, sameMoment) }, ms * 0.9),
    setTimeout(function () {
      delete self._expiryTimers[key]
      self._removeService(fqdn)
    }, ms)
  ]
  timers.forEach(function (timer) { timer.unref() })
  this._expiryTimers[key] = timers
}

Browser.prototype._clearExpiry = function (key) {
  const timers = this._expiryTimers && this._expiryTimers[key]
  if (!timers) return
  timers.forEach(clearTimeout)
  delete this._expiryTimers[key]
}

// One query covers every service of a name, so services that reach their re-query
// point at the same moment (within `window` ms) share it
Browser.prototype._requery = function (name, window) {
  const now = Date.now()
  if (this._lastQueried[name] && now - this._lastQueried[name] < window) return
  this._lastQueried[name] = now
  this._mdns.query(name, 'PTR')
}

Browser.prototype.update = function () {
  this._mdns.query(this._name, 'PTR')
}

// Remember the A/AAAA records in a packet, forgetting any the host says goodbye to
// (a ttl of 0). Returns the hostnames whose records changed.
Browser.prototype._cacheAddresses = function (records) {
  const self = this
  const now = Date.now()
  const hosts = []

  records.forEach(function (rr) {
    if (rr.type !== 'A' && rr.type !== 'AAAA') return
    const host = rr.name.toLowerCase()
    const addresses = self._addressCache[host] || (self._addressCache[host] = {})
    if (rr.ttl > 0) {
      addresses[rr.data] = now + rr.ttl * 1000
      delete self._addressQueries[host]
    } else {
      delete addresses[rr.data]
    }
    if (!hosts.includes(host)) hosts.push(host)
  })

  return hosts
}

// The addresses remembered for a host that have not yet expired
Browser.prototype._cachedAddresses = function (host) {
  const addresses = this._addressCache[host.toLowerCase()]
  if (!addresses) return []
  const now = Date.now()
  return Object.keys(addresses).filter(function (address) {
    if (addresses[address] > now) return true
    delete addresses[address]
    return false
  })
}

// Ask the network for a host's addresses, once, when no packet has carried them
Browser.prototype._queryAddresses = function (host) {
  const key = host.toLowerCase()
  if (this._addressQueries[key]) return
  this._addressQueries[key] = true
  this._mdns.query([
    { name: host, type: 'A' },
    { name: host, type: 'AAAA' }
  ])
}

Browser.prototype._addService = function (service) {
  this.services.push(service)
  this._serviceMap[service.fqdn] = true
  this.emit('up', service)
}

Browser.prototype._updateService = function (service) {
  let cachedService, index
  this.services.some(function (s, i) {
    if (dnsEqual(s.fqdn, service.fqdn)) {
      cachedService = s
      index = i
      return true
    }
    return false
  })
  if (!cachedService) return
  if (!serviceChanged(cachedService, service)) return
  this.services[index] = service
  this.emit('update', service)
}

function serviceChanged (a, b) {
  return a.host !== b.host ||
    a.port !== b.port ||
    !deepEqual(a.addresses, b.addresses) ||
    !deepEqual(a.subtypes, b.subtypes) ||
    !deepEqual(a.txt, b.txt)
}

Browser.prototype._removeService = function (fqdn) {
  let service, index
  this.services.some(function (s, i) {
    if (dnsEqual(s.fqdn, fqdn)) {
      service = s
      index = i
      return true
    }
    return false
  })
  if (!service) return
  this._clearExpiry(service.fqdn.toLowerCase())
  this.services.splice(index, 1)
  // Delete the key that was actually inserted. The map is keyed by the fqdn as it was
  // announced, but the lookup above is case-insensitive, so a goodbye with different
  // casing removed the service from the list while leaving its map key behind. The
  // service then looked cached forever: a later re-announcement took the update path,
  // found nothing in the list, and returned - so 'up' never fired again.
  delete this._serviceMap[service.fqdn]
  this.emit('down', service)
}

// PTR records with a TTL of 0 is considered a "goodbye" announcement. I.e. a
// DNS response broadcasted when a service shuts down in order to let the
// network know that the service is no longer going to be available.
//
// For more info see:
// https://tools.ietf.org/html/rfc6762#section-8.4
//
// This function returns an array of all resource records considered a goodbye
// record
function goodbyes (name, records) {
  return records
    .filter(function (rr) {
      return rr.type === 'PTR' && rr.ttl === 0 && dnsEqual(rr.name, name)
    })
    .map(function (rr) {
      return rr.data
    })
}

// records: the packet's records, goodbyes already left out
function buildServicesFor (name, records, txt, referer, cachedAddresses) {
  return records
    .filter(function (rr) {
      return rr.type === 'PTR' && dnsEqual(rr.name, name)
    })
    .map(function (ptr) {
      const service = {
        addresses: []
      }

      records
        .filter(function (rr) {
          return (rr.type === 'SRV' || rr.type === 'TXT') && dnsEqual(rr.name, ptr.data)
        })
        .forEach(function (rr) {
          if (rr.type === 'SRV') {
            const parts = rr.name.split('.')
            const name = parts[0]
            const types = serviceName.parse(parts.slice(1, -1).join('.'))
            service.name = name
            service.fqdn = rr.name
            service.host = rr.data.target
            service.referer = referer
            service.port = rr.data.port
            service.type = types.name
            service.protocol = types.protocol
            service.subtypes = types.subtypes
          } else if (rr.type === 'TXT') {
            // rr.data is an Array of Buffer instead of Buffer
            service.rawTxt = rr.data // array of buffers, each representing a block
            service.txt = txt.decodeBlocks(service.rawTxt)
          }
        })

      if (!service.name) return undefined

      records
        .filter(function (rr) {
          return (rr.type === 'A' || rr.type === 'AAAA') && dnsEqual(rr.name, service.host)
        })
        .forEach(function (rr) {
          service.addresses.push(rr.data)
        })

      // No address in this packet: use the ones an earlier packet carried
      if (service.addresses.length === 0 && cachedAddresses) {
        service.addresses = cachedAddresses(service.host)
      }

      return service
    })
    .filter(function (rr) {
      return !!rr
    })
}
