'use strict'

const os = require('os')
const test = require('tape')
const Service = require('../lib/Service.js')

const ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/

const getAddressesRecords = function (host) {
  const records = []

  const addresses = []
  Object.values(os.networkInterfaces()).forEach(interfaces => {
    interfaces.forEach(iface => {
      if (iface.internal || addresses.includes(iface.address)) {
        return
      }

      addresses.push(iface.address)
    })
  })

  addresses.forEach(address => {
    records.push({ data: address, name: host, ttl: 120, flush: true, type: ipv4Regex.test(address) ? 'A' : 'AAAA' })
  })

  return records
}

test('no name', function (t) {
  t.throws(function () {
    new Service({ type: 'http', port: 3000 }) // eslint-disable-line no-new
  }, 'Required name not given')
  t.end()
})

test('no type', function (t) {
  t.throws(function () {
    new Service({ name: 'Foo Bar', port: 3000 }) // eslint-disable-line no-new
  }, 'Required type not given')
  t.end()
})

test('no port', function (t) {
  t.throws(function () {
    new Service({ name: 'Foo Bar', type: 'http' }) // eslint-disable-line no-new
  }, 'Required port not given')
  t.end()
})

test('minimal', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', port: 3000 })
  t.equal(s.name, 'Foo Bar')
  t.equal(s.protocol, 'tcp')
  t.equal(s.type, '_http._tcp')
  t.equal(s.host, os.hostname())
  t.equal(s.port, 3000)
  t.equal(s.fqdn, 'Foo Bar._http._tcp.local')
  t.equal(s.txt, null)
  t.equal(s.subtypes, null)
  t.equal(s.published, false)
  t.end()
})

test('protocol', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', port: 3000, protocol: 'udp' })
  t.deepEqual(s.protocol, 'udp')
  t.end()
})

test('host', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', port: 3000, host: 'example.com' })
  t.deepEqual(s.host, 'example.com')
  t.end()
})

test('txt', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', port: 3000, txt: { foo: 'bar' } })
  t.deepEqual(s.txt, { foo: 'bar' })
  t.end()
})

test('_records() - minimal', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', protocol: 'tcp', port: 3000 })
  t.deepEqual(s._records(true), [
    { data: s.fqdn, name: '_http._tcp.local', ttl: 4500, type: 'PTR' },
    { data: { port: 3000, target: os.hostname() }, name: s.fqdn, ttl: 120, flush: true, type: 'SRV' },
    { data: [], name: s.fqdn, ttl: 4500, flush: true, type: 'TXT' }
  ].concat(getAddressesRecords(s.host)))
  t.end()
})

test('_records() - everything', function (t) {
  const s = new Service({ name: 'Foo Bar', type: 'http', protocol: 'tcp', port: 3000, host: 'example.com', txt: { foo: 'bar' }, addUnsafeServiceEnumerationRecord: true })
  t.deepEqual(s._records(), [
    { data: s.fqdn, name: '_http._tcp.local', ttl: 4500, type: 'PTR' },
    { data: { port: 3000, target: 'example.com' }, name: s.fqdn, ttl: 120, flush: true, type: 'SRV' },
    { data: ['foo=bar'], name: s.fqdn, ttl: 4500, flush: true, type: 'TXT' }
  ].concat(getAddressesRecords(s.host)).concat([
    { data: '_http._tcp.local', ttl: 4500, type: 'PTR', name: '_services._dns-sd._udp.local' }
  ]))
  t.end()
})

// A service bound to particular addresses must advertise exactly those. The check
// was inverted, so binding to an IP advertised every OTHER address on the interface
const withInterfaces = function (interfaces, fn) {
  const real = os.networkInterfaces
  os.networkInterfaces = function () { return interfaces }
  try {
    fn()
  } finally {
    os.networkInterfaces = real
  }
}

const fakeInterfaces = {
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  en0: [
    { address: '192.168.1.5', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
    { address: 'fd00::5', family: 'IPv6', internal: false }
  ],
  en1: [{ address: '10.0.0.9', family: 'IPv4', internal: false }]
}

const advertised = function (opts) {
  const service = new Service(Object.assign({ name: 'Foo Bar', type: 'http', port: 3000, host: 'example.local' }, opts))
  return service._addressRecords().map(function (record) { return record.data })
}

test('_addressRecords() - restricted to an address advertises only that address', function (t) {
  withInterfaces(fakeInterfaces, function () {
    t.deepEqual(advertised({ restrictedAddresses: ['192.168.1.5'] }), ['192.168.1.5'])
  })
  t.end()
})

test('_addressRecords() - restricted to two addresses on one interface advertises both', function (t) {
  withInterfaces(fakeInterfaces, function () {
    t.deepEqual(advertised({ restrictedAddresses: ['192.168.1.5', 'fd00::5'] }), ['192.168.1.5', 'fd00::5'])
  })
  t.end()
})

test('_addressRecords() - restricted to an interface advertises all of its addresses', function (t) {
  withInterfaces(fakeInterfaces, function () {
    t.deepEqual(advertised({ restrictedAddresses: ['en0'] }), ['192.168.1.5', 'fe80::1', 'fd00::5'])
  })
  t.end()
})

test('_addressRecords() - unrestricted advertises every external address', function (t) {
  withInterfaces(fakeInterfaces, function () {
    t.deepEqual(advertised({}), ['192.168.1.5', 'fe80::1', 'fd00::5', '10.0.0.9'])
  })
  t.end()
})
