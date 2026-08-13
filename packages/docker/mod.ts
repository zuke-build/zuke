// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/docker` — typed `docker` CLI task wrappers for Zuke builds.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 *
 * await DockerTasks.build((s) => s.tag("app:1.0").file("Dockerfile"));
 * await DockerTasks.push((s) => s.image("app:1.0"));
 * ```
 *
 * @module
 */

export * from "./src/docker.ts";
