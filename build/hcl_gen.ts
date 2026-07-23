/**
 * Single-source generator for the Terraform and OpenTofu wrappers. `@zuke/tofu`
 * is a near-verbatim twin of `@zuke/terraform` — OpenTofu mirrors Terraform's
 * CLI — so both packages' sources are generated from one shared body template
 * (`internal/hcl_tool.ts.tmpl`) plus a per-tool module-doc file, keeping them
 * from drifting. Keeping them as two published, dependency-free packages (rather
 * than one depending on the other) preserves the "wrappers depend only on core"
 * rule while OpenTofu and Terraform continue to diverge.
 *
 * `hclGen` regenerates the two package files; `hclSyncCheck` fails if either has
 * drifted from the template — the same generate-then-verify pattern as the API
 * docs.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { DenoTasks } from "@zuke/deno";

/** One generated wrapper: its names, binary, output path, and module-doc source. */
export interface HclTarget {
  /** The PascalCase class/task prefix, e.g. `Terraform`. */
  name: string;
  /** The CLI binary the wrapper drives, e.g. `terraform`. */
  tool: string;
  /** The generated source file (repo-relative). */
  path: string;
  /** The per-tool module-doc block injected at the top of the output. */
  docPath: string;
}

/** The shared body template both wrappers are generated from. */
export const HCL_TEMPLATE = "internal/hcl_tool.ts.tmpl";

/** The wrappers generated from {@link HCL_TEMPLATE}. */
export const HCL_TARGETS: HclTarget[] = [
  {
    name: "Terraform",
    tool: "terraform",
    path: "packages/terraform/src/terraform.ts",
    docPath: "internal/terraform.moduledoc.txt",
  },
  {
    name: "Tofu",
    tool: "tofu",
    path: "packages/tofu/src/tofu.ts",
    docPath: "internal/tofu.moduledoc.txt",
  },
];

/**
 * Substitute the template's placeholders for one target. The module doc is
 * injected **last**, so its own prose (which mentions the tool names) is never
 * re-substituted.
 */
export function renderHcl(
  template: string,
  moduleDoc: string,
  target: HclTarget,
): string {
  return template
    .replaceAll("__NAME__", target.name)
    .replaceAll("__TOOL__", target.tool)
    .replace("__MODULE_DOC__", moduleDoc.trimEnd());
}

/**
 * Render one target's canonical, formatted source. The two tools' differing name
 * lengths wrap near the 80-column margin differently, so each output is run
 * through `deno fmt` independently rather than assumed identical after
 * substitution.
 */
async function canonicalSource(target: HclTarget): Promise<string> {
  const template = await FileTasks.readText(HCL_TEMPLATE);
  const moduleDoc = await FileTasks.readText(target.docPath);
  const raw = renderHcl(template, moduleDoc, target);
  const dir = await Deno.makeTempDir({ dir: Deno.cwd(), prefix: ".hclgen-" });
  try {
    const tmp = `${dir}/out.ts`;
    await FileTasks.writeText(tmp, raw);
    await DenoTasks.fmt((s) => s.paths(tmp).quiet());
    return await FileTasks.readText(tmp);
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
}

/** Regenerate every wrapper source from the template; returns the paths written. */
export async function generateHclWrappers(
  targets: HclTarget[] = HCL_TARGETS,
): Promise<string[]> {
  const written: string[] = [];
  for (const target of targets) {
    await FileTasks.writeText(target.path, await canonicalSource(target));
    written.push(target.path);
  }
  return written;
}

/** The wrapper files whose committed content has drifted from the template. */
export async function checkHclWrappers(
  targets: HclTarget[] = HCL_TARGETS,
): Promise<string[]> {
  const stale: string[] = [];
  for (const target of targets) {
    const expected = await canonicalSource(target);
    const actual = await FileTasks.readText(target.path);
    if (expected !== actual) stale.push(target.path);
  }
  return stale;
}
