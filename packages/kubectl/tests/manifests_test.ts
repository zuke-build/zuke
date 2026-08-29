// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { KubectlDiffSettings, KubectlReplaceSettings } from "../mod.ts";

Deno.test("diff renders its flags", () => {
  assertEquals(
    new KubectlDiffSettings()
      .namespace("prod")
      .file("k8s/")
      .recursive()
      .serverSide()
      .forceConflicts()
      .prune()
      .selector("app=api")
      .showManagedFields()
      .concurrency(4)
      .argv()
      .slice(1),
    [
      "diff",
      "--namespace",
      "prod",
      "-f",
      "k8s/",
      "-R",
      "--server-side",
      "--force-conflicts",
      "--prune",
      "-l",
      "app=api",
      "--show-managed-fields",
      "--concurrency=4",
    ],
  );
  assertEquals(
    new KubectlDiffSettings().kustomize("overlays/prod").argv().slice(1),
    ["diff", "-k", "overlays/prod"],
  );
});

Deno.test("diff refuses the combinations kubectl would reject", () => {
  assertThrows(
    () => new KubectlDiffSettings().argv(),
    Error,
    "KubectlTasks.diff: .file() or .kustomize() is required",
  );
  assertThrows(
    () => new KubectlDiffSettings().file("a.yaml").kustomize("o/").argv(),
    Error,
    "KubectlTasks.diff: .file() and .kustomize() are mutually exclusive",
  );
  assertThrows(
    () => new KubectlDiffSettings().kustomize("o/").recursive().argv(),
    Error,
    "KubectlTasks.diff: .kustomize() cannot be combined with .recursive()",
  );
  // --force-conflicts only means anything to a server-side apply.
  assertThrows(
    () => new KubectlDiffSettings().file("a.yaml").forceConflicts().argv(),
    Error,
    "KubectlTasks.diff: .forceConflicts() only applies to a server-side apply",
  );
});

Deno.test("replace renders its flags", () => {
  assertEquals(
    new KubectlReplaceSettings()
      .file("k8s/api.yaml")
      .force()
      .gracePeriod(0)
      .timeout("60s")
      .cascade("foreground")
      .wait()
      .dryRun("server")
      .argv()
      .slice(1),
    [
      "replace",
      "-f",
      "k8s/api.yaml",
      "--force",
      "--grace-period=0",
      "--timeout=60s",
      "--cascade=foreground",
      "--wait",
      "--dry-run=server",
    ],
  );
});

Deno.test("replace refuses a zero grace period without a force", () => {
  // kubectl accepts --grace-period=0 only alongside --force; without it the
  // command fails at the server rather than in the build.
  assertThrows(
    () => new KubectlReplaceSettings().file("a.yaml").gracePeriod(0).argv(),
    Error,
    "KubectlTasks.replace: kubectl accepts .gracePeriod(0) only with .force()",
  );
  assertEquals(
    new KubectlReplaceSettings().file("a.yaml").gracePeriod(30).argv().slice(1),
    ["replace", "-f", "a.yaml", "--grace-period=30"],
  );
  assertThrows(
    () => new KubectlReplaceSettings().argv(),
    Error,
    "KubectlTasks.replace: .file() or .kustomize() is required",
  );
  assertThrows(
    () => new KubectlReplaceSettings().file("a").kustomize("b").argv(),
    Error,
    "KubectlTasks.replace: .file() and .kustomize() are mutually exclusive",
  );
  assertThrows(
    () => new KubectlReplaceSettings().kustomize("b").recursive().argv(),
    Error,
    "KubectlTasks.replace: .kustomize() cannot be combined with .recursive()",
  );
});
