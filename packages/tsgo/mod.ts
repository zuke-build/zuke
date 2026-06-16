/**
 * `@zuke/tsgo` — typed `tsgo` task wrappers for Zuke builds.
 *
 * `tsgo` is the native TypeScript compiler (TypeScript 7 /
 * `@typescript/native-preview`). Configure a fluent settings object in a
 * lambda; the task builds the argv and runs it.
 *
 * ```ts
 * import { TsgoTasks } from "jsr:@zuke/tsgo";
 * await TsgoTasks.tsgo((s) => s.project("tsconfig.json").noEmit());
 * ```
 *
 * @module
 */

export * from "./src/tsgo.ts";
