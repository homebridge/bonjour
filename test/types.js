'use strict'

const path = require('path')
const { execFileSync } = require('child_process')
const test = require('tape')

const tsc = require.resolve('typescript/bin/tsc')

// index.d.ts must describe `module.exports = Bonjour` for both kinds of TypeScript consumer
for (const kind of ['esm', 'cjs']) {
  test(`index.d.ts type-checks for a ${kind} consumer`, function (t) {
    try {
      execFileSync(process.execPath, [tsc, '-p', path.join(__dirname, 'types', kind)], { stdio: 'pipe' })
      t.pass('compiled')
    } catch (err) {
      t.fail(String(err.stdout || err.message))
    }
    t.end()
  })
}
