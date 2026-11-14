# Change Log

All notable changes to `bonjour-hap` will be documented in this file. This project tries to adhere to [Semantic Versioning](http://semver.org/).

## v3.11.1 (Pending Release)

### Changes

- fix(service): stop a TXT update at the wrong moment crashing or dropping records
- fix(service): do not re-announce a service stopped from its own up listener
- fix(registry): do not announce a service that was stopped while probing
- fix(server): withdraw a stopped service's TXT record too
- fix(browser): survive services and hosts named like built-in object properties
- fix(browser): keep a TXT key named constructor
- fix(browser): keep expiring services after a stop and start
- fix(service): reject a name longer than 63 bytes
- fix(service): reject a TXT entry longer than 255 bytes
- fix(service): send a single zero byte for an empty TXT record
- perf(server): leave out an SRV answer the querier already holds
- fix(types): match the events, TXT values and optional arguments the code really has
- docs(readme): describe the options, callbacks and events the code really has
- docs(readme): say the library is maintained for HAP-NodeJS, with ciao preferred
- refactor(helpers): use a Set in unique(), and line up the comment blocks
- refactor(server): write the dot check with includes()
- refactor(service): attach the methods with Object.assign, like the other files
- style(registry): line up the comment blocks
- style(network): add the missing 'use strict'
- chore: drop package.json from the files list, as npm always includes it
- test: cover TXT decoding edge cases, unheard errors and bad address restrictions

## v3.11.0 (2026-11-01)

### Changes

- ci: update github actions to their latest versions (#38)
- chore(deps): dependency updates
- fix(browser): remember addresses across packets, so services on a busy host get theirs (#33) (@NorthernMan54)
- fix(service): advertise the address a service is bound to, not every other one
- fix(registry): no goodbye for another device's name, and warn rather than crash on a clash
- fix(server): answer all of a query's questions in one packet
- feat(server): reply to one-shot lookups by unicast, so plain DNS clients get an answer
- feat(browser): drop services that vanish without a goodbye, and apply TXT or SRV sent alone
- fix(service): stop a TXT update firing up again, as if the service had just started
- perf(server): leave out answers the querier already holds (known-answer suppression)
- perf(browser): build each packet's record list once, not again for every browsed name
- fix(service): announce the host's new address when it changes, not the old one until a restart
- fix(types): describe the CommonJS export, so ES module consumers can call it

## v3.10.5 (2026-08-15)

### Changes

- fix(server): stop one service unpublishing from withdrawing another's records
- fix(browser): drop the cached fqdn key that was actually inserted
- fix(prober): detach the response listener when the service stops first
- chore(deps): dependency updates

## v3.10.4 (2026-07-08)

### Changes

- chore: dependency updates
- chore: update `actions/checkout` to `v7`
- chore: added `deprecate-past-pre-releases` workflow

## v3.10.3 (2026-05-25)

### Changes

- fix(types): align `index.d.ts` with runtime
- chore: dependency updates
- fix(server): continue past unanswered questions in multi-question queries
- fix(browser): handle null opts in constructor
- fix(service): make stop() callback truly optional
- fix(server): compare names case-insensitively when unregistering records
- fix(browser): compare wildcard PTR name case-insensitively
- fix(browser): dedup wildcard PTR queries by service type, not parent name
- fix(prober): unref the initial probe-jitter timer
- fix(service): restore exponential re-announce backoff
- fix(service): don't resurrect torn-down services in announce callback
- fix(browser): suppress no-op 'update' events when nothing changed
- fix: broadcast goodbye records during Bonjour.destroy()
- fix(server): warn instead of crash when mdns respond fails
- fix(service): include meta-enumeration PTR in goodbye records
- fix: surface mdns errors via Bonjour 'error' event
- chore(ci): bump release workflow action versions

## v3.10.2 (2026-05-04)

- add `.DS_Store` and `.idea` to `gitignore` file
- dependency updates

## v3.10.1 (2026-03-29)

- dependency updates

## v3.10.0 (2026-02-07)

- dependency updates
- update release script for oidc releases
- add `package-lock.json` to npm package
- add `.github/labeler.yml` for workflow
- chore: remove `array-flatten`, use native `Array.prototype.flat` (#28) (@Uzlopak)
- chore: replace `deep-equal` with `fast-deep-equal` (#27) (@Uzlopak)

## v3.9.1 (2025-07-23)

- Dependency updates

## v3.9.0 (2024-12-21)

- Add TypeScript typing.
- Dependency updates.
- Housekeeping.

## v3.8.0 (2024-06-26)

### Other Changes

- Update dependencies (`array-flatten`)

## v3.7.3 (2024-06-24)

### Other Changes

- Add service name to error message to more easily pinpoint service name (#22) (@slyoldfox)
