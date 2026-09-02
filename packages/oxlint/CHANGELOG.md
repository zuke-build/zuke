# Changelog

## [1.1.0](https://github.com/zuke-build/zuke/compare/oxlint-v1.0.1...oxlint-v1.1.0) (2026-09-02)


### Features

* linters and checkers report their findings on the build summary ([#460](https://github.com/zuke-build/zuke/issues/460)) ([dae6ebd](https://github.com/zuke-build/zuke/commit/dae6ebd33efb56c194e847265c56715bef83a6c1)), closes [#458](https://github.com/zuke-build/zuke/issues/458)

## [1.0.1](https://github.com/zuke-build/zuke/compare/oxlint-v1.0.0...oxlint-v1.0.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.0.0](https://github.com/zuke-build/zuke/compare/oxlint-v0.2.3...oxlint-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/oxlint` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.2.3](https://github.com/zuke-build/zuke/compare/oxlint-v0.2.2...oxlint-v0.2.3) (2026-07-20)


### Bug Fixes

* default JS-ecosystem wrappers to node_modules binary resolution ([#231](https://github.com/zuke-build/zuke/issues/231)) ([51d7206](https://github.com/zuke-build/zuke/commit/51d72060c8b8bb55d302483a0f68c5c5ab46acf3))

## [0.2.2](https://github.com/zuke-build/zuke/compare/oxlint-v0.2.1...oxlint-v0.2.2) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.2.1](https://github.com/zuke-build/zuke/compare/oxlint-v0.2.0...oxlint-v0.2.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.2.0](https://github.com/zuke-build/zuke/compare/oxlint-v0.1.0...oxlint-v0.2.0) (2026-06-16)


### Features

* document AbsolutePath support across the tool-wrapper packages ([#37](https://github.com/zuke-build/zuke/issues/37)) ([94c8ccb](https://github.com/zuke-build/zuke/commit/94c8ccb22dde1ccddc7264bff7bdb3b4a2cb5d5e))

## 0.1.0 (2026-06-16)


### Features

* add oxlint, eslint, cspell, jest, and vitest tool wrappers ([#26](https://github.com/zuke-build/zuke/issues/26)) ([69a8871](https://github.com/zuke-build/zuke/commit/69a88712439c7396e175c7fa6ca6636a5bed8f45))
