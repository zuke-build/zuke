// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import {
  changedScannerConfigs,
  SCANNER_CONFIG_FILES,
  scannerConfigDenial,
} from "../build/scanner_policy.ts";

Deno.test("an ordinary diff changes no scanner configuration", () => {
  assertEquals(
    scannerConfigDenial([
      "packages/core/src/executor.ts",
      "docs/caching.md",
      "README.md",
    ]),
    null,
  );
});

Deno.test("adding a gitleaks config is refused, and named", () => {
  const denial = scannerConfigDenial(["src/app.ts", ".gitleaks.toml"]);
  assertEquals(denial === null, false);
  assertStringIncludes(denial ?? "", ".gitleaks.toml");
});

Deno.test("an ignore file is refused as well as a rule file", () => {
  // The two weaken a scan by different routes — one changes the rules, the
  // other exempts a finding — so covering only the rules would miss half.
  assertEquals(scannerConfigDenial([".gitleaksignore"]) === null, false);
});

Deno.test("every listed config is actually refused", () => {
  // Guards the list against an entry that is present but unreachable, e.g. one
  // whose spelling drifts from the constant.
  for (const file of SCANNER_CONFIG_FILES) {
    assertEquals(
      scannerConfigDenial([file]) === null,
      false,
      `${file} is listed but not refused`,
    );
  }
});

Deno.test("both spellings a tool accepts are refused", () => {
  // A check that knew only `.yml` would be walked around with `.yaml`.
  for (
    const pair of [
      [".github/zizmor.yml", ".github/zizmor.yaml"],
      [".github/actionlint.yaml", ".github/actionlint.yml"],
    ]
  ) {
    for (const file of pair) {
      assertEquals(scannerConfigDenial([file]) === null, false, file);
    }
  }
});

Deno.test("several changed configs are all named, in list order", () => {
  const denial = scannerConfigDenial([
    ".gitleaksignore",
    "src/app.ts",
    ".gitleaks.toml",
  ]) ?? "";
  // Listed in the constant's order, not the diff's, so the message reads the
  // same way whichever order git happens to print.
  assertEquals(
    denial.indexOf(".gitleaks.toml") < denial.indexOf(".gitleaksignore"),
    true,
  );
});

Deno.test("blank and padded lines are not treated as paths", () => {
  // `git diff --name-only` output is split on newlines, so the trailing empty
  // line is always there; a naive check would see it as a filename.
  assertEquals(scannerConfigDenial(["", "  ", "src/app.ts", ""]), null);
  assertEquals(changedScannerConfigs([" .gitleaks.toml "]), [".gitleaks.toml"]);
});

Deno.test("a path that merely contains a config name is not refused", () => {
  // The scanners read these at fixed locations; a file of a similar name
  // elsewhere configures nothing, and refusing it would be a false positive a
  // contributor cannot act on.
  assertEquals(
    scannerConfigDenial([
      "docs/.gitleaks.toml",
      "vendor/x/.gitleaksignore",
      "examples/app/.github/zizmor.yml",
    ]),
    null,
  );
});
