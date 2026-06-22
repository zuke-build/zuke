# Changelog

## [1.1.0](https://github.com/zuke-build/zuke/compare/core-v1.0.0...core-v1.1.0) (2026-06-22)


### Features

* **core:** document AnnounceTasks and fix wrapper publishing ([#98](https://github.com/zuke-build/zuke/issues/98)) ([d656b69](https://github.com/zuke-build/zuke/commit/d656b69ff151d37c737a9a1b1d16a18f6b301829))

## [1.0.0](https://github.com/zuke-build/zuke/compare/core-v0.14.0...core-v1.0.0) (2026-06-22)


### Documentation

* **core:** document semantic-versioning stability for 1.0.0 ([#91](https://github.com/zuke-build/zuke/issues/91)) ([c9bf2bf](https://github.com/zuke-build/zuke/commit/c9bf2bf172528eb3107d537cc4facc27ec81d9e6))

## [0.14.0](https://github.com/zuke-build/zuke/compare/core-v0.13.0...core-v0.14.0) (2026-06-21)


### Features

* extract reusable build utils and replace CmdTasks in the build ([#88](https://github.com/zuke-build/zuke/issues/88)) ([c0fe3ca](https://github.com/zuke-build/zuke/commit/c0fe3caf4ee14fa4fa24c0f06c6f22827eb483f7))

## [0.13.0](https://github.com/zuke-build/zuke/compare/core-v0.12.0...core-v0.13.0) (2026-06-18)


### Features

* **core:** add a Plugin lifecycle contract for extensions ([#81](https://github.com/zuke-build/zuke/issues/81)) ([eef7ddd](https://github.com/zuke-build/zuke/commit/eef7ddd2cf6e2ae04c035ef53074b01a56eb7d1b))
* **core:** add assertion and control-flow helpers ([#72](https://github.com/zuke-build/zuke/issues/72)) ([fb32c2e](https://github.com/zuke-build/zuke/commit/fb32c2ee3db56619d35db886e1264ef760188637))
* **core:** add defineTool() for user-defined fluent tool wrappers ([#77](https://github.com/zuke-build/zuke/issues/77)) ([ecb988e](https://github.com/zuke-build/zuke/commit/ecb988e1a76cce941473be8b9f40886cb765152e))
* **core:** add gzip and tar/.tar.gz compression helpers ([#75](https://github.com/zuke-build/zuke/issues/75)) ([94583c7](https://github.com/zuke-build/zuke/commit/94583c7eeb2463f8fb070e04bf49d3c60ea90336))
* **core:** add HTTP download/text/json helpers ([#73](https://github.com/zuke-build/zuke/issues/73)) ([99e4e87](https://github.com/zuke-build/zuke/commit/99e4e8720674a7a243c3e1a557346f77b7808e21))
* **core:** add installRelease() to install release binaries ([#78](https://github.com/zuke-build/zuke/issues/78)) ([a7e371b](https://github.com/zuke-build/zuke/commit/a7e371b7456c39a6ee81f2f257d906bb9117cad8))
* **core:** code-first CI config generation (GitHub, GitLab, Azure) ([#80](https://github.com/zuke-build/zuke/issues/80)) ([8c601ae](https://github.com/zuke-build/zuke/commit/8c601aea561798364d9e505c148c0edc5e969aa0))
* **core:** render the build graph with Cytoscape instead of Mermaid ([#66](https://github.com/zuke-build/zuke/issues/66)) ([8fae4c0](https://github.com/zuke-build/zuke/commit/8fae4c074d216a616bbe3ad7cc2ba3f9b11b559b))


### Bug Fixes

* **core:** only write the GitHub job summary on a default-console run ([#74](https://github.com/zuke-build/zuke/issues/74)) ([b83f4c8](https://github.com/zuke-build/zuke/commit/b83f4c84b68d1eb5e24bc457694062c0602685c9))

## [0.12.0](https://github.com/zuke-build/zuke/compare/core-v0.11.0...core-v0.12.0) (2026-06-17)


### Features

* **core:** reusable components, multi-value params, dry-run, glob, timeout/retry ([#57](https://github.com/zuke-build/zuke/issues/57)) ([3dc6f17](https://github.com/zuke-build/zuke/commit/3dc6f17873a90ed448e0a3ab564294197f294353))

## [0.11.0](https://github.com/zuke-build/zuke/compare/core-v0.10.0...core-v0.11.0) (2026-06-16)


### Features

* **core:** cacheKey, finally targets, secrets, artifacts, host detection, prompts ([#52](https://github.com/zuke-build/zuke/issues/52)) ([bfa2e34](https://github.com/zuke-build/zuke/commit/bfa2e34fc826632b42c2c3f83a371fe01fca1d1d))

## [0.10.0](https://github.com/zuke-build/zuke/compare/core-v0.9.0...core-v0.10.0) (2026-06-16)


### Features

* **core:** visualise parallel groups in the graph ([#51](https://github.com/zuke-build/zuke/issues/51)) ([26b8c91](https://github.com/zuke-build/zuke/commit/26b8c9154e1b6a65a7bb130e872b9fec02381008))

## [0.9.0](https://github.com/zuke-build/zuke/compare/core-v0.8.0...core-v0.9.0) (2026-06-16)


### Features

* **core:** incremental caching, conditions, and more target methods ([#47](https://github.com/zuke-build/zuke/issues/47)) ([c80b9f3](https://github.com/zuke-build/zuke/commit/c80b9f3365c355d6aae1e89235d0b5915653070c))

## [0.8.0](https://github.com/zuke-build/zuke/compare/core-v0.7.0...core-v0.8.0) (2026-06-16)


### Features

* **core:** parallel execution — `--parallel` flag and `group()` batches ([#45](https://github.com/zuke-build/zuke/issues/45)) ([764b785](https://github.com/zuke-build/zuke/commit/764b785dda90e2f8d30100a70ed824822b0f3e05))

## [0.7.0](https://github.com/zuke-build/zuke/compare/core-v0.6.0...core-v0.7.0) (2026-06-16)


### Features

* **core:** add typed build parameters from flags and env ([#43](https://github.com/zuke-build/zuke/issues/43)) ([a2e136d](https://github.com/zuke-build/zuke/commit/a2e136d988abd3bfd841047263b5753f024486b8))

## [0.6.0](https://github.com/zuke-build/zuke/compare/core-v0.5.0...core-v0.6.0) (2026-06-16)


### Features

* add `zuke graph` visualisation and repoRoot config ([#41](https://github.com/zuke-build/zuke/issues/41)) ([a40fbea](https://github.com/zuke-build/zuke/commit/a40fbea0a52b620f07211b15355c903cdb40159e))

## [0.5.0](https://github.com/zuke-build/zuke/compare/core-v0.4.0...core-v0.5.0) (2026-06-16)


### Features

* document AbsolutePath support across the tool-wrapper packages ([#37](https://github.com/zuke-build/zuke/issues/37)) ([94c8ccb](https://github.com/zuke-build/zuke/commit/94c8ccb22dde1ccddc7264bff7bdb3b4a2cb5d5e))

## [0.4.0](https://github.com/zuke-build/zuke/compare/core-v0.3.0...core-v0.4.0) (2026-06-16)


### Features

* **core:** add absolutePath, a NUKE-style fluent path type ([#32](https://github.com/zuke-build/zuke/issues/32)) ([08422e8](https://github.com/zuke-build/zuke/commit/08422e8f72493dc06e8445a5a10f6b54a3f4eb2f))

## [0.3.0](https://github.com/zuke-build/zuke/compare/core-v0.2.0...core-v0.3.0) (2026-06-16)


### Features

* add oxlint, eslint, cspell, jest, and vitest tool wrappers ([#26](https://github.com/zuke-build/zuke/issues/26)) ([69a8871](https://github.com/zuke-build/zuke/commit/69a88712439c7396e175c7fa6ca6636a5bed8f45))

## [0.2.0](https://github.com/zuke-build/zuke/compare/core-v0.1.1...core-v0.2.0) (2026-06-15)


### Features

* **core:** CI-aware, coloured build output with a per-target summary ([#19](https://github.com/zuke-build/zuke/issues/19)) ([fe2a379](https://github.com/zuke-build/zuke/commit/fe2a3798dd8ba68d66291b6248f923013bb1d2db))

## [0.1.1](https://github.com/zuke-build/zuke/compare/core-v0.1.0...core-v0.1.1) (2026-06-15)


### Documentation

* add a README to every package (forces 0.1.1) ([#17](https://github.com/zuke-build/zuke/issues/17)) ([6098b4f](https://github.com/zuke-build/zuke/commit/6098b4f63f93ce45155c5f25779aa293135de938))

## 0.1.0 (2026-06-09)


### Features

* NUKE-style tool wrappers (@zuke/deno, @zuke/npm, @zuke/cmd) + workspace ([#2](https://github.com/zuke-build/zuke/issues/2)) ([c98c4a7](https://github.com/zuke-build/zuke/commit/c98c4a7bb7cc25cc727f98316efcc27025b9c9f5))
