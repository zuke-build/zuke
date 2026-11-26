// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the Terraform/OpenTofu single-source generator (`build/hcl_gen.ts`):
 * `renderHcl` is pure and checked directly; the committed wrappers must
 * round-trip through generate → check; and a corrupted target must be flagged as
 * drifted (the guarantee `hclSyncCheck` rests on).
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { test } from "./_testing.ts";
import { assertEquals } from "./_assert.ts";
import {
  checkHclWrappers,
  type HclTarget,
  renderHcl,
} from "../build/hcl_gen.ts";
import type { Formatter } from "../build/fmt_text.ts";

/** A formatter that changes nothing, so a test needs no real one. */
const unchanged: Formatter = (source) => Promise.resolve(source);
import { withTemp } from "./_temp.ts";

test("renderHcl substitutes body placeholders and injects the module doc last", () => {
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

test("checkHclWrappers flags a target that has drifted from the template", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/drifted.ts`;
    await FileTasks.writeText(path, "// not what the template renders\n");
    const targets: HclTarget[] = [
      {
        name: "Terraform",
        tool: "terraform",
        path,
        docPath: "internal/terraform.moduledoc.txt",
      },
    ];
    assertEquals(await checkHclWrappers(targets, unchanged), [path]);
  });
});
