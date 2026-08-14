# Changelog

## [2.2.1](https://github.com/zuke-build/zuke/compare/ai-v2.2.0...ai-v2.2.1) (2026-08-14)


### Bug Fixes

* **ai:** let verify remove only what it can disprove ([#360](https://github.com/zuke-build/zuke/issues/360)) ([8760e0d](https://github.com/zuke-build/zuke/commit/8760e0d9d393198c791c41b18218e6cd80f267a4))

## [2.2.0](https://github.com/zuke-build/zuke/compare/ai-v2.1.1...ai-v2.2.0) (2026-08-13)


### Features

* **gh:** release-asset uploads, the Gemini extension archive, and a coverage push to 98% ([#352](https://github.com/zuke-build/zuke/issues/352)) ([a678f35](https://github.com/zuke-build/zuke/commit/a678f35c3baea51ebb837dbf2cc0e100760ff0ae))

## [2.1.1](https://github.com/zuke-build/zuke/compare/ai-v2.1.0...ai-v2.1.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [2.1.0](https://github.com/zuke-build/zuke/compare/ai-v2.0.0...ai-v2.1.0) (2026-08-13)


### Features

* **ai:** drive review discussions on GitLab, Azure and Bitbucket ([#336](https://github.com/zuke-build/zuke/issues/336)) ([f92f929](https://github.com/zuke-build/zuke/commit/f92f929250e6c8411f6790ad1043794b9477bdab))
* **ai:** findings as inline review threads on GitHub ([#343](https://github.com/zuke-build/zuke/issues/343)) ([0f39ce9](https://github.com/zuke-build/zuke/commit/0f39ce9f103b1d38ca560e0e4ef55c4fcae70077))
* **ai:** point a dismissal at the suppress list as the cross-PR override ([#345](https://github.com/zuke-build/zuke/issues/345)) ([11a2b55](https://github.com/zuke-build/zuke/commit/11a2b55880da50bef1a71a1cf60b69b2209fd08c))
* **ai:** resolve a reworded finding onto the identity it already has ([#338](https://github.com/zuke-build/zuke/issues/338)) ([1533b88](https://github.com/zuke-build/zuke/commit/1533b887a8b2e0954092dee5859280cf08600b3c))


### Bug Fixes

* **ai:** compare a reworded finding against still-open findings too ([#341](https://github.com/zuke-build/zuke/issues/341)) ([5b65329](https://github.com/zuke-build/zuke/commit/5b65329e1514a22a3ad63da1a3be54b8952ba508))
* **ai:** stop model text from forging the review state block ([#340](https://github.com/zuke-build/zuke/issues/340)) ([c6b7115](https://github.com/zuke-build/zuke/commit/c6b71157ddd6f1457bb56d296c473bf6ee68f0b7))

## [2.0.0](https://github.com/zuke-build/zuke/compare/ai-v1.8.1...ai-v2.0.0) (2026-08-12)


### ⚠ BREAKING CHANGES

* **ai:** discussion-driven review with adversarial verify and deeper context ([#334](https://github.com/zuke-build/zuke/issues/334))

### Features

* **ai:** discussion-driven review with adversarial verify and deeper context ([#334](https://github.com/zuke-build/zuke/issues/334)) ([3002b69](https://github.com/zuke-build/zuke/commit/3002b69831f8df2cdf8805cf7f8e6dcfadbda3f8))

## [1.8.1](https://github.com/zuke-build/zuke/compare/ai-v1.8.0...ai-v1.8.1) (2026-08-08)


### Bug Fixes

* release v1.0.2, and repair what cutting it exposed ([#308](https://github.com/zuke-build/zuke/issues/308)) ([87ce09d](https://github.com/zuke-build/zuke/commit/87ce09ddae03558efb01fab657e316b362df89f7))

## [1.8.0](https://github.com/zuke-build/zuke/compare/ai-v1.7.0...ai-v1.8.0) (2026-08-08)


### Features

* **ai:** let core render the review workflow's prelude ([#305](https://github.com/zuke-build/zuke/issues/305)) ([a292fa7](https://github.com/zuke-build/zuke/commit/a292fa7b331080d4bf6dab6fa01dc6cc434d37c7))

## [1.7.0](https://github.com/zuke-build/zuke/compare/ai-v1.6.1...ai-v1.7.0) (2026-08-07)


### Features

* **core:** generate every workflow, sourcing pins from the committed files ([#298](https://github.com/zuke-build/zuke/issues/298)) ([dc12a61](https://github.com/zuke-build/zuke/commit/dc12a61e191f48b13f6f51c9fa7b52228d12c9be))
* **core:** prepare every workflow step for generation ([#295](https://github.com/zuke-build/zuke/issues/295)) ([29e54ee](https://github.com/zuke-build/zuke/commit/29e54ee51335c26d9e50acc0bc69d5d8c0152e95))

## [1.6.1](https://github.com/zuke-build/zuke/compare/ai-v1.6.0...ai-v1.6.1) (2026-07-22)


### Bug Fixes

* **ai:** close AI-review security regressions and hardening tail ([#247](https://github.com/zuke-build/zuke/issues/247)) ([473c95d](https://github.com/zuke-build/zuke/commit/473c95d753036082af243adeed96feb8690b5b89))

## [1.6.0](https://github.com/zuke-build/zuke/compare/ai-v1.5.3...ai-v1.6.0) (2026-07-20)


### Features

* **ai:** honour DiffSettings.fetchBase in the reviewer ([#238](https://github.com/zuke-build/zuke/issues/238)) ([63dae90](https://github.com/zuke-build/zuke/commit/63dae907549ab0cb1656ccfe5cb6513a3033fb21))


### Bug Fixes

* **ai:** cache-key and hash correctness ([#235](https://github.com/zuke-build/zuke/issues/235)) ([8972b57](https://github.com/zuke-build/zuke/commit/8972b57e367b3837aff94582c24665e5c4d4d05c))
* **ai:** cap thrown-fetch backoff and create parent dirs on apply ([#237](https://github.com/zuke-build/zuke/issues/237)) ([023d953](https://github.com/zuke-build/zuke/commit/023d9532f99ae82f3784971680a6c1447a809a78))

## [1.5.3](https://github.com/zuke-build/zuke/compare/ai-v1.5.2...ai-v1.5.3) (2026-07-20)


### Bug Fixes

* **core:** validate MCP Origin and redact URLs; fix ai diff parsing ([#223](https://github.com/zuke-build/zuke/issues/223)) ([0015ad0](https://github.com/zuke-build/zuke/commit/0015ad0ed5964d0244e344431d2eb6e0ecabadee))

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
