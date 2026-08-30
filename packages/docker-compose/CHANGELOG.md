# Changelog

## [1.2.0](https://github.com/zuke-build/zuke/compare/docker-compose-v1.1.0...docker-compose-v1.2.0) (2026-08-30)


### Features

* **docker-compose:** wrap the commands the package was missing, with readers ([#421](https://github.com/zuke-build/zuke/issues/421)) ([0aa9f75](https://github.com/zuke-build/zuke/commit/0aa9f75beca237d05523dfc335b92f4e055e24f2))

## [1.1.0](https://github.com/zuke-build/zuke/compare/docker-compose-v1.0.1...docker-compose-v1.1.0) (2026-08-26)


### Features

* **docker-compose:** set a pull policy on compose up ([#389](https://github.com/zuke-build/zuke/issues/389)) ([42a99ad](https://github.com/zuke-build/zuke/commit/42a99ad23c56674602acecc095382d64102a9681))
* **docker-compose:** start compose services without their dependencies ([#387](https://github.com/zuke-build/zuke/issues/387)) ([fd7d37b](https://github.com/zuke-build/zuke/commit/fd7d37bf79cf24466545a7bae76ac2b9a111e10a))

## [1.0.1](https://github.com/zuke-build/zuke/compare/docker-compose-v1.0.0...docker-compose-v1.0.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.0.0](https://github.com/zuke-build/zuke/compare/docker-compose-v0.4.0...docker-compose-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/docker-compose` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.4.0](https://github.com/zuke-build/zuke/compare/docker-compose-v0.3.2...docker-compose-v0.4.0) (2026-07-27)


### Features

* add missing typed builders, DenoSettings.frozen, and --frozen scaffolding ([#268](https://github.com/zuke-build/zuke/issues/268)) ([8549b12](https://github.com/zuke-build/zuke/commit/8549b127216a37fd176cfc2e091d558de43c98a8))

## [0.3.2](https://github.com/zuke-build/zuke/compare/docker-compose-v0.3.1...docker-compose-v0.3.2) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.3.1](https://github.com/zuke-build/zuke/compare/docker-compose-v0.3.0...docker-compose-v0.3.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.3.0](https://github.com/zuke-build/zuke/compare/docker-compose-v0.2.0...docker-compose-v0.3.0) (2026-06-16)


### Features

* document AbsolutePath support across the tool-wrapper packages ([#37](https://github.com/zuke-build/zuke/issues/37)) ([94c8ccb](https://github.com/zuke-build/zuke/commit/94c8ccb22dde1ccddc7264bff7bdb3b4a2cb5d5e))

## [0.2.0](https://github.com/zuke-build/zuke/compare/docker-compose-v0.1.0...docker-compose-v0.2.0) (2026-06-16)


### Features

* add oxlint, eslint, cspell, jest, and vitest tool wrappers ([#26](https://github.com/zuke-build/zuke/issues/26)) ([69a8871](https://github.com/zuke-build/zuke/commit/69a88712439c7396e175c7fa6ca6636a5bed8f45))

## 0.1.0 (2026-06-15)


### Features

* **docker-compose:** add @zuke/docker-compose tool-wrapper package ([#22](https://github.com/zuke-build/zuke/issues/22)) ([fa95fcb](https://github.com/zuke-build/zuke/commit/fa95fcb5a4626d6c2025b30567a9f8e459524b68))
