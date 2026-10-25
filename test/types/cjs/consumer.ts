// Compiled by test/types.js, never run: it fails to type-check if index.d.ts stops matching what
// index.js actually exports, which is `module.exports = Bonjour`
import bonjour, { Advertisement, Bonjour, BonjourFactory } from 'bonjour-hap'

const factory: BonjourFactory = bonjour
const instance: Bonjour = factory()
const constructed: Bonjour = new bonjour({ port: 5353 })
const ad: Advertisement = instance.publish({ name: 'Test', type: 'hap', port: 51826 })
ad.stop()
constructed.destroy()
