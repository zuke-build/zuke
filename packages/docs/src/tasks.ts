/**
 * {@link DocsTasks} — the public, task-shaped surface of `@zuke/docs`.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { resolveOptions } from "./options.ts";
import { generate } from "./generate.ts";
import { docLintDefects, parseDocLint } from "./doc_lint.ts";
import type {
  ApiDocsOptions,
  DocLintReport,
  DocLintViolation,
  DocsTasksApi,
  PackageDoc,
} from "./types.ts";

/** The artifacts whose intended content differs from what is on disk. */
async function pending(
  docs: PackageDoc[],
  options: ApiDocsOptions,
): Promise<Array<[string, string]>> {
  const resolved = resolveOptions(options);
  const out: Array<[string, string]> = [];
  for (const [path, content] of await generate(docs, resolved)) {
    const current = (await FileTasks.exists(path))
      ? await FileTasks.readText(path)
      : null;
    if (current !== content) out.push([path, content]);
  }
  return out;
}

/** Typed tasks for generating and verifying API documentation. */
export const DocsTasks: DocsTasksApi = {
  async apiDocs(
    docs: PackageDoc[],
    options: ApiDocsOptions = {},
  ): Promise<string[]> {
    const changed = await pending(docs, options);
    for (const [path, content] of changed) {
      await FileTasks.writeText(path, content);
    }
    return changed.map(([path]) => path);
  },

  async checkApiDocs(
    docs: PackageDoc[],
    options: ApiDocsOptions = {},
  ): Promise<string[]> {
    return (await pending(docs, options)).map(([path]) => path);
  },

  checkDocLint(reports: DocLintReport[]): DocLintViolation[] {
    const violations: DocLintViolation[] = [];
    for (const report of reports) {
      const accepted = new Set(report.crossPackageTypes);
      for (
        const defect of docLintDefects(parseDocLint(report.output), accepted)
      ) {
        violations.push({
          pkg: report.pkg,
          kind: defect.kind,
          message: defect.message,
        });
      }
    }
    return violations;
  },
};
