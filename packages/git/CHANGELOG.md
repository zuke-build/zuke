# Changelog

## [1.5.0](https://github.com/zuke-build/zuke/compare/git-v1.4.0...git-v1.5.0) (2026-08-30)


### Features

* **git:** wrap the interrogation commands, with readers ([#424](https://github.com/zuke-build/zuke/issues/424)) ([0ff7405](https://github.com/zuke-build/zuke/commit/0ff7405c834a555f1530e80c00b8006cd813aae0))

## [1.4.0](https://github.com/zuke-build/zuke/compare/git-v1.3.0...git-v1.4.0) (2026-08-28)


### Features

* **git:** expand task coverage and add value-returning forms ([#398](https://github.com/zuke-build/zuke/issues/398)) ([8c82cac](https://github.com/zuke-build/zuke/commit/8c82cac568507f3645c0f9d93ad4c50a83906aac))

## [1.3.0](https://github.com/zuke-build/zuke/compare/git-v1.2.0...git-v1.3.0) (2026-08-26)


### Features

* **git:** branch a worktree from an explicit start point ([#383](https://github.com/zuke-build/zuke/issues/383)) ([4abf1f3](https://github.com/zuke-build/zuke/commit/4abf1f391f1f39a1335582f859b01d5d9ee6b882)), closes [#382](https://github.com/zuke-build/zuke/issues/382)
* **git:** resolve a remote's default branch ([#385](https://github.com/zuke-build/zuke/issues/385)) ([c469b5f](https://github.com/zuke-build/zuke/commit/c469b5f44fa807258bd7027c33eb9480a8ad227f)), closes [#384](https://github.com/zuke-build/zuke/issues/384)

## [1.2.0](https://github.com/zuke-build/zuke/compare/git-v1.1.1...git-v1.2.0) (2026-08-25)


### Features

* **git:** add worktree tasks and a parsed worktree listing ([#377](https://github.com/zuke-build/zuke/issues/377)) ([a6b40fa](https://github.com/zuke-build/zuke/commit/a6b40fac388ee5c70ea64b5fd916edb1e70afdac)), closes [#376](https://github.com/zuke-build/zuke/issues/376)

## [1.1.1](https://github.com/zuke-build/zuke/compare/git-v1.1.0...git-v1.1.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.1.0](https://github.com/zuke-build/zuke/compare/git-v1.0.0...git-v1.1.0) (2026-08-07)


### Features

* **core:** prepare every workflow step for generation ([#295](https://github.com/zuke-build/zuke/issues/295)) ([29e54ee](https://github.com/zuke-build/zuke/commit/29e54ee51335c26d9e50acc0bc69d5d8c0152e95))

## [1.0.0](https://github.com/zuke-build/zuke/compare/git-v0.2.3...git-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/git` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.2.3](https://github.com/zuke-build/zuke/compare/git-v0.2.2...git-v0.2.3) (2026-07-22)


### Bug Fixes

* **git:** fix checkout flag order and support restoring paths ([#252](https://github.com/zuke-build/zuke/issues/252)) ([b66ea9b](https://github.com/zuke-build/zuke/commit/b66ea9b76061fde01ec50da91022996e555c0f46))

## [0.2.2](https://github.com/zuke-build/zuke/compare/git-v0.2.1...git-v0.2.2) (2026-07-20)


### Bug Fixes

* align kubectl/jest/git wrapper argv with the real CLIs ([#229](https://github.com/zuke-build/zuke/issues/229)) ([0a78d84](https://github.com/zuke-build/zuke/commit/0a78d8437651611de6c6d3b76676af9907536c6b))
* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.2.1](https://github.com/zuke-build/zuke/compare/git-v0.2.0...git-v0.2.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.2.0](https://github.com/zuke-build/zuke/compare/git-v0.1.0...git-v0.2.0) (2026-06-18)


### Features

* **git:** add gitInfo() for repository metadata ([#76](https://github.com/zuke-build/zuke/issues/76)) ([57e25b6](https://github.com/zuke-build/zuke/commit/57e25b6eef515449de1da5d780400dd3f5424700))

## [0.1.0](https://github.com/zuke-build/zuke/compare/git-v0.1.0...git-v0.1.0) (2026-06-18)


### Features

* **git:** add gitInfo() for repository metadata ([#76](https://github.com/zuke-build/zuke/issues/76)) ([57e25b6](https://github.com/zuke-build/zuke/commit/57e25b6eef515449de1da5d780400dd3f5424700))

## 0.1.0 (2026-06-16)


### Features

* add git and gh tool wrapper packages ([#54](https://github.com/zuke-build/zuke/issues/54)) ([50433b0](https://github.com/zuke-build/zuke/commit/50433b0f14a1cab7ca75dec7d56675018622f7c2))
