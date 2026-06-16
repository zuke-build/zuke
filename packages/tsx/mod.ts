/**
 * `@zuke/tsx` — typed `tsx` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Runs a TypeScript entry point directly, one-shot by default or in
 * watch mode via `.watch()`.
 *
 * ```ts
 * import { TsxTasks } from "jsr:@zuke/tsx";
 * await TsxTasks.run((s) => s.script("src/main.ts").tsconfig("tsconfig.json"));
 * ```
 *
 * @module
 */

export * from "./src/tsx.ts";
