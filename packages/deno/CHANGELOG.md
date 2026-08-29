# Changelog

## [1.1.0](https://github.com/zuke-build/zuke/compare/deno-v1.0.1...deno-v1.1.0) (2026-08-29)


### Features

* **deno:** wrap the subcommands the package was missing ([#417](https://github.com/zuke-build/zuke/issues/417)) ([e2c495c](https://github.com/zuke-build/zuke/commit/e2c495c7379aefb6b94f665100e598b58d0b8431))

## [1.0.1](https://github.com/zuke-build/zuke/compare/deno-v1.0.0...deno-v1.0.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.0.0](https://github.com/zuke-build/zuke/compare/deno-v0.8.0...deno-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/deno` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.8.0](https://github.com/zuke-build/zuke/compare/deno-v0.7.0...deno-v0.8.0) (2026-07-28)


### Features

* **deno:** add config and no-lock to deno check, verify declared core floors ([#285](https://github.com/zuke-build/zuke/issues/285)) ([3877d2f](https://github.com/zuke-build/zuke/commit/3877d2fdaed6d459c7e9c8a5f1b44203b7b13467))

## [0.7.0](https://github.com/zuke-build/zuke/compare/deno-v0.6.1...deno-v0.7.0) (2026-07-27)


### Features

* add missing typed builders, DenoSettings.frozen, and --frozen scaffolding ([#268](https://github.com/zuke-build/zuke/issues/268)) ([8549b12](https://github.com/zuke-build/zuke/commit/8549b127216a37fd176cfc2e091d558de43c98a8))

## [0.6.1](https://github.com/zuke-build/zuke/compare/deno-v0.6.0...deno-v0.6.1) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.6.0](https://github.com/zuke-build/zuke/compare/deno-v0.5.1...deno-v0.6.0) (2026-07-20)


### Features

* **deno:** make the coverage gate trustworthy ([#221](https://github.com/zuke-build/zuke/issues/221)) ([5b2c256](https://github.com/zuke-build/zuke/commit/5b2c256542d6f68cd8734ff8c53d2af28e442b37))

## [0.5.1](https://github.com/zuke-build/zuke/compare/deno-v0.5.0...deno-v0.5.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.5.0](https://github.com/zuke-build/zuke/compare/deno-v0.4.0...deno-v0.5.0) (2026-06-23)


### Features

* release @zuke/docs and the @zuke/deno doc wrapper ([#119](https://github.com/zuke-build/zuke/issues/119)) ([bb62164](https://github.com/zuke-build/zuke/commit/bb62164515fd09780fa2b1b1feec13c96e840a59))

## [0.4.0](https://github.com/zuke-build/zuke/compare/deno-v0.3.0...deno-v0.4.0) (2026-06-21)


### Features

* extract reusable build utils and replace CmdTasks in the build ([#88](https://github.com/zuke-build/zuke/issues/88)) ([c0fe3ca](https://github.com/zuke-build/zuke/commit/c0fe3caf4ee14fa4fa24c0f06c6f22827eb483f7))

## [0.3.0](https://github.com/zuke-build/zuke/compare/deno-v0.2.0...deno-v0.3.0) (2026-06-16)


### Features

* document AbsolutePath support across the tool-wrapper packages ([#37](https://github.com/zuke-build/zuke/issues/37)) ([94c8ccb](https://github.com/zuke-build/zuke/commit/94c8ccb22dde1ccddc7264bff7bdb3b4a2cb5d5e))

## [0.2.0](https://github.com/zuke-build/zuke/compare/deno-v0.1.1...deno-v0.2.0) (2026-06-16)


### Features

* add oxlint, eslint, cspell, jest, and vitest tool wrappers ([#26](https://github.com/zuke-build/zuke/issues/26)) ([69a8871](https://github.com/zuke-build/zuke/commit/69a88712439c7396e175c7fa6ca6636a5bed8f45))

## [0.1.1](https://github.com/zuke-build/zuke/compare/deno-v0.1.0...deno-v0.1.1) (2026-06-15)


### Documentation

* add a README to every package (forces 0.1.1) ([#17](https://github.com/zuke-build/zuke/issues/17)) ([6098b4f](https://github.com/zuke-build/zuke/commit/6098b4f63f93ce45155c5f25779aa293135de938))

## 0.1.0 (2026-06-09)


### Features

* NUKE-style tool wrappers (@zuke/deno, @zuke/npm, @zuke/cmd) + workspace ([#2](https://github.com/zuke-build/zuke/issues/2)) ([c98c4a7](https://github.com/zuke-build/zuke/commit/c98c4a7bb7cc25cc727f98316efcc27025b9c9f5))


### Bug Fixes

* **release:** bump deno.json via package-relative extra-files (nothing was publishing) ([#13](https://github.com/zuke-build/zuke/issues/13)) ([bdc4ee6](https://github.com/zuke-build/zuke/commit/bdc4ee630ce08b0cbdf67228f3cdb06fc31e24e9))
