/**
 * `@zuke/tsc-alias` — typed `tsc-alias` task wrappers for Zuke builds.
 *
 * `tsc-alias` rewrites TypeScript path aliases (the `paths` mapping in
 * `tsconfig.json`) into relative imports in the compiled output, so the emitted
 * JavaScript runs without a path resolver. Configure a fluent settings object in
 * a lambda; the task builds the argv and runs it.
 *
 * ```ts
 * import { TscAliasTasks } from "jsr:@zuke/tsc-alias";
 * await TscAliasTasks.run((s) => s.project("tsconfig.json").resolveFullPaths());
 * ```
 *
 * @module
 */

export * from "./src/tsc_alias.ts";
