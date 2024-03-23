'use strict'

const os = require('os')
const dgram = require('dgram')
const tape = require('tape')
const afterAll = require('after-all')
const Service = require('../lib/Service.js')
const Bonjour = require('../')

const getAddresses = function () {
  const addresses = []

  Object.values(os.networkInterfaces()).forEach(interfaces => {
    interfaces.forEach(iface => {
      if (iface.internal || addresses.includes(iface.address)) {
        return
      }

      addresses.push(iface.address)
    })
  })

  return addresses
}

const port = function (cb) {
  const s = dgram.createSocket('udp4')
  s.bind(0, function () {
    const port = s.address().port
    s.on('close', function () {
      cb(port)
    })
    s.close()
  })
}

const test = function (name, fn) {
  tape(name, function (t) {
    port(function (p) {
      fn(Bonjour({ ip: '127.0.0.1', port: p, multicast: false }), t)
    })
  })
}

test('bonjour.publish', function (bonjour, t) {
  const service = bonjour.publish({ name: 'foo', type: 'bar', port: 3000 })
  t.ok(service instanceof Service)
  t.equal(service.published, false)
  service.on('up', function () {
    t.equal(service.published, true)
    bonjour.destroy()
    t.end()
  })
})

test('bonjour.unpublishAll', function (bonjour, t) {
  t.test('published services', function (t) {
    const service = bonjour.publish({ name: 'foo', type: 'bar', port: 3000 })
    service.on('up', function () {
      bonjour.unpublishAll(function (err) {
        t.error(err)
        t.equal(service.published, false)
        bonjour.destroy()
        t.end()
      })
    })
  })

  t.test('no published services', function (t) {
    bonjour.unpublishAll(function (err) {
      t.error(err)
      t.end()
    })
  })
})

test('bonjour.find', function (bonjour, t) {
  const next = afterAll(function () {
    const browser = bonjour.find({ type: 'test' })
    let ups = 0

    browser.on('up', function (s) {
      if (s.name === 'Foo Bar') {
        t.equal(s.name, 'Foo Bar')
        t.equal(s.fqdn, 'Foo Bar._test._tcp.local')
        t.deepEqual(s.txt, {})
        t.deepEqual(s.rawTxt, [])
      } else {
        t.equal(s.name, 'Baz')
        t.equal(s.fqdn, 'Baz._test._tcp.local')
        t.deepEqual(s.txt, { foo: 'bar' })
        t.deepEqual(s.rawTxt, [Buffer.from('foo=bar')])
      }
      t.equal(s.host, os.hostname())
      t.equal(s.port, 3000)
      t.equal(s.type, 'test')
      t.equal(s.protocol, 'tcp')
      t.equal(s.referer.address, '127.0.0.1')
      t.equal(s.referer.family, 'IPv4')
      t.ok(Number.isFinite(s.referer.port))
      t.ok(Number.isFinite(s.referer.size))
      t.deepEqual(s.subtypes, [])
      t.deepEqual(s.addresses.sort(), getAddresses().sort())

      if (++ups === 2) {
        // use timeout in an attempt to make sure the invalid record doesn't
        // bubble up
        setTimeout(function () {
          bonjour.destroy()
          t.end()
        }, 50)
      }
    })
  })

  bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'bar' } }).on('up', next())
})

test('bonjour.change and up event', function (bonjour, t) {
  const data = { updateTxtSent: false, found: false, timer: null, serviceUp: false }
  data.timer = setTimeout(function () {
    t.equal(data.found, true)
    bonjour.destroy()
    t.end()
  }, 3000) // Wait 3000 ms for any additional up messages when the updateTxt is sent
  const service = bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'originalUp' } }).on('up', function () {
    if (!data.serviceUp) { // Workaround for Service.up firing when service.updateTxt is used
      data.serviceUp = true
      const browser = bonjour.find({ type: 'test' })
      browser.on('up', function (s) {
        t.equal(s.txt.foo, 'originalUp')
        data.found = true
        if (!data.updateTxtSent) {
          data.updateTxtSent = true
          service.updateTxt({ foo: 'updateUp' })
        }
      })
    }
  })
})

test('bonjour.change and update event', function (bonjour, t) {
  const data = { updateTxtSent: false, success: false, timer: null, serviceUp: false }
  data.timer = setTimeout(function () {
    t.equal(data.success, true)
    bonjour.destroy()
    t.end()
  }, 3000) // Wait for the record to update maximum 3000 ms
  const service = bonjour.publish({ name: 'Baz', type: 'test', port: 3000, txt: { foo: 'original' } }).on('up', function () {
    if (!data.serviceUp) { // Workaround for Service.up firing when service.updateTxt is used
      data.serviceUp = true
      const browser = bonjour.find({ type: 'test' })
      browser.on('up', function (s) {
        t.equal(s.txt.foo, 'original')
        if (!data.updateTxtSent) {
          data.updateTxtSent = true
          service.updateTxt({ foo: 'update' })
        }
      })

      browser.on('update', function (s) {
        if (s.txt.foo === 'update') { // Ignore updates that we are not interested in, have seen updates of just address information
          t.equal(s.txt.foo, 'update')
          data.success = true
          clearTimeout(data.timer)
          bonjour.destroy()
          t.end()
        }
      })
    }
  })
})

test('bonjour.find - binary txt', function (bonjour, t) {
  const next = afterAll(function () {
    const browser = bonjour.find({ type: 'test', txt: { binary: true } })

    browser.on('up', function (s) {
      t.equal(s.name, 'Foo')
      t.deepEqual(s.txt, { bar: Buffer.from('buz') })
      t.deepEqual(s.rawTxt, [Buffer.from('bar=buz')])
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Foo', type: 'test', port: 3000, txt: { bar: Buffer.from('buz') } }).on('up', next())
})

test('bonjour.find - down event', function (bonjour, t) {
  const service = bonjour.publish({ name: 'Foo Bar', type: 'test', port: 3000 })

  service.on('up', function () {
    const browser = bonjour.find({ type: 'test' })

    browser.on('up', function (s) {
      t.equal(s.name, 'Foo Bar')
      service.stop()
    })

    browser.on('down', function (s) {
      t.equal(s.name, 'Foo Bar')
      bonjour.destroy()
      t.end()
    })
  })
})

test('bonjour.findOne - callback', function (bonjour, t) {
  const next = afterAll(function () {
    bonjour.findOne({ type: 'test' }, function (s) {
      t.equal(s.name, 'Callback')
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Callback', type: 'test', port: 3000 }).on('up', next())
})

test('bonjour.findOne - emitter', function (bonjour, t) {
  const next = afterAll(function () {
    const browser = bonjour.findOne({ type: 'test' })
    browser.on('up', function (s) {
      t.equal(s.name, 'Emitter')
      bonjour.destroy()
      t.end()
    })
  })

  bonjour.publish({ name: 'Emitter', type: 'test', port: 3000 }).on('up', next())
  bonjour.publish({ name: 'Invalid', type: 'test2', port: 3000 }).on('up', next())
})
