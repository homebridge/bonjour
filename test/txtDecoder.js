'use strict'

const test = require('tape')
const txtDecoder = require('../lib/utils/txtDecoder')

const blocks = function () {
  return Array.prototype.map.call(arguments, function (entry) { return Buffer.from(entry) })
}

test('txt decoder - key=value entries, with keys lower-cased', function (t) {
  t.deepEqual(txtDecoder().decodeBlocks(blocks('Foo=Bar', 'md=A=B')), { foo: 'Bar', md: 'A=B' })
  t.end()
})

test('txt decoder - a key with no value is true', function (t) {
  t.deepEqual(txtDecoder().decodeBlocks(blocks('Paired', 'empty=')), { paired: true, empty: '' })
  t.end()
})

test('txt decoder - the first of a repeated key wins', function (t) {
  t.deepEqual(txtDecoder().decodeBlocks(blocks('a=first', 'A=second')), { a: 'first' })
  t.end()
})

test('txt decoder - empty entries and entries with no key are ignored', function (t) {
  t.deepEqual(txtDecoder().decodeBlocks(blocks('', '=novalue', 'a=b')), { a: 'b' })
  t.deepEqual(txtDecoder().decodeBlocks([]), {})
  t.end()
})

test('txt decoder - binary keeps values as bytes', function (t) {
  t.deepEqual(txtDecoder({ binary: true }).decodeBlocks(blocks('a=b', 'flag')), { a: Buffer.from('b'), flag: true })
  t.end()
})
