/**
 * `@zuke/gh` — a typed `gh` (GitHub CLI) task wrapper for Zuke builds.
 *
 * A flexible command builder: name the command with `.command(...)`, set
 * `--repo`, and pass anything else with `.flag(...)`.
 *
 * ```ts
 * import { GhTasks } from "jsr:@zuke/gh";
 * await GhTasks.run((s) => s.command("pr", "list").flag("state", "open"));
 * ```
 *
 * @module
 */

export * from "./src/gh.ts";
