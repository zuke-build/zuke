# Changelog

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
