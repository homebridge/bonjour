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

// === c0fc44d — Prober: unref the initial probe-jitter timer ===

tape('Prober.start() unrefs the initial jitter timer', function (t) {
  const realSetTimeout = global.setTimeout
  let firstFake = null
  global.setTimeout = function (fn, delay) {
    if (firstFake === null) {
      let refed = true
      firstFake = {
        unref: function () { refed = false; return this },
        ref: function () { refed = true; return this },
        hasRef: function () { return refed }
      }
      return firstFake
    }
    return realSetTimeout(fn, delay)
  }

  const fakeMdns = { on: function () {}, query: function () {}, removeListener: function () {} }
  const fakeService = { _activated: true, _destroyed: false, fqdn: 'foo._tcp.local' }
  const prober = new Prober(fakeMdns, fakeService, function () {})
  prober.start()

  global.setTimeout = realSetTimeout

  t.ok(firstFake, 'jitter timer was scheduled')
  t.equal(firstFake.hasRef(), false, "jitter timer is unref'd so it does not block process exit")
  t.end()
})

// === 025e0cd — Service: restore exponential re-announce backoff ===

tape('Service re-announce delay accumulates 3x across timer firings', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  s._activated = true
  s.packet = s._records()

  const realSetTimeout = global.setTimeout
  const scheduled = []
  global.setTimeout = function (fn, delay) {
    scheduled.push({ fn, delay })
    return { unref: function () { return this } }
  }

  let pendingCb
  s.on('service-announce-request', function (pkt, silent, cb) { pendingCb = cb })

  s.announce()
  pendingCb()
  t.equal(scheduled[0].delay, 3000, 'first re-announce scheduled at 3 s')

  scheduled[0].fn()
  pendingCb()
  t.equal(scheduled[1].delay, 9000, 'second re-announce at 9 s (multiplier accumulated, not reset)')

  scheduled[1].fn()
  pendingCb()
  t.equal(scheduled[2].delay, 27000, 'third re-announce at 27 s')

  global.setTimeout = realSetTimeout
  s._destroyed = true
  t.end()
})

tape('Service.announce() (public entry) resets delay back to 1 s', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  s._activated = true
  s.packet = s._records()

  const realSetTimeout = global.setTimeout
  const scheduled = []
  global.setTimeout = function (fn, delay) {
    scheduled.push({ fn, delay })
    return { unref: function () { return this } }
  }

  let pendingCb
  s.on('service-announce-request', function (pkt, silent, cb) { pendingCb = cb })

  s.announce()
  pendingCb()
  scheduled[0].fn()
  pendingCb()
  t.equal(scheduled[1].delay, 9000, 'walked the timer chain to 9 s')

  s.announce()
  pendingCb()
  t.equal(scheduled[2].delay, 3000, 'public announce() reset delay back to 1 s')

  global.setTimeout = realSetTimeout
  s._destroyed = true
  t.end()
})

// === 87068e8 — Service: don't resurrect a torn-down service in announce callback ===

tape('onAnnounceComplete bails out when service was deactivated mid-announce', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  s._activated = true
  s.packet = s._records()

  const realSetTimeout = global.setTimeout
  let scheduledNext = false
  global.setTimeout = function () {
    scheduledNext = true
    return { unref: function () { return this } }
  }

  let upFired = false
  s.on('up', function () { upFired = true })
  s.on('service-announce-request', function () {})

  s.announce()
  s._activated = false // user calls stop() between announce() and the respond callback

  s.onAnnounceComplete() // mdns invokes the announce-complete callback

  global.setTimeout = realSetTimeout

  t.equal(s._activated, false, 'remained inactive — not resurrected')
  t.equal(s.published, false, 'not marked published')
  t.equal(upFired, false, 'no spurious up event')
  t.equal(scheduledNext, false, 'no follow-up re-announce scheduled')
  t.end()
})

tape('onAnnounceComplete bails out for destroyed services', function (t) {
  const s = new Service({ name: 'Foo', type: 'http', port: 3000 })
  s._activated = true
  s.packet = s._records()
  s._destroyed = true

  s.on('service-announce-request', function () {})
  s.onAnnounceComplete()

  t.equal(s.published, false, 'destroyed service not marked published')
  t.end()
})

// === 7768312 — Browser: suppress no-op 'update' events when nothing changed ===

const buildAnnouncePacket = function (txtBlocks) {
  return {
    answers: [
      { type: 'PTR', name: '_test._tcp.local', ttl: 4500, data: 'X._test._tcp.local' },
      { type: 'SRV', name: 'X._test._tcp.local', ttl: 120, data: { port: 3000, target: 'host.local' } },
      { type: 'TXT', name: 'X._test._tcp.local', ttl: 4500, data: txtBlocks },
      { type: 'A', name: 'host.local', ttl: 120, data: '10.0.0.1' }
    ],
    additionals: []
  }
}

tape('Browser does not emit update for repeated identical announcements', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const browser = bonjour.find({ type: 'test' })

    let upCount = 0
    let updateCount = 0
    browser.on('up', function () { upCount++ })
    browser.on('update', function () { updateCount++ })

    browser._onresponse(buildAnnouncePacket([Buffer.from('a=1')]), { address: '127.0.0.1', port: 5353 })
    // re-announce from a different referer — only the rinfo changes, not the service
    browser._onresponse(buildAnnouncePacket([Buffer.from('a=1')]), { address: '127.0.0.2', port: 5353 })
    browser._onresponse(buildAnnouncePacket([Buffer.from('a=1')]), { address: '127.0.0.3', port: 5353 })

    t.equal(upCount, 1, 'up emitted once')
    t.equal(updateCount, 0, "no 'update' for identical re-announces")
    bonjour.destroy(function () { t.end() })
  })
})

tape('Browser still emits update when user-visible TXT actually changes', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const browser = bonjour.find({ type: 'test' })

    let updateCount = 0
    browser.on('update', function () { updateCount++ })

    browser._onresponse(buildAnnouncePacket([Buffer.from('a=1')]), { address: '127.0.0.1', port: 5353 })
    browser._onresponse(buildAnnouncePacket([Buffer.from('a=2')]), { address: '127.0.0.1', port: 5353 })

    t.equal(updateCount, 1, 'update fires once when TXT changed')
    bonjour.destroy(function () { t.end() })
  })
})

// === f5e1333 — Bonjour.destroy() broadcasts goodbye records ===

tape('Bonjour.destroy() broadcasts ttl=0 goodbye PTR records before closing', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    const respondCalls = []
    const orig = bonjour._server.mdns.respond.bind(bonjour._server.mdns)
    bonjour._server.mdns.respond = function (records) {
      respondCalls.push(records)
      return orig.apply(null, arguments)
    }

    bonjour.publish({ name: 'GoodbyeTest', type: 'goodbye', port: 3000, probe: false })
      .on('up', function () {
        const announceCount = respondCalls.length
        bonjour.destroy(function () {
          const newCalls = respondCalls.slice(announceCount)
          const allRecords = newCalls.flatMap(function (rs) { return Array.isArray(rs) ? rs : [rs] })
          const goodbyePtrs = allRecords.filter(function (r) { return r.type === 'PTR' && r.ttl === 0 })
          t.ok(goodbyePtrs.length > 0, 'at least one ttl=0 PTR record was broadcast')
          t.ok(goodbyePtrs.some(function (r) { return r.data === 'GoodbyeTest._goodbye._tcp.local' }),
            'goodbye for our service was broadcast')
          t.end()
        })
      })
  })
})

tape('Bonjour.destroy(cb) callback fires after teardown completes', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    bonjour.publish({ name: 'CbTest', type: 'cbtest', port: 3000, probe: false })
      .on('up', function () {
        bonjour.destroy(function () {
          t.pass('destroy callback fired')
          t.end()
        })
      })
  })
})

// === 48c0393 — Server: warn instead of crash when mdns.respond callback errors ===

tape('mdns.respond callback error does not raise uncaughtException', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    let uncaught = null
    const onUncaught = function (err) { uncaught = err }
    process.on('uncaughtException', onUncaught)

    // attach an error listener so that, in versions where the server emits
    // 'error' rather than warning, the EventEmitter does not itself raise
    bonjour.on('error', function () {})

    bonjour._server.mdns.respond = function (records, cb) {
      setImmediate(function () { if (cb) cb(new Error('post-shutdown send error')) })
    }

    bonjour._server.register({ name: 'X._tcp.local', type: 'PTR', ttl: 120, data: 'a' })
    bonjour._server._respondToQuery({ questions: [{ name: 'X._tcp.local', type: 'PTR' }] })

    setTimeout(function () {
      process.removeListener('uncaughtException', onUncaught)
      t.equal(uncaught, null, 'no uncaughtException from a benign respond callback error')
      bonjour.destroy(function () { t.end() })
    }, 50)
  })
})

// === ab7d952 — meta-enumeration PTR included in goodbye records ===

tape('goodbye includes meta-enum PTR for addUnsafeServiceEnumerationRecord services', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    const respondCalls = []
    const orig = bonjour._server.mdns.respond.bind(bonjour._server.mdns)
    bonjour._server.mdns.respond = function (records) {
      respondCalls.push(records)
      return orig.apply(null, arguments)
    }

    const service = bonjour.publish({
      name: 'MetaTest',
      type: 'meta',
      port: 3000,
      probe: false,
      addUnsafeServiceEnumerationRecord: true
    })

    service.on('up', function () {
      const announceCount = respondCalls.length
      service.stop(function () {
        const newCalls = respondCalls.slice(announceCount)
        const allRecords = newCalls.flatMap(function (rs) { return Array.isArray(rs) ? rs : [rs] })
        const metaGoodbye = allRecords.filter(function (r) {
          return r.name === '_services._dns-sd._udp.local' && r.type === 'PTR' && r.ttl === 0
        })
        t.ok(metaGoodbye.length > 0, 'meta-enum PTR included in goodbye records')
        t.equal(metaGoodbye[0].data, '_meta._tcp.local')
        bonjour.destroy(function () { t.end() })
      })
    })
  })
})

tape('goodbye for a non-meta service does not emit a meta-enum PTR', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    const respondCalls = []
    const orig = bonjour._server.mdns.respond.bind(bonjour._server.mdns)
    bonjour._server.mdns.respond = function (records) {
      respondCalls.push(records)
      return orig.apply(null, arguments)
    }

    const service = bonjour.publish({ name: 'NoMeta', type: 'plain', port: 3000, probe: false })

    service.on('up', function () {
      const announceCount = respondCalls.length
      service.stop(function () {
        const newCalls = respondCalls.slice(announceCount)
        const allRecords = newCalls.flatMap(function (rs) { return Array.isArray(rs) ? rs : [rs] })
        const metaGoodbye = allRecords.filter(function (r) {
          return r.name === '_services._dns-sd._udp.local' && r.type === 'PTR'
        })
        t.equal(metaGoodbye.length, 0, 'no meta-enum PTR when service did not advertise one')
        bonjour.destroy(function () { t.end() })
      })
    })
  })
})
