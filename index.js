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
  // Browsers made by find() that are still listening
  this._browsers = new Set()
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
  // After destroy() the socket is closed: a service published then was never
  // announced and a browser never found anything, both without any error
  _checkAlive: function (what) {
    if (this._destroyed) throw new Error('Cannot ' + what + ' on a destroyed Bonjour instance')
  },

  publish: function (opts) {
    this._checkAlive('publish')
    return this._registry.publish(opts)
  },

  unpublishAll: function (cb) {
    this._registry.unpublishAll(cb)
  },

  find: function (opts, onup) {
    this._checkAlive('find')
    return new Browser(this._server.mdns, opts, onup, this._browsers)
  },

  findOne: function (opts, cb) {
    this._checkAlive('find')
    const browser = new Browser(this._server.mdns, opts, undefined, this._browsers)
    browser.once('up', function (service) {
      browser.stop()
      if (cb) cb(service)
    })
    return browser
  },

  destroy: function (cb) {
    this._destroyed = true
    // A browser left running kept its listener and its timers on the closed
    // socket, and went on asking a network that could no longer answer
    this._browsers.forEach(browser => browser.stop())
    this._registry.destroy(() => {
      this._server.mdns.destroy()
      if (cb) cb()
    })
  }
})

module.exports = Bonjour
