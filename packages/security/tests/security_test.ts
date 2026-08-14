// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  ActionlintSettings,
  GitleaksDetectSettings,
  OsvScannerSettings,
  SecurityTasks,
  SemgrepScanSettings,
  TrivyConfigSettings,
  TrivyFsSettings,
  ZizmorSettings,
} from "../src/security.ts";

Deno.test("zizmor: full and minimal argv", () => {
  assertEquals(
    new ZizmorSettings()
      .config("zizmor.yml").format("sarif").minSeverity("medium")
      .persona("auditor").offline()
      .paths(".github/workflows", "extra.yml").argv(),
    [
      "zizmor",
      "--config",
      "zizmor.yml",
      "--format",
      "sarif",
      "--min-severity",
      "medium",
      "--persona",
      "auditor",
      "--offline",
      ".github/workflows",
      "extra.yml",
    ],
  );
  assertEquals(new ZizmorSettings().argv(), ["zizmor"]);
});

Deno.test("actionlint: full and minimal argv", () => {
  assertEquals(
    new ActionlintSettings()
      .format("{{json .}}").color().files("ci.yml").argv(),
    ["actionlint", "-format", "{{json .}}", "-color", "ci.yml"],
  );
  assertEquals(
    new ActionlintSettings().noColor().argv(),
    ["actionlint", "-no-color"],
  );
  assertEquals(new ActionlintSettings().argv(), ["actionlint"]);
});

Deno.test("gitleaks: full and minimal argv", () => {
  assertEquals(
    new GitleaksDetectSettings()
      .source(".").config(".gitleaks.toml").reportFormat("sarif")
      .reportPath("gl.sarif").redact().noGit().verbose().argv(),
    [
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--config",
      ".gitleaks.toml",
      "--report-format",
      "sarif",
      "--report-path",
      "gl.sarif",
      "--redact",
      "--no-git",
      "--verbose",
    ],
  );
  assertEquals(new GitleaksDetectSettings().argv(), ["gitleaks", "detect"]);
});

Deno.test("gitleaks: logOpts scopes the commits scanned", () => {
  // Without a range, `detect` walks the history reachable from every ref in the
  // checkout, so a secret on an unrelated branch fails the scan.
  assertEquals(
    new GitleaksDetectSettings()
      .source(".").redact().logOpts("origin/master..HEAD").argv(),
    [
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--redact",
      "--log-opts",
      "origin/master..HEAD",
    ],
  );
  // Absent by default: a full-history scan stays the default behaviour.
  assertEquals(
    new GitleaksDetectSettings().source(".").argv().includes("--log-opts"),
    false,
  );
});

Deno.test("osv-scanner: full and minimal argv", () => {
  assertEquals(
    new OsvScannerSettings()
      .lockfile("deno.lock").lockfile("b/deno.lock").format("sarif")
      .output("osv.sarif").recursive().paths("packages").argv(),
    [
      "osv-scanner",
      "--lockfile",
      "deno.lock",
      "--lockfile",
      "b/deno.lock",
      "--format",
      "sarif",
      "--output",
      "osv.sarif",
      "--recursive",
      "packages",
    ],
  );
  assertEquals(new OsvScannerSettings().argv(), ["osv-scanner"]);
});

Deno.test("semgrep: full and minimal argv", () => {
  assertEquals(
    new SemgrepScanSettings()
      .config("auto").config("p/ci").sarif().json().output("sg.sarif")
      .error().paths("packages", "zuke.ts").argv(),
    [
      "semgrep",
      "scan",
      "--config",
      "auto",
      "--config",
      "p/ci",
      "--sarif",
      "--json",
      "--output",
      "sg.sarif",
      "--error",
      "packages",
      "zuke.ts",
    ],
  );
  assertEquals(new SemgrepScanSettings().argv(), ["semgrep", "scan"]);
});

Deno.test("trivy fs: full and minimal argv", () => {
  assertEquals(
    new TrivyFsSettings()
      .scanners("vuln", "secret", "misconfig").format("sarif")
      .output("trivy.sarif").severity("HIGH", "CRITICAL").exitCode(1)
      .target("packages").argv(),
    [
      "trivy",
      "fs",
      "--scanners",
      "vuln,secret,misconfig",
      "--format",
      "sarif",
      "--output",
      "trivy.sarif",
      "--severity",
      "HIGH,CRITICAL",
      "--exit-code",
      "1",
      "packages",
    ],
  );
  assertEquals(new TrivyFsSettings().argv(), ["trivy", "fs", "."]);
});

Deno.test("trivy config: full and minimal argv", () => {
  assertEquals(
    new TrivyConfigSettings()
      .format("sarif").output("c.sarif").severity("CRITICAL").exitCode(0)
      .target(".github").argv(),
    [
      "trivy",
      "config",
      "--format",
      "sarif",
      "--output",
      "c.sarif",
      "--severity",
      "CRITICAL",
      "--exit-code",
      "0",
      ".github",
    ],
  );
  assertEquals(new TrivyConfigSettings().argv(), ["trivy", "config", "."]);
});

Deno.test("every SecurityTasks function reaches execution", async () => {
  const calls: Array<() => Promise<unknown>> = [
    () => SecurityTasks.zizmor(missingTool),
    () => SecurityTasks.actionlint(missingTool),
    () => SecurityTasks.gitleaks(missingTool),
    () => SecurityTasks.osvScanner(missingTool),
    () => SecurityTasks.semgrep(missingTool),
    () => SecurityTasks.trivyFs(missingTool),
    () => SecurityTasks.trivyConfig(missingTool),
  ];
  for (const call of calls) {
    await assertRejects(call, ToolNotFoundError);
  }
});

Deno.test("security: every wrapper conforms to the wrapper contract", async () => {
  const wrappers: Array<[() => ToolSettings, string]> = [
    [() => new ZizmorSettings(), "zizmor"],
    [() => new ActionlintSettings(), "actionlint"],
    [() => new GitleaksDetectSettings(), "gitleaks"],
    [() => new OsvScannerSettings(), "osv-scanner"],
    [() => new SemgrepScanSettings(), "semgrep"],
    [() => new TrivyFsSettings(), "trivy"],
  ];
  for (const [makeSettings, tool] of wrappers) {
    await assertWrapperConformance(makeSettings, tool, { resolution: "path" });
  }
});
