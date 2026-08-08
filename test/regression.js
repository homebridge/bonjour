'use strict'

const dgram = require('dgram')
const tape = require('tape')
const Bonjour = require('../')
const Service = require('../lib/Service.js')
const Prober = require('../lib/Prober.js')
const helpers = require('../lib/helpers.js')

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

tape('Server.unregister keeps other services sharing a record name', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server

    // Two services of the same type share the type PTR name, and every service on
    // the host shares the A record name. Removing by name alone took the sibling
    // records down too, so unpublishing one bridge made the other undiscoverable
    // until its own re-announce - a back-off that reaches an hour.
    server.register([
      { name: '_hap._tcp.local', type: 'PTR', ttl: 4500, data: 'Bridge A._hap._tcp.local' },
      { name: '_hap._tcp.local', type: 'PTR', ttl: 4500, data: 'Bridge B._hap._tcp.local' },
      { name: 'myhost.local', type: 'A', ttl: 120, data: '192.168.1.10' },
      { name: 'myhost.local', type: 'A', ttl: 120, data: '10.0.0.5' }
    ])

    // goodbye records for Bridge A only, with ttl zeroed the way _tearDown does it
    server.unregister([
      { name: '_hap._tcp.local', type: 'PTR', ttl: 0, data: 'Bridge A._hap._tcp.local' },
      { name: 'MYHOST.LOCAL', type: 'A', ttl: 0, data: '192.168.1.10' }
    ])

    t.deepEqual(server.registry.PTR.map(r => r.data), ['Bridge B._hap._tcp.local'], 'Bridge B PTR survived')
    t.deepEqual(server.registry.A.map(r => r.data), ['10.0.0.5'], 'the other address record survived')

    bonjour.destroy(function () { t.end() })
  })
})

tape('Prober detaches its response listener when the service stops first', function (t) {
  const Prober = require('../lib/Prober.js')
  const EventEmitter = require('events').EventEmitter

  const mdns = new EventEmitter()
  mdns.query = function () { t.fail('should not have queried for a stopped service') }

  // stopped during the 0-250ms probe jitter, which is the window start() opens
  const service = { fqdn: 'Gone._hap._tcp.local', _activated: false, _destroyed: false }
  const prober = new Prober(mdns, service, function () {
    t.fail('the callback must not fire for a stopped service')
  })

  prober.start()
  t.equal(mdns.listenerCount('response'), 1, 'precondition: listener attached')

  prober.try()
  t.equal(mdns.listenerCount('response'), 0, 'listener detached rather than leaked')
  t.end()
})

tape('Browser re-adds a service after a goodbye with different casing', function (t) {
  const Browser = require('../lib/Browser.js')
  const browser = Object.create(Browser.prototype)
  require('events').EventEmitter.call(browser)
  browser.services = []
  browser._serviceMap = {}

  browser._addService({ fqdn: 'Bridge A._hap._tcp.local' })
  browser._removeService('bridge a._HAP._tcp.LOCAL')

  t.equal(browser.services.length, 0, 'the goodbye removed it from the list')
  t.deepEqual(Object.keys(browser._serviceMap), [], 'and left no stale cache key behind')

  // the service comes back - it must be treated as new, not as a cached update
  let ups = 0
  browser.on('up', function () { ups++ })
  const returning = { fqdn: 'Bridge A._hap._tcp.local' }
  if (browser._serviceMap[returning.fqdn]) {
    browser._updateService(returning)
  } else {
    browser._addService(returning)
  }

  t.equal(ups, 1, "'up' fired again for the returning service")
  t.equal(browser.services.length, 1, 'and it is back in the list')
  t.end()
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

// === aa7c289 — surface mdns errors via Bonjour 'error' event ===

tape('Bonjour emits error event when mdns.respond callback fails', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    let received = null
    bonjour.on('error', function (err) { received = err })

    bonjour._server.mdns.respond = function (records, cb) {
      setImmediate(function () { if (cb) cb(new Error('boom')) })
    }

    bonjour._server.register({ name: 'X._tcp.local', type: 'PTR', ttl: 120, data: 'a' })
    bonjour._server._respondToQuery({ questions: [{ name: 'X._tcp.local', type: 'PTR' }] })

    setTimeout(function () {
      t.ok(received instanceof Error, 'error event fired')
      t.equal(received.message, 'boom')
      bonjour.destroy(function () { t.end() })
    }, 50)
  })
})

tape('Bonjour forwards underlying mdns socket errors via the error event', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })

    let received = null
    bonjour.on('error', function (err) { received = err })

    bonjour._server.mdns.emit('error', new Error('socket boom'))

    setImmediate(function () {
      t.ok(received instanceof Error, 'socket error forwarded')
      t.equal(received.message, 'socket boom')
      bonjour.destroy(function () { t.end() })
    })
  })
})

// === Registry._tearDown: shared A/AAAA records survive a sibling unpublishing ===

tape('unpublishing one service keeps the address records its siblings share', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server

    // Two services on ONE host, so both contribute identical A records. The
    // registry stores a single copy, which is exactly why removing "this
    // service's" copy used to take the other service's addresses with it.
    const one = bonjour.publish({ name: 'One', type: 'test', port: 3000, probe: false })
    const two = bonjour.publish({ name: 'Two', type: 'test', port: 3001, probe: false })

    setTimeout(function () {
      const addressesFor = function (service) {
        return service._records().filter(function (r) { return r.type === 'A' || r.type === 'AAAA' })
      }
      const shared = addressesFor(two)
      t.ok(shared.length > 0, 'precondition: the surviving service has address records')

      const goodbyes = []
      const respond = server.mdns.respond.bind(server.mdns)
      server.mdns.respond = function (packet, cb) {
        const records = Array.isArray(packet) ? packet : (packet.answers || [])
        records.forEach(function (r) { if (r.ttl === 0) goodbyes.push(r) })
        return respond(packet, cb)
      }

      one.stop(function () {
        const survives = function (record) {
          return (server.registry[record.type] || []).some(helpers.isSameRecord(record))
        }

        t.ok(shared.every(survives), 'the surviving service still has its address records registered')
        t.notOk(
          goodbyes.some(function (g) { return shared.some(helpers.isSameRecord(g)) }),
          'no goodbye was sent for an address the surviving service still uses'
        )

        // The service that stopped must still have withdrawn its own unique records
        t.ok(goodbyes.some(function (g) { return g.type === 'SRV' }), 'its own SRV was withdrawn')

        server.mdns.respond = respond
        bonjour.destroy(function () { t.end() })
      })
    }, 100)
  })
})

// === Server.register / unregister: one definition of "the same record" ===

tape('register treats names case-insensitively, as unregister does', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server

    // DNS compares names case-insensitively, so these are one record, not two.
    // Registering exactly but unregistering case-insensitively is how the two
    // sides drift apart: two entries go in and a single unregister takes both.
    server.register({ name: 'Foo.local', type: 'A', ttl: 120, data: '1.2.3.4' })
    server.register({ name: 'foo.LOCAL', type: 'A', ttl: 120, data: '1.2.3.4' })

    t.equal(server.registry.A.length, 1, 'stored once, not twice')

    server.unregister({ name: 'FOO.local', type: 'A', ttl: 120, data: '1.2.3.4' })
    t.equal(server.registry.A.length, 0, 'and removed by any casing')

    bonjour.destroy(function () { t.end() })
  })
})

tape('register still keeps records that differ only in their data', function (t) {
  port(function (p) {
    const bonjour = Bonjour({ ip: '127.0.0.1', port: p, multicast: false })
    const server = bonjour._server

    // Same name, different address: a dual-homed host, and both are real records
    server.register({ name: 'foo.local', type: 'A', ttl: 120, data: '1.2.3.4' })
    server.register({ name: 'foo.local', type: 'A', ttl: 120, data: '5.6.7.8' })

    t.equal(server.registry.A.length, 2, 'both kept')

    bonjour.destroy(function () { t.end() })
  })
})
