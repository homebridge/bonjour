'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const Registry = require('./lib/Registry.js')
const Server = require('./lib/Server.js')
const Browser = require('./lib/Browser.js')

function Bonjour (opts) {
  if (!(this instanceof Bonjour)) { return new Bonjour(opts) }

  EventEmitter.call(this)

  this._server = new Server(opts)
  this._registry = new Registry(this._server)
  this._server.on('error', err => {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err)
    } else {
      console.warn('bonjour-hap:', err.message || err)
    }
  })
}

util.inherits(Bonjour, EventEmitter)

Object.assign(Bonjour.prototype, {
  publish: function (opts) {
    return this._registry.publish(opts)
  },

  unpublishAll: function (cb) {
    this._registry.unpublishAll(cb)
  },

  find: function (opts, onup) {
    return new Browser(this._server.mdns, opts, onup)
  },

  findOne: function (opts, cb) {
    const browser = new Browser(this._server.mdns, opts)
    browser.once('up', function (service) {
      browser.stop()
      if (cb) cb(service)
    })
    return browser
  },

  destroy: function (cb) {
    this._registry.destroy(() => {
      this._server.mdns.destroy()
      if (cb) cb()
    })
  }
})

module.exports = Bonjour
