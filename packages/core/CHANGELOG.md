# Changelog

## [1.25.0](https://github.com/zuke-build/zuke/compare/core-v1.24.0...core-v1.25.0) (2026-07-19)


### Features

* **core:** npx-style node_modules/.bin tool resolution ([#192](https://github.com/zuke-build/zuke/issues/192)) ([7e8da19](https://github.com/zuke-build/zuke/commit/7e8da19d62d18baeb6d51ca6009a1e32b0cf9492))

## [1.24.0](https://github.com/zuke-build/zuke/compare/core-v1.23.0...core-v1.24.0) (2026-07-19)


### Features

* **core:** timezone-aware schedules in cicd() ([#190](https://github.com/zuke-build/zuke/issues/190)) ([d005e8c](https://github.com/zuke-build/zuke/commit/d005e8c6f3bd879f7663ab589ad0ac8039eb3d8a))

## [1.23.0](https://github.com/zuke-build/zuke/compare/core-v1.22.0...core-v1.23.0) (2026-07-19)


### Features

* **core:** registry-backed dynamic MCP tool discovery ([#188](https://github.com/zuke-build/zuke/issues/188)) ([d9a7d9e](https://github.com/zuke-build/zuke/commit/d9a7d9ed0b123055212f7a10f5c1a8baac76ae72))

## [1.22.0](https://github.com/zuke-build/zuke/compare/core-v1.21.0...core-v1.22.0) (2026-07-19)


### Features

* **core:** pluggable BuildRegistry and zuke register ([#186](https://github.com/zuke-build/zuke/issues/186)) ([b55a876](https://github.com/zuke-build/zuke/commit/b55a876e5dddc4cd2892d0ffa08e442ffc6cbc35))

## [1.21.0](https://github.com/zuke-build/zuke/compare/core-v1.20.0...core-v1.21.0) (2026-07-19)


### Features

* **core:** external graph edges and deep dry-run ([#184](https://github.com/zuke-build/zuke/issues/184)) ([71d321a](https://github.com/zuke-build/zuke/commit/71d321ac66dfab5de1a735dd12fdf51353b1c326))

## [1.20.0](https://github.com/zuke-build/zuke/compare/core-v1.19.0...core-v1.20.0) (2026-07-18)


### Features

* **gh:** githubWorkflow wait trigger for cross-repo CI ([#182](https://github.com/zuke-build/zuke/issues/182)) ([0a6a39e](https://github.com/zuke-build/zuke/commit/0a6a39e2db7681b4def4a0abe2da5e11a07cff3d))

## [1.19.0](https://github.com/zuke-build/zuke/compare/core-v1.18.0...core-v1.19.0) (2026-07-18)


### Features

* **otel:** OTLP export plugin for runs, targets, and waits ([#180](https://github.com/zuke-build/zuke/issues/180)) ([0f3dbee](https://github.com/zuke-build/zuke/commit/0f3dbeee5d26d37cf588707fb8a863c69abf405a))

## [1.18.0](https://github.com/zuke-build/zuke/compare/core-v1.17.0...core-v1.18.0) (2026-07-18)


### Features

* **core:** compensation targets and zuke cancel ([#177](https://github.com/zuke-build/zuke/issues/177)) ([10ce407](https://github.com/zuke-build/zuke/commit/10ce40732413b9d85dba68b137babae0b11ebf0b))
* **core:** richer plugin lifecycle payloads ([#179](https://github.com/zuke-build/zuke/issues/179)) ([8ddf457](https://github.com/zuke-build/zuke/commit/8ddf457f5ea4eb1df5ef893848240568e1a68186))

## [1.17.0](https://github.com/zuke-build/zuke/compare/core-v1.16.0...core-v1.17.0) (2026-07-18)


### Features

* **core:** add zuke runs list/show ([#171](https://github.com/zuke-build/zuke/issues/171)) ([d154ea7](https://github.com/zuke-build/zuke/commit/d154ea73da2545e4d67cadc9e212356c0741802f))
* **core:** forEach fan-out targets with per-item isolation and reporting ([#173](https://github.com/zuke-build/zuke/issues/173)) ([d562ef7](https://github.com/zuke-build/zuke/commit/d562ef7b37d9dfbad22789e2298c80391f6e7e43))
* **core:** MCP authz tiers, audit log, and run-state tools ([#176](https://github.com/zuke-build/zuke/issues/176)) ([a2e247b](https://github.com/zuke-build/zuke/commit/a2e247b0816265773c4a32bbe9077fdf14dcfd42))
* **core:** MCP streamable-HTTP transport ([#174](https://github.com/zuke-build/zuke/issues/174)) ([01abdd6](https://github.com/zuke-build/zuke/commit/01abdd68cde13ae007ed26688013c4e4c507ba41))

## [1.16.0](https://github.com/zuke-build/zuke/compare/core-v1.15.0...core-v1.16.0) (2026-07-17)


### Features

* **core:** suspendable targets with waitsFor and external signals ([#168](https://github.com/zuke-build/zuke/issues/168)) ([fc06a9f](https://github.com/zuke-build/zuke/commit/fc06a9fcac0f6340a6f57790977f2fad0805c5a0))
* **core:** zuke resume with exactly-once run resumption ([#170](https://github.com/zuke-build/zuke/issues/170)) ([ca91ee7](https://github.com/zuke-build/zuke/commit/ca91ee74caf7ce850ebfbf3976e529c742cf6b3d))

## [1.15.0](https://github.com/zuke-build/zuke/compare/core-v1.14.0...core-v1.15.0) (2026-07-17)


### Features

* **core:** cross-run TTL locks with typed conflict errors ([#167](https://github.com/zuke-build/zuke/issues/167)) ([34465f2](https://github.com/zuke-build/zuke/commit/34465f2b9870a98263eb0708d5c42270dbfae3f6))
* **core:** durable run records with a pluggable StateStore ([#166](https://github.com/zuke-build/zuke/issues/166)) ([41b0432](https://github.com/zuke-build/zuke/commit/41b0432e9cebe7f5736ae5dd52068376e51ef55f))
* **core:** pass a typed TargetContext to target bodies ([#164](https://github.com/zuke-build/zuke/issues/164)) ([7884347](https://github.com/zuke-build/zuke/commit/7884347c71aa57bf8478691d300bfcbb364f2c89))

## [1.14.0](https://github.com/zuke-build/zuke/compare/core-v1.13.0...core-v1.14.0) (2026-07-17)


### Features

* **core:** document all public API symbols to raise JSR score ([#163](https://github.com/zuke-build/zuke/issues/163)) ([6e21b1b](https://github.com/zuke-build/zuke/commit/6e21b1bf312e39faac95473e34c87eeee7398eef))

## [1.13.0](https://github.com/zuke-build/zuke/compare/core-v1.12.0...core-v1.13.0) (2026-07-16)


### Features

* **core:** add service() targets for long-lived processes ([#156](https://github.com/zuke-build/zuke/issues/156)) ([ead5a5c](https://github.com/zuke-build/zuke/commit/ead5a5c1f44364323c8d78cc7fae203b7d031dc7))

## [1.12.0](https://github.com/zuke-build/zuke/compare/core-v1.11.0...core-v1.12.0) (2026-07-14)


### Features

* **core:** add zuke mcp, an MCP server over the build ([#154](https://github.com/zuke-build/zuke/issues/154)) ([f9fbc5e](https://github.com/zuke-build/zuke/commit/f9fbc5e3d438216ed9296659d8e3cfa2107a2a19))

## [1.11.0](https://github.com/zuke-build/zuke/compare/core-v1.10.0...core-v1.11.0) (2026-07-14)


### Features

* **core:** source secrets from a manager and redact them from output ([#153](https://github.com/zuke-build/zuke/issues/153)) ([b644687](https://github.com/zuke-build/zuke/commit/b64468785420d21d45658cac4d9a6756369f7759))
* **core:** verified, cached toolchain provisioning ([#151](https://github.com/zuke-build/zuke/issues/151)) ([a16a01b](https://github.com/zuke-build/zuke/commit/a16a01bbdf29723ced76d165eb873f8047ca240a))

## [1.10.0](https://github.com/zuke-build/zuke/compare/core-v1.9.0...core-v1.10.0) (2026-07-13)


### Features

* **core:** distributed caching, affected-target execution, and CI job fan-out ([#148](https://github.com/zuke-build/zuke/issues/148)) ([2c7e1fe](https://github.com/zuke-build/zuke/commit/2c7e1feff4742c7cce3fc4392cd9de6f487e0a53))

## [1.9.0](https://github.com/zuke-build/zuke/compare/core-v1.8.0...core-v1.9.0) (2026-07-02)


### Features

* **console:** add ConsoleTasks and themed console output ([#138](https://github.com/zuke-build/zuke/issues/138)) ([0476516](https://github.com/zuke-build/zuke/commit/04765167994418014647d214b11d270e6359ef5f))

## [1.8.0](https://github.com/zuke-build/zuke/compare/core-v1.7.0...core-v1.8.0) (2026-06-30)


### Features

* **core:** make the CLI surface discoverable to tools and agents ([#136](https://github.com/zuke-build/zuke/issues/136)) ([abaa7d4](https://github.com/zuke-build/zuke/commit/abaa7d42ad2e753f626a74f14bdf09dacc4de706))

## [1.7.0](https://github.com/zuke-build/zuke/compare/core-v1.6.0...core-v1.7.0) (2026-06-30)


### Features

* **core:** add a completions command for shell completion ([#135](https://github.com/zuke-build/zuke/issues/135)) ([54e7500](https://github.com/zuke-build/zuke/commit/54e7500016b9735e3a2db6042ad20ca97e8fbc20))

## [1.6.0](https://github.com/zuke-build/zuke/compare/core-v1.5.0...core-v1.6.0) (2026-06-28)


### Features

* self-healing builds — recoverWith primitive and aiFixer ([#122](https://github.com/zuke-build/zuke/issues/122)) ([ad6b54a](https://github.com/zuke-build/zuke/commit/ad6b54a1b9a3602a927b08acbc37ea2af6aa0966))

## [1.5.0](https://github.com/zuke-build/zuke/compare/core-v1.4.0...core-v1.5.0) (2026-06-23)


### Features

* **core:** make run() entry-aware so builds drop the import.meta.main guard ([#114](https://github.com/zuke-build/zuke/issues/114)) ([a9dac17](https://github.com/zuke-build/zuke/commit/a9dac1728ea1de5f6d5abfc8400e57b41bc1d9a7))

## [1.4.0](https://github.com/zuke-build/zuke/compare/core-v1.3.0...core-v1.4.0) (2026-06-23)


### Features

* **ai:** generate the AI-review workflow for GitLab, Azure and Bitbucket too ([#111](https://github.com/zuke-build/zuke/issues/111)) ([9a8996b](https://github.com/zuke-build/zuke/commit/9a8996bbfac73ad485514d9feead172ab28b50e2))
* **ai:** generate the AI-review workflow from declared reviewers ([#109](https://github.com/zuke-build/zuke/issues/109)) ([df94a1c](https://github.com/zuke-build/zuke/commit/df94a1c2aac786edee11d582bb9174a9dccf0829))
* **core:** typed CI-host detection and richer CI workflow model ([#107](https://github.com/zuke-build/zuke/issues/107)) ([4df69dc](https://github.com/zuke-build/zuke/commit/4df69dc68d62b733b14f4121f2252f2630413510))

## [1.3.0](https://github.com/zuke-build/zuke/compare/core-v1.2.0...core-v1.3.0) (2026-06-23)


### Features

* **core:** richer console output and end-of-build summary ([#103](https://github.com/zuke-build/zuke/issues/103)) ([404076f](https://github.com/zuke-build/zuke/commit/404076f2e32aca73644a44fb01faba82f3a8abae))

## [1.2.0](https://github.com/zuke-build/zuke/compare/core-v1.1.0...core-v1.2.0) (2026-06-23)


### Features

* add @zuke/ai code-review package and target validations ([#100](https://github.com/zuke-build/zuke/issues/100)) ([710c2be](https://github.com/zuke-build/zuke/commit/710c2be15d5eb9c91d71b89e695b6a4ce7edb645))

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
