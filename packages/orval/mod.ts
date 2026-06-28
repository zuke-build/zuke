/**
 * `@zuke/orval` — typed `orval` task wrappers for Zuke builds.
 *
 * `orval` is an OpenAPI client and mock generator (https://orval.dev). It reads
 * an OpenAPI specification and generates a type-safe TypeScript client and
 * optional mocks. Configure a fluent settings object in a lambda; the task
 * builds the argv and runs it.
 *
 * ```ts
 * import { OrvalTasks } from "jsr:@zuke/orval";
 * await OrvalTasks.generate((s) => s.config("orval.config.ts").clean());
 * ```
 *
 * @module
 */

export * from "./src/orval.ts";
