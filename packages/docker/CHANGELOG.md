# Changelog

## [1.0.1](https://github.com/zuke-build/zuke/compare/docker-v1.0.0...docker-v1.0.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.0.0](https://github.com/zuke-build/zuke/compare/docker-v0.4.0...docker-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/docker` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.4.0](https://github.com/zuke-build/zuke/compare/docker-v0.3.2...docker-v0.4.0) (2026-07-27)


### Features

* add missing typed builders, DenoSettings.frozen, and --frozen scaffolding ([#268](https://github.com/zuke-build/zuke/issues/268)) ([8549b12](https://github.com/zuke-build/zuke/commit/8549b127216a37fd176cfc2e091d558de43c98a8))

## [0.3.2](https://github.com/zuke-build/zuke/compare/docker-v0.3.1...docker-v0.3.2) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.3.1](https://github.com/zuke-build/zuke/compare/docker-v0.3.0...docker-v0.3.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.3.0](https://github.com/zuke-build/zuke/compare/docker-v0.2.0...docker-v0.3.0) (2026-06-16)


### Features

* document AbsolutePath support across the tool-wrapper packages ([#37](https://github.com/zuke-build/zuke/issues/37)) ([94c8ccb](https://github.com/zuke-build/zuke/commit/94c8ccb22dde1ccddc7264bff7bdb3b4a2cb5d5e))

## [0.2.0](https://github.com/zuke-build/zuke/compare/docker-v0.1.0...docker-v0.2.0) (2026-06-16)


### Features

* add oxlint, eslint, cspell, jest, and vitest tool wrappers ([#26](https://github.com/zuke-build/zuke/issues/26)) ([69a8871](https://github.com/zuke-build/zuke/commit/69a88712439c7396e175c7fa6ca6636a5bed8f45))

## 0.1.0 (2026-06-15)


### Features

* **docker:** add @zuke/docker tool-wrapper package ([#21](https://github.com/zuke-build/zuke/issues/21)) ([96a46ec](https://github.com/zuke-build/zuke/commit/96a46ec38f55f85d6149f6e228fa853d736f0eb8))
