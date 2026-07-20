/**
 * `@zuke/docs` — typed tasks that turn already-generated API documentation into
 * agent-friendly artifacts, so neither humans nor agents have to guess an API.
 *
 * You supply each package's documentation text (for a Deno workspace, the
 * output of `deno doc`); this package renders it into three things:
 *
 *  - an `llms.txt` index (the llmstxt.org convention),
 *  - a complete `llms-full.txt` reference (the whole surface in one file),
 *  - a generated `## API` block in every package README.
 *
 * It runs no subprocess and depends only on `@zuke/core`, so it works without
 * `deno` on `PATH` and without the `@zuke/deno` package — pair it with whatever
 * produces your doc text (`@zuke/deno`'s `DenoTasks.doc`, a checked-in file, …).
 *
 * ```ts
 * import { DocsTasks } from "jsr:@zuke/docs";
 *
 * const docs = [{ name: "@acme/core", dir: "core", doc: denoDocText }];
 * await DocsTasks.apiDocs(docs, { project: { title: "Acme", summary: "…" } });
 *
 * // In the CI gate:
 * const stale = await DocsTasks.checkApiDocs(docs);
 * if (stale.length > 0) throw new Error(`Stale docs: ${stale.join(", ")}`);
 * ```
 *
 * @module
 */

export type {
  ApiDocsOptions,
  DocLintReport,
  DocLintViolation,
  DocsTasksApi,
  PackageDoc,
  ProjectInfo,
} from "./src/types.ts";
export { DocsTasks } from "./src/tasks.ts";
