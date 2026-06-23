/**
 * `@zuke/docs` — typed tasks for generating and verifying API documentation
 * across a Zuke (or any JSR-style) workspace, from a single source of truth:
 * `deno doc`.
 *
 * {@link DocsTasks.apiDocs} turns each package's `deno doc` into three
 * artifacts so neither humans nor agents have to guess an API:
 *
 *  - an `llms.txt` index (the llmstxt.org convention),
 *  - a complete `llms-full.txt` reference (the whole typed surface in one file),
 *  - a generated `## API` block in every package README.
 *
 * {@link DocsTasks.checkApiDocs} recomputes the same artifacts and reports any
 * that are stale on disk — run it in CI to fail when the docs drift from code.
 *
 * ```ts
 * import { DocsTasks } from "jsr:@zuke/docs";
 *
 * // In a build target:
 * await DocsTasks.apiDocs(["core", "deno"], { scope: "@acme" });
 *
 * // In the CI gate:
 * const stale = await DocsTasks.checkApiDocs(["core", "deno"], { scope: "@acme" });
 * if (stale.length > 0) throw new Error(`Stale docs: ${stale.join(", ")}`);
 * ```
 *
 * @module
 */

export type { ApiDocsOptions, DocsTasksApi, ProjectInfo } from "./src/types.ts";
export { DocsTasks } from "./src/tasks.ts";
