# Changelog

## [0.3.3](https://github.com/zuke-build/zuke/compare/kubectl-v0.3.2...kubectl-v0.3.3) (2026-07-22)


### Bug Fixes

* **kubectl:** reject invalid flag combinations in top, annotate, label ([#251](https://github.com/zuke-build/zuke/issues/251)) ([7de68b1](https://github.com/zuke-build/zuke/commit/7de68b15e4dc1d3db42875b1e593fa1e27d8c40f))

## [0.3.2](https://github.com/zuke-build/zuke/compare/kubectl-v0.3.1...kubectl-v0.3.2) (2026-07-20)


### Bug Fixes

* align kubectl/jest/git wrapper argv with the real CLIs ([#229](https://github.com/zuke-build/zuke/issues/229)) ([0a78d84](https://github.com/zuke-build/zuke/commit/0a78d8437651611de6c6d3b76676af9907536c6b))
* satisfy deno doc --lint across all packages and gate it ([#230](https://github.com/zuke-build/zuke/issues/230)) ([28aa1aa](https://github.com/zuke-build/zuke/commit/28aa1aa9833a69ee2ef63c3f1566ce975867f010))

## [0.3.1](https://github.com/zuke-build/zuke/compare/kubectl-v0.3.0...kubectl-v0.3.1) (2026-07-19)


### Bug Fixes

* pin @zuke/core ^1.25.0 across wrappers so fromNodeModules resolves ([#213](https://github.com/zuke-build/zuke/issues/213)) ([ef9baa5](https://github.com/zuke-build/zuke/commit/ef9baa50e64fa7b2382520c970d255534dbb6daa))

## [0.3.0](https://github.com/zuke-build/zuke/compare/kubectl-v0.2.0...kubectl-v0.3.0) (2026-07-19)


### Features

* **core:** runs list --counts and typed kubectl getNamespaces ([#211](https://github.com/zuke-build/zuke/issues/211)) ([b0d9a61](https://github.com/zuke-build/zuke/commit/b0d9a615b9e86c72b8965f5982e24c540f9933e9))

## [0.2.0](https://github.com/zuke-build/zuke/compare/kubectl-v0.1.0...kubectl-v0.2.0) (2026-07-19)


### Features

* **gcloud:** typed gcloud subcommands, GCS + Secret Manager REST, kubectl annotate/label ([#204](https://github.com/zuke-build/zuke/issues/204)) ([2c721a9](https://github.com/zuke-build/zuke/commit/2c721a9d104bc3ea9ffb09ae99af79b5877d3b66))

## 0.1.0 (2026-06-18)


### Features

* add @zuke/kubectl tool wrapper for Kubernetes ([#64](https://github.com/zuke-build/zuke/issues/64)) ([8065d6a](https://github.com/zuke-build/zuke/commit/8065d6adf42e90893372b3e52eac96d4a72b1904))
