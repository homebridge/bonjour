'use strict'

const equalSign = Buffer.from('=')

// Keys come from the network, and the result is a plain object. `key in data` is
// true for names every object inherits, so a key called `constructor` was taken
// for a repeat and dropped; and plain assignment to `__proto__` sets nothing
const has = (data, key) => Object.prototype.hasOwnProperty.call(data, key)
const set = (data, key, value) => {
  Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true })
}

module.exports = function (opts) {
  const binary = opts ? opts.binary : false
  const that = {}

  that.decodeBlocks = function (bufArray) {
    const data = {}

    bufArray.forEach(buf => {
      if (buf.length === 0) {
        return // ignore: most likely a single zero byte
      }

      const i = buf.indexOf(equalSign)

      if (i === -1) { // equal sign does not exist
        const key = buf.toString().toLowerCase()
        // The first entry for a key wins (RFC 6763 section 6.4), also when the
        // repeat has no value: it used to replace the value with true
        if (!has(data, key)) set(data, key, true)
      } else if (i > 0) { // we ignore zero key-length blocks
        const key = buf.slice(0, i).toString().toLowerCase()

        if (has(data, key)) { // ignore: overwriting not allowed
          return
        }

        const valueBuf = buf.slice(i + 1)
        set(data, key, binary ? valueBuf : valueBuf.toString())
      }
    })

    return data
  }

  return that
}
