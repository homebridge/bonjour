# Change Log

All notable changes to `bonjour-hap` will be documented in this file. This project tries to adhere to [Semantic Versioning](http://semver.org/).

## v3.10.5 (Pending Release)

### Changes

- fix(server): unregister a record by its data too, not just its name
- fix(browser): drop the cached fqdn key that was actually inserted

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
