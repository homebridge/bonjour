'use strict'

const dgram = require('dgram')
const tape = require('tape')
const Bonjour = require('../')
const Service = require('../lib/Service.js')
const Prober = require('../lib/Prober.js')

const port = function (cb) {
  const s = dgram.createSocket('udp4')
  s.bind(0, function () {
    const p = s.address().port
    s.on('close', function () { cb(p) })
    s.close()
  })
}

// === e141abf — Server: continue past unanswered questions in multi-question queries ===

tape('Server still answers later questions when an earlier one has no records', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server
    server.register({ name: 'Hit._tcp.local', type: 'PTR', ttl: 120, data: 'instance._tcp.local' })

    const responses = []
    server.mdns.respond = function (pkt) { responses.push(pkt) }

    server._respondToQuery({
      questions: [
        { name: 'Miss._tcp.local', type: 'PTR' },
        { name: 'Hit._tcp.local', type: 'PTR' }
      ]
    })

    t.equal(responses.length, 1, 'matched question still got a response')
    t.equal(responses[0].answers[0].name, 'Hit._tcp.local')
    bonjour.destroy(function () { t.end() })
  })
})

tape('Server answers each question independently in multi-question packets', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server
    server.register([
      { name: 'A._tcp.local', type: 'PTR', ttl: 120, data: 'a' },
      { name: 'B._tcp.local', type: 'PTR', ttl: 120, data: 'b' }
    ])

    const responses = []
    server.mdns.respond = function (pkt) { responses.push(pkt) }

    server._respondToQuery({
      questions: [
        { name: 'A._tcp.local', type: 'PTR' },
        { name: 'B._tcp.local', type: 'PTR' }
      ]
    })

    t.equal(responses.length, 2, 'one response per matched question')
    t.equal(responses[0].answers[0].name, 'A._tcp.local')
    t.equal(responses[1].answers[0].name, 'B._tcp.local')
    bonjour.destroy(function () { t.end() })
  })
})

// === 4a620ff — Browser: handle null opts in constructor ===

tape('Browser does not throw when opts is explicitly null', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    t.doesNotThrow(function () { bonjour.find(null, function () {}) })
    bonjour.destroy(function () { t.end() })
  })
})

tape('Browser supports the find(fn) shorthand (recurses with null opts)', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    // eslint-disable-next-line array-callback-return
    t.doesNotThrow(function () { bonjour.find(function () {}) })
    bonjour.destroy(function () { t.end() })
  })
})

// === 5d21b57 — Service.stop() callback truly optional ===

tape('Service.stop() does not throw when called without callback on inactive service', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  t.equal(s._activated, false, 'precondition: service is inactive')
  t.doesNotThrow(function () { s.stop() })
  t.end()
})

tape('Service.stop(cb) on inactive service still invokes the callback', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  s.stop(function () {
    t.pass('callback fired')
    t.end()
  })
})

// === 3138182 — Server.unregister: case-insensitive name comparison ===

tape('Server.unregister matches names case-insensitively', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server
    server.register({ name: 'Foo._TCP.local', type: 'PTR', ttl: 120, data: 'x' })
    t.equal(server.registry.PTR.length, 1, 'precondition: registered')
    server.unregister({ name: 'foo._tcp.LOCAL', type: 'PTR', ttl: 120, data: 'x' })
    t.equal(server.registry.PTR.length, 0, 'removed despite different casing')
    bonjour.destroy(function () { t.end() })
  })
})

tape('Server.unregister leaves non-matching records intact', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server
    server.register([
      { name: 'A._tcp.local', type: 'PTR', ttl: 120, data: 'a' },
      { name: 'B._tcp.local', type: 'PTR', ttl: 120, data: 'b' }
    ])
    server.unregister({ name: 'a._TCP.LOCAL', type: 'PTR', ttl: 120, data: 'a' })
    t.equal(server.registry.PTR.length, 1, 'one record left')
    t.equal(server.registry.PTR[0].name, 'B._tcp.local', 'B was not removed')
    bonjour.destroy(function () { t.end() })
  })
})

// === 8d8d9aa — Browser: wildcard meta-PTR name comparison is case-insensitive ===

tape('Browser wildcard accepts a meta-enumeration PTR with mixed-case name', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const queries = []
    bonjour._server.mdns.query = function (name, type) { queries.push({ name, type }) }

    const browser = bonjour.find()
    queries.length = 0

    browser._onresponse({
      answers: [{ type: 'PTR', name: '_Services._DNS-SD._UDP.local', data: '_http._tcp.local' }],
      additionals: []
    }, { address: '127.0.0.1', port: 5353 })

    t.ok(queries.some(function (q) { return q.name === '_http._tcp.local' }),
      'queried for the service type carried by a mixed-case meta-PTR')
    bonjour.destroy(function () { t.end() })
  })
})

// === 61d9f11 — Browser: dedup wildcard PTR queries by service type, not parent name ===

tape('Browser wildcard does not re-query for an already-discovered service type', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const queries = []
    bonjour._server.mdns.query = function (name, type) { queries.push({ name, type }) }

    const browser = bonjour.find()
    queries.length = 0

    const packet = {
      answers: [{ type: 'PTR', name: '_services._dns-sd._udp.local', data: '_http._tcp.local' }],
      additionals: []
    }
    browser._onresponse(packet, { address: '127.0.0.1', port: 5353 })
    browser._onresponse(packet, { address: '127.0.0.1', port: 5353 })

    const httpQueries = queries.filter(function (q) { return q.name === '_http._tcp.local' })
    t.equal(httpQueries.length, 1, 'second identical PTR did not trigger another query')
    bonjour.destroy(function () { t.end() })
  })
})

tape('Browser wildcard still queries for distinct service types', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const queries = []
    bonjour._server.mdns.query = function (name, type) { queries.push({ name, type }) }

    const browser = bonjour.find()
    queries.length = 0

    browser._onresponse({
      answers: [
        { type: 'PTR', name: '_services._dns-sd._udp.local', data: '_http._tcp.local' },
        { type: 'PTR', name: '_services._dns-sd._udp.local', data: '_ftp._tcp.local' }
      ],
      additionals: []
    }, { address: '127.0.0.1', port: 5353 })

    t.ok(queries.some(function (q) { return q.name === '_http._tcp.local' }), 'queried http')
    t.ok(queries.some(function (q) { return q.name === '_ftp._tcp.local' }), 'queried ftp')
    bonjour.destroy(function () { t.end() })
  })
})
