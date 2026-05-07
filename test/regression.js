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
