/**
 * `@zuke/codecov` — a typed Codecov CLI (`codecovcli`) task wrapper for Zuke
 * builds.
 *
 * `upload` runs `codecovcli upload-process` to send coverage reports to
 * Codecov; the token is read from `CODECOV_TOKEN` so it never lands in argv.
 *
 * ```ts
 * import { CodecovTasks } from "jsr:@zuke/codecov";
 * await CodecovTasks.upload((s) => s.files("cov.lcov").flags("unit"));
 * ```
 *
 * @module
 */

export * from "./src/codecov.ts";
