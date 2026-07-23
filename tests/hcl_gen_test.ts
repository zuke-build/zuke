/**
 * Tests for the Terraform/OpenTofu single-source generator (`build/hcl_gen.ts`):
 * `renderHcl` is pure and checked directly; the committed wrappers must
 * round-trip through generate → check; and a corrupted target must be flagged as
 * drifted (the guarantee `hclSyncCheck` rests on).
 *
 * @module
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  checkHclWrappers,
  generateHclWrappers,
  type HclTarget,
  renderHcl,
} from "../build/hcl_gen.ts";

Deno.test("renderHcl substitutes body placeholders and injects the module doc last", () => {
  const template = '__MODULE_DOC__\nclass __NAME__X { tool = "__TOOL__"; }';
  const out = renderHcl(template, "/** doc mentions __NAME__ verbatim */\n", {
    name: "Terraform",
    tool: "terraform",
    path: "x",
    docPath: "y",
  });
  // Body placeholders are substituted; the module doc is injected last, so its
  // own `__NAME__` text is left literal (never re-substituted).
  assertEquals(
    out,
    '/** doc mentions __NAME__ verbatim */\nclass TerraformX { tool = "terraform"; }',
  );
});

Deno.test("the committed wrappers round-trip through generate then check", async () => {
  // Regenerating writes byte-identical content (they are already generated), so
  // the working tree is unchanged and the check then reports zero drift.
  const written = await generateHclWrappers();
  assertEquals(written.length, 2);
  assertEquals(await checkHclWrappers(), []);
});

Deno.test("checkHclWrappers flags a target that has drifted from the template", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/drifted.ts`;
    await Deno.writeTextFile(path, "// not what the template renders\n");
    const targets: HclTarget[] = [
      {
        name: "Terraform",
        tool: "terraform",
        path,
        docPath: "internal/terraform.moduledoc.txt",
      },
    ];
    assertEquals(await checkHclWrappers(targets), [path]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
