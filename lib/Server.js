'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const multicastdns = require('multicast-dns')
const dnsPacket = require('dns-packet')
const dnsEqual = require('./utils/dnsEqual')
const helpers = require('./helpers.js')

// The largest reply that fits in one Ethernet frame, after the IPv6 and UDP headers
const MAX_PACKET_SIZE = 1500 - 40 - 8
const MDNS_PORT = 5353
// RFC 6762 section 6.7: records in a reply to a one-shot lookup live at most 10 seconds
const LEGACY_UNICAST_TTL = 10

const Server = function (opts) {
  EventEmitter.call(this)
  this.mdns = multicastdns(opts)
  // The port mDNS runs on: a query from any other port is a one-shot lookup
  this._port = (opts && opts.port) || MDNS_PORT
  this.mdns.setMaxListeners(0)
  this.registry = {}
  this.mdns.on('query', this._respondToQuery.bind(this))
  this.mdns.on('error', err => this.emit('error', err))
}

util.inherits(Server, EventEmitter)

Object.assign(Server.prototype, {
  _respondToQuery: function (query, rinfo) {
    // Answer every question in one packet, not one packet per question - a browser
    // asking for a host's A and AAAA records in one query got two replies
    const responses = []

    for (let i = 0; i < query.questions.length; i++) {
      const response = this._answer(query.questions[i])
      if (response) responses.push(response)
    }

    if (responses.length === 0) return

    const combined = combine(responses)
    // A combined packet that would no longer fit in one Ethernet frame goes out as
    // the separate replies it was made from, so this is never worse than before
    const packets = responses.length > 1 && dnsPacket.encodingLength(combined) > MAX_PACKET_SIZE
      ? responses
      : [combined]

    // A query from a port other than the mDNS one is a one-shot lookup (a plain DNS
    // resolver pointed at the multicast address). It is not listening for multicast,
    // so the reply has to go straight back to it, or it never gets one (RFC 6762 6.7)
    const legacy = rinfo && rinfo.port !== this._port

    packets.forEach(packet => {
      const onSent = err => {
        if (err) this.emit('error', err)
      }
      if (legacy) {
        this.mdns.respond(legacyUnicast(packet, query), { address: rinfo.address, port: rinfo.port }, onSent)
      } else {
        this.mdns.respond(packet, onSent)
      }
    })
  },

  // The answers and additionals for one question, or undefined when there are none
  _answer: function (question) {
    const type = question.type
    const name = question.name

    // generate the answers section
    const answers = type === 'ANY'
      ? Object.keys(this.registry).map(this._recordsFor.bind(this, name)).flat()
      : this._recordsFor(name, type)

    if (answers.length === 0) return undefined

    // generate the additionals section
    let additionals = []
    if (type !== 'ANY') {
      answers.forEach(answer => {
        if (answer.type !== 'PTR') return
        additionals = additionals
          .concat(this._recordsFor(answer.data, 'SRV'))
          .concat(this._recordsFor(answer.data, 'TXT'))
      })

      // to populate the A and AAAA records, we need to get a set of unique
      // targets from the SRV record
      additionals
        .filter(record => {
          return record.type === 'SRV'
        })
        .map(record => {
          return record.data.target
        })
        .filter(helpers.unique())
        .forEach(target => {
          additionals = additionals
            .concat(this._recordsFor(target, 'A'))
            .concat(this._recordsFor(target, 'AAAA'))
        })
    }

    return { answers, additionals }
  },

  register: function (records) {
    if (!Array.isArray(records)) { records = [records] }

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      let subRegistry = this.registry[record.type]

      if (!subRegistry) {
        subRegistry = this.registry[record.type] = []
      } else if (subRegistry.some(helpers.isDuplicateRecord(record))) {
        continue
      }

      subRegistry.push(record)
    }
  },

  unregister: function (records) {
    if (!Array.isArray(records)) { records = [records] }

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const type = record.type

      if (!(type in this.registry)) { continue }

      // Match the rdata too, not just the name. Records legitimately share a name:
      // every service of the same type shares the type PTR name, and every service on
      // the host shares the A/AAAA name. Removing by name alone meant unpublishing one
      // service also dropped the other services' records, and they stayed missing
      // until their own next re-announce - which backs off up to an hour.
      const isSameRecord = helpers.isSameRecord(record)
      this.registry[type] = this.registry[type].filter(r => !isSameRecord(r))
    }
  },

  _recordsFor: function (name, type) {
    if (!(type in this.registry)) { return [] }

    return this.registry[type].filter(record => {
      const recordName = ~name.indexOf('.') ? record.name : record.name.split('.')[0]
      return dnsEqual(recordName, name)
    })
  }

})

// A reply shaped for a one-shot lookup: it carries the query's id and questions,
// like a normal DNS answer, and its records are short-lived copies without the
// cache-flush bit, which only means something to mDNS caches (RFC 6762 6.7, 10.2)
function legacyUnicast (packet, query) {
  const copy = record => Object.assign({}, record, {
    ttl: Math.min(record.ttl, LEGACY_UNICAST_TTL),
    flush: false
  })
  return {
    id: query.id,
    questions: query.questions,
    answers: packet.answers.map(copy),
    additionals: packet.additionals.map(copy)
  }
}

// Merge replies into one, each record once: a record answering one question is
// not repeated as an additional for another
function combine (responses) {
  const answers = []
  const additionals = []
  responses.forEach(response => {
    response.answers.forEach(record => {
      if (!answers.includes(record)) answers.push(record)
    })
  })
  responses.forEach(response => {
    response.additionals.forEach(record => {
      if (!answers.includes(record) && !additionals.includes(record)) additionals.push(record)
    })
  })
  return { answers, additionals }
}

module.exports = Server
