// Compiled by test/types.js, never run: it fails to type-check if index.d.ts stops matching what
// index.js actually exports, which is `module.exports = Bonjour`
import bonjour, { Advertisement, Bonjour, BonjourFactory } from 'bonjour-hap'

const factory: BonjourFactory = bonjour
const instance: Bonjour = factory()
const constructed: Bonjour = new bonjour({ port: 5353 })
const ad: Advertisement = instance.publish({ name: 'Test', type: 'hap', port: 51826 })
ad.stop()
constructed.destroy()

// The three objects are real event emitters, not only `on`
ad.once('up', () => {})
ad.once('error', (err: Error) => { console.log(err.message) })
ad.removeAllListeners('up')
instance.once('error', (err: Error) => { console.log(err.message) })
instance.off('error', () => {})

// find() and findOne() work with no options, or with only the listener
const all = instance.find()
instance.find(null, service => { console.log(service.name) })
instance.find(service => { console.log(service.name) })
instance.findOne()
all.once('down', service => { console.log(service.fqdn) })
all.removeAllListeners()

// A found service's TXT value can be a string, `true` (a key with no value) or bytes
all.on('up', service => {
  const value: string | true | Buffer | undefined = service.txt?.md
  // @ts-expect-error not always a string
  const text: string | undefined = service.txt?.md
  console.log(value, text)
})

// The stop callbacks are told when sending the goodbye failed
ad.stop(error => { if (error) console.log(error.message) })
instance.unpublishAll(error => { if (error) console.log(error.message) })
