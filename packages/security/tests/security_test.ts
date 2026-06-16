import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
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
      .format("sarif").minSeverity("medium").persona("auditor").offline()
      .paths(".github/workflows", "extra.yml").argv(),
    [
      "zizmor",
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

const M = "zz-no-such-security-binary-zz";

/**
 * Point a settings object at a guaranteed-missing binary with the Windows shim
 * fallback disabled, so each SecurityTasks function reaches execution and raises
 * a {@link ToolNotFoundError} on every platform — without invoking real tools.
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath(M);
};

Deno.test("every SecurityTasks function reaches execution", async () => {
  const calls: Array<() => Promise<unknown>> = [
    () => SecurityTasks.zizmor(missing),
    () => SecurityTasks.actionlint(missing),
    () => SecurityTasks.gitleaks(missing),
    () => SecurityTasks.osvScanner(missing),
    () => SecurityTasks.semgrep(missing),
    () => SecurityTasks.trivyFs(missing),
    () => SecurityTasks.trivyConfig(missing),
  ];
  for (const call of calls) {
    await assertRejects(call, ToolNotFoundError);
  }
});
