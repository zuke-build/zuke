/**
 * `@zuke/nest` — typed NestJS CLI (`nest`) task wrappers for Zuke builds.
 *
 * Wraps the [`@nestjs/cli`](https://docs.nestjs.com) `nest` command in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda; the task builds the argv and runs it.
 *
 * ```ts
 * import { NestTasks } from "jsr:@zuke/nest";
 * await NestTasks.generate((s) => s.schematic("service").name("users"));
 * await NestTasks.build((s) => s.webpack());
 * ```
 *
 * @module
 */

export * from "./src/nest.ts";
