# Changelog

## [1.3.0](https://github.com/zuke-build/zuke/compare/gh-v1.2.0...gh-v1.3.0) (2026-08-10)


### Features

* **gh:** post a check run without duplicating it ([#319](https://github.com/zuke-build/zuke/issues/319)) ([f8a74ec](https://github.com/zuke-build/zuke/commit/f8a74ec5a7407d551497880428bd91450bc73942))


### Bug Fixes

* **gh:** persist the dispatch marker before dispatching the workflow ([#315](https://github.com/zuke-build/zuke/issues/315)) ([f76cb9e](https://github.com/zuke-build/zuke/commit/f76cb9ea59b42ddb793bac7af5ecd8999703d271))

## [1.2.0](https://github.com/zuke-build/zuke/compare/gh-v1.1.0...gh-v1.2.0) (2026-08-10)


### Features

* cut the action release from CI, and propose its pin as a pull request ([#312](https://github.com/zuke-build/zuke/issues/312)) ([4449731](https://github.com/zuke-build/zuke/commit/4449731fcc7a82a0f7b3c6625cbef3ab41f76217))

## [1.1.0](https://github.com/zuke-build/zuke/compare/gh-v1.0.0...gh-v1.1.0) (2026-08-07)


### Features

* **core:** prepare every workflow step for generation ([#295](https://github.com/zuke-build/zuke/issues/295)) ([29e54ee](https://github.com/zuke-build/zuke/commit/29e54ee51335c26d9e50acc0bc69d5d8c0152e95))


### Bug Fixes

* **gh:** send app-token permissions under the API's own spelling ([#297](https://github.com/zuke-build/zuke/issues/297)) ([f46aa4e](https://github.com/zuke-build/zuke/commit/f46aa4e9a6544e4def95b9d99a46f351a97a3d89))

## [1.0.0](https://github.com/zuke-build/zuke/compare/gh-v0.4.1...gh-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/gh` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.4.1](https://github.com/zuke-build/zuke/compare/gh-v0.4.0...gh-v0.4.1) (2026-07-23)


### Bug Fixes

* raise the @zuke/core floor to 1.31.0 in wrappers using SubcommandSettings ([#260](https://github.com/zuke-build/zuke/issues/260)) ([d8f51c0](https://github.com/zuke-build/zuke/commit/d8f51c0939d26faa6eb5d7d4bb75bbba241890bb))

## [0.4.0](https://github.com/zuke-build/zuke/compare/gh-v0.3.2...gh-v0.4.0) (2026-07-23)


### Features

* **core:** add a SubcommandSettings base and single-source the HCL wrappers ([#258](https://github.com/zuke-build/zuke/issues/258)) ([53b2719](https://github.com/zuke-build/zuke/commit/53b2719d25f48400c757ac40b7df9f53dd10f7d0))

## [0.3.2](https://github.com/zuke-build/zuke/compare/gh-v0.3.1...gh-v0.3.2) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.3.1](https://github.com/zuke-build/zuke/compare/gh-v0.3.0...gh-v0.3.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.3.0](https://github.com/zuke-build/zuke/compare/gh-v0.2.0...gh-v0.3.0) (2026-07-19)


### Features

* **gh:** created-window workflow correlation and marker fast-fail ([#202](https://github.com/zuke-build/zuke/issues/202)) ([11edc29](https://github.com/zuke-build/zuke/commit/11edc29a5c0e278897f42633afaae88175d506ff))

## [0.2.0](https://github.com/zuke-build/zuke/compare/gh-v0.1.0...gh-v0.2.0) (2026-07-18)


### Features

* **gh:** githubWorkflow wait trigger for cross-repo CI ([#182](https://github.com/zuke-build/zuke/issues/182)) ([0a6a39e](https://github.com/zuke-build/zuke/commit/0a6a39e2db7681b4def4a0abe2da5e11a07cff3d))

## 0.1.0 (2026-06-16)


### Features

* add git and gh tool wrapper packages ([#54](https://github.com/zuke-build/zuke/issues/54)) ([50433b0](https://github.com/zuke-build/zuke/commit/50433b0f14a1cab7ca75dec7d56675018622f7c2))
