# Changelog

## [1.5.2](https://github.com/zuke-build/zuke/compare/ai-v1.5.1...ai-v1.5.2) (2026-07-20)


### Bug Fixes

* **ai:** harden the review/fix pipeline against secret and injection risks ([#222](https://github.com/zuke-build/zuke/issues/222)) ([714dc03](https://github.com/zuke-build/zuke/commit/714dc033c4c81c71b64c84f45c122cc0b40971bb))

## [1.5.1](https://github.com/zuke-build/zuke/compare/ai-v1.5.0...ai-v1.5.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [1.5.0](https://github.com/zuke-build/zuke/compare/ai-v1.4.2...ai-v1.5.0) (2026-07-17)


### Features

* **core:** document all public API symbols to raise JSR score ([#163](https://github.com/zuke-build/zuke/issues/163)) ([6e21b1b](https://github.com/zuke-build/zuke/commit/6e21b1bf312e39faac95473e34c87eeee7398eef))

## [1.4.2](https://github.com/zuke-build/zuke/compare/ai-v1.4.1...ai-v1.4.2) (2026-07-16)


### Bug Fixes

* **ai:** make internal settings fields private to complete the API docs ([#158](https://github.com/zuke-build/zuke/issues/158)) ([9daaeec](https://github.com/zuke-build/zuke/commit/9daaeeca4b308f0cb599dbcc7c56afaeccb047b5))

## [1.4.1](https://github.com/zuke-build/zuke/compare/ai-v1.4.0...ai-v1.4.1) (2026-07-09)


### Bug Fixes

* **ai:** sync harden-runner pin with generated ai-review.yml ([#144](https://github.com/zuke-build/zuke/issues/144)) ([22e8afc](https://github.com/zuke-build/zuke/commit/22e8afce1d396a11deadfe4804e1ce6af39e2931))

## [1.4.0](https://github.com/zuke-build/zuke/compare/ai-v1.3.0...ai-v1.4.0) (2026-06-29)


### Features

* **ai:** make suppressed findings auditable in the review report ([#129](https://github.com/zuke-build/zuke/issues/129)) ([aea4b8b](https://github.com/zuke-build/zuke/commit/aea4b8b09317f00fc65f68953d4f64851812b175))
* **ai:** token/cost budgets, response caching, and learned false-positive suppression ([#126](https://github.com/zuke-build/zuke/issues/126)) ([c8ba51f](https://github.com/zuke-build/zuke/commit/c8ba51fca1e46baada43542a3929d9f6545e30cc))

## [1.3.0](https://github.com/zuke-build/zuke/compare/ai-v1.2.0...ai-v1.3.0) (2026-06-28)


### Features

* **ai:** agent-delegation fixer (agentFixer) and propose-vs-apply reporting ([#125](https://github.com/zuke-build/zuke/issues/125)) ([82d3311](https://github.com/zuke-build/zuke/commit/82d3311a9dc8cf50cbae2ebb864e4f441b575a57))
* self-healing builds — recoverWith primitive and aiFixer ([#122](https://github.com/zuke-build/zuke/issues/122)) ([ad6b54a](https://github.com/zuke-build/zuke/commit/ad6b54a1b9a3602a927b08acbc37ea2af6aa0966))

## [1.2.0](https://github.com/zuke-build/zuke/compare/ai-v1.1.0...ai-v1.2.0) (2026-06-23)


### Features

* **core:** make run() entry-aware so builds drop the import.meta.main guard ([#114](https://github.com/zuke-build/zuke/issues/114)) ([a9dac17](https://github.com/zuke-build/zuke/commit/a9dac1728ea1de5f6d5abfc8400e57b41bc1d9a7))

## [1.1.0](https://github.com/zuke-build/zuke/compare/ai-v1.0.0...ai-v1.1.0) (2026-06-23)


### Features

* **ai:** built-in rubric for genericReviewer, criteria as fine-tuning, Gemini dogfood ([#105](https://github.com/zuke-build/zuke/issues/105)) ([6a48538](https://github.com/zuke-build/zuke/commit/6a4853849c5cba630f02c299e9694fec8cad2ec9))
* **ai:** cross-platform PR commenting — GitLab, Azure, Bitbucket ([#110](https://github.com/zuke-build/zuke/issues/110)) ([eabb0be](https://github.com/zuke-build/zuke/commit/eabb0befc102ec95333983710e34c444ce1cfec9))
* **ai:** generate the AI-review workflow for GitLab, Azure and Bitbucket too ([#111](https://github.com/zuke-build/zuke/issues/111)) ([9a8996b](https://github.com/zuke-build/zuke/commit/9a8996bbfac73ad485514d9feead172ab28b50e2))
* **ai:** generate the AI-review workflow from declared reviewers ([#109](https://github.com/zuke-build/zuke/issues/109)) ([df94a1c](https://github.com/zuke-build/zuke/commit/df94a1c2aac786edee11d582bb9174a9dccf0829))
* **ai:** retry the provider call on transient failures ([#108](https://github.com/zuke-build/zuke/issues/108)) ([e771ac1](https://github.com/zuke-build/zuke/commit/e771ac1555b68940c6da63eb8ad04769165d0550))


### Bug Fixes

* **ai:** validate baseBranch and target before they reach the shell ([#112](https://github.com/zuke-build/zuke/issues/112)) ([c0c245e](https://github.com/zuke-build/zuke/commit/c0c245e9d28a73ff6acd276da189260f6fc50827))

## 1.0.0 (2026-06-23)


### Features

* add @zuke/ai code-review package and target validations ([#100](https://github.com/zuke-build/zuke/issues/100)) ([710c2be](https://github.com/zuke-build/zuke/commit/710c2be15d5eb9c91d71b89e695b6a4ce7edb645))
* **ai:** post the review as a PR comment and report token usage ([#102](https://github.com/zuke-build/zuke/issues/102)) ([159e30f](https://github.com/zuke-build/zuke/commit/159e30f5ceed7af5a395e0b5a99cb48fae8a85ef))
