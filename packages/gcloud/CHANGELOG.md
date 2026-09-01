# Changelog

## [1.2.0](https://github.com/zuke-build/zuke/compare/gcloud-v1.1.0...gcloud-v1.2.0) (2026-09-01)


### Features

* **gcloud:** type `gcloud run services update` ([#437](https://github.com/zuke-build/zuke/issues/437)) ([f8449b8](https://github.com/zuke-build/zuke/commit/f8449b8e66a35be3c9f0ce05e211d45eef9f9c51)), closes [#432](https://github.com/zuke-build/zuke/issues/432)

## [1.1.0](https://github.com/zuke-build/zuke/compare/gcloud-v1.0.1...gcloud-v1.1.0) (2026-08-30)


### Features

* **gcloud:** type the commands a build drives, with scalar readers ([#427](https://github.com/zuke-build/zuke/issues/427)) ([02d8dc9](https://github.com/zuke-build/zuke/commit/02d8dc9b9bebb44f92d13153f1859923a9dfdc8f))

## [1.0.1](https://github.com/zuke-build/zuke/compare/gcloud-v1.0.0...gcloud-v1.0.1) (2026-08-13)


### Bug Fixes

* **cli:** escape line separators in generated literals; license headers and review docs ([#347](https://github.com/zuke-build/zuke/issues/347)) ([114f842](https://github.com/zuke-build/zuke/commit/114f84246e83fc6fb0bd12b55e8eb04192978074))

## [1.0.0](https://github.com/zuke-build/zuke/compare/gcloud-v0.3.1...gcloud-v1.0.0) (2026-07-30)


### Miscellaneous Chores

* graduate `@zuke/gcloud` to 1.0.0 — the package now follows full semver, so a breaking change bumps its major version

## [0.3.1](https://github.com/zuke-build/zuke/compare/gcloud-v0.3.0...gcloud-v0.3.1) (2026-07-23)


### Bug Fixes

* raise the @zuke/core floor to 1.31.0 in wrappers using SubcommandSettings ([#260](https://github.com/zuke-build/zuke/issues/260)) ([d8f51c0](https://github.com/zuke-build/zuke/commit/d8f51c0939d26faa6eb5d7d4bb75bbba241890bb))

## [0.3.0](https://github.com/zuke-build/zuke/compare/gcloud-v0.2.2...gcloud-v0.3.0) (2026-07-23)


### Features

* **core:** add a SubcommandSettings base and single-source the HCL wrappers ([#258](https://github.com/zuke-build/zuke/issues/258)) ([53b2719](https://github.com/zuke-build/zuke/commit/53b2719d25f48400c757ac40b7df9f53dd10f7d0))

## [0.2.2](https://github.com/zuke-build/zuke/compare/gcloud-v0.2.1...gcloud-v0.2.2) (2026-07-20)


### Bug Fixes

* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.2.1](https://github.com/zuke-build/zuke/compare/gcloud-v0.2.0...gcloud-v0.2.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.2.0](https://github.com/zuke-build/zuke/compare/gcloud-v0.1.0...gcloud-v0.2.0) (2026-07-19)


### Features

* **gcloud:** typed gcloud subcommands, GCS + Secret Manager REST, kubectl annotate/label ([#204](https://github.com/zuke-build/zuke/issues/204)) ([2c721a9](https://github.com/zuke-build/zuke/commit/2c721a9d104bc3ea9ffb09ae99af79b5877d3b66))

## 0.1.0 (2026-06-16)


### Features

* add dprint and gcloud tool wrapper packages ([#49](https://github.com/zuke-build/zuke/issues/49)) ([abdf5ac](https://github.com/zuke-build/zuke/commit/abdf5acdefd26957c71142cdccd0c59198898122))
