// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { missingTool } from "@zuke/core/tooling/conformance";
import {
  NpmAuditSettings,
  NpmLsSettings,
  NpmOutdatedSettings,
  NpmSbomSettings,
  NpmTasks,
} from "../mod.ts";
import { parseAuditSummary, parseOutdated } from "../src/inspect.ts";

Deno.test("ls renders its depth and grouping options", () => {
  assertEquals(
    new NpmLsSettings().all().long().parseable().depth(0).omit("dev")
      .spec("react").argv().slice(1),
    [
      "ls",
      "--all",
      "--long",
      "--parseable",
      "--depth=0",
      "--omit=dev",
      "react",
    ],
  );
});

Deno.test("outdated renders its scope options", () => {
  assertEquals(
    new NpmOutdatedSettings().all().long().workspace("app")
      .packages("typescript").argv().slice(1),
    ["outdated", "--all", "--long", "--workspace=app", "typescript"],
  );
});

Deno.test("audit renders its subcommands, and refuses two at once", () => {
  assertEquals(
    new NpmAuditSettings().auditLevel("high").omit("dev").packageLockOnly()
      .argv().slice(1),
    ["audit", "--audit-level=high", "--package-lock-only", "--omit=dev"],
  );
  assertEquals(
    new NpmAuditSettings().fix().dryRun().argv().slice(1),
    ["audit", "fix", "--dry-run"],
  );
  assertEquals(new NpmAuditSettings().signatures().argv().slice(1), [
    "audit",
    "signatures",
  ]);
  assertThrows(
    () => new NpmAuditSettings().fix().signatures().argv(),
    Error,
    "NpmTasks.audit: .fix() installs updates and .signatures() verifies",
  );
});

Deno.test("sbom requires the format npm has no default for", () => {
  assertThrows(
    () => new NpmSbomSettings().argv(),
    Error,
    "NpmTasks.sbom: .sbomFormat(...) is required",
  );
  assertEquals(
    new NpmSbomSettings().sbomFormat("spdx").sbomType("library")
      .packageLockOnly().omit("dev").argv().slice(1),
    [
      "sbom",
      "--sbom-format=spdx",
      "--sbom-type=library",
      "--package-lock-only",
      "--omit=dev",
    ],
  );
});

Deno.test("parseOutdated reads npm's package-keyed payload", () => {
  const stdout = JSON.stringify({
    typescript: {
      current: "5.4.0",
      wanted: "5.4.5",
      latest: "5.6.2",
      location: "node_modules/typescript",
      dependent: "app",
    },
    // A package that is not installed at all reports no `current`.
    eslint: { wanted: "9.0.0", latest: "9.0.0" },
  });
  assertEquals(parseOutdated(stdout), [
    {
      name: "typescript",
      current: "5.4.0",
      wanted: "5.4.5",
      latest: "5.6.2",
      location: "node_modules/typescript",
      dependent: "app",
    },
    { name: "eslint", wanted: "9.0.0", latest: "9.0.0" },
  ]);
});

Deno.test("parseOutdated treats nothing-to-report as no entries", () => {
  // npm prints `{}` when everything is current, and nothing at all in some
  // versions; a proxy error page is not JSON. None of them is a crash.
  assertEquals(parseOutdated("{}"), []);
  assertEquals(parseOutdated(""), []);
  assertEquals(parseOutdated("   \n"), []);
  assertEquals(parseOutdated("<html>502</html>"), []);
  assertEquals(parseOutdated("[1,2]"), []);
  // A value that is not an object is not an entry.
  assertEquals(parseOutdated(JSON.stringify({ typescript: "5.4.0" })), []);
});

Deno.test("parseAuditSummary reads the nested vulnerability counts", () => {
  const stdout = JSON.stringify({
    metadata: {
      vulnerabilities: {
        info: 1,
        low: 2,
        moderate: 3,
        high: 4,
        critical: 5,
        total: 15,
      },
    },
  });
  assertEquals(parseAuditSummary(stdout), {
    info: 1,
    low: 2,
    moderate: 3,
    high: 4,
    critical: 5,
    total: 15,
  });
});

Deno.test("parseAuditSummary falls back to the sum, and reads an absent payload as clean", () => {
  const withoutTotal = JSON.stringify({
    metadata: { vulnerabilities: { high: 2, critical: 1 } },
  });
  assertEquals(parseAuditSummary(withoutTotal).total, 3);
  assertEquals(parseAuditSummary(withoutTotal).high, 2);

  const clean = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };
  assertEquals(parseAuditSummary(""), clean);
  assertEquals(parseAuditSummary("not json"), clean);
  assertEquals(parseAuditSummary(JSON.stringify({})), clean);
  assertEquals(parseAuditSummary(JSON.stringify({ metadata: 7 })), clean);
  assertEquals(
    parseAuditSummary(JSON.stringify({ metadata: { vulnerabilities: 7 } })),
    clean,
  );
  // A count npm reports as a non-number is not a count.
  assertEquals(
    parseAuditSummary(
      JSON.stringify({ metadata: { vulnerabilities: { high: "many" } } }),
    ),
    clean,
  );
});

Deno.test("the inspecting tasks reach execution", async () => {
  await assertRejects(() => NpmTasks.ls(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.outdated(missingTool), ToolNotFoundError);
  await assertRejects(() => NpmTasks.audit(missingTool), ToolNotFoundError);
  await assertRejects(
    () => NpmTasks.sbom((s) => missingTool(s).sbomFormat("spdx")),
    ToolNotFoundError,
  );
  // The value-returning forms must fail on a missing npm rather than reporting
  // "nothing is outdated" and "no vulnerabilities" from empty output.
  await assertRejects(
    () => NpmTasks.outdatedEntries((s) => missingTool(s)),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NpmTasks.auditSummary((s) => missingTool(s)),
    ToolNotFoundError,
  );
});

Deno.test("the inspecting commands render their remaining options", () => {
  assertEquals(
    new NpmLsSettings().workspaces().argv().slice(1),
    ["ls", "--workspaces"],
  );
  assertEquals(
    new NpmOutdatedSettings().workspaces().argv().slice(1),
    ["outdated", "--workspaces"],
  );
  assertEquals(
    new NpmAuditSettings().include("dev").workspaces().argv().slice(1),
    ["audit", "--include=dev", "--workspaces"],
  );
  assertEquals(
    new NpmSbomSettings().sbomFormat("cyclonedx").workspaces().argv().slice(1),
    ["sbom", "--sbom-format=cyclonedx", "--workspaces"],
  );
});
