// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `ChocolateyTasks.verifyJob`: the job it declares, and that a
 * pipeline listing it renders a Windows matrix that runs the target.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { Build, cicd, generateCi, target } from "@zuke/core";
import { ChocolateyTasks } from "../mod.ts";

/** A build with a verifying target and the workflow that runs it. */
class Release extends Build {
  verifyPackage = target().description("Verify the Chocolatey package")
    .executes(() => {});
  releaseWorkflow = cicd({
    invokes: [ChocolateyTasks.verifyJob((s) => s.target(this.verifyPackage))],
  });
}

Deno.test("verify job: a Windows matrix running the target", () => {
  const build = new Release();
  const job = ChocolateyTasks.verifyJob((s) => s.target(build.verifyPackage));
  assertEquals(job, {
    target: build.verifyPackage,
    name: "Verify Chocolatey package (${{ matrix.os }})",
    matrix: { os: ["windows-latest"] },
    failFast: false,
  });
});

Deno.test("verify job: the runners are configurable, and each job owns its matrix", () => {
  const build = new Release();
  const job = ChocolateyTasks.verifyJob((s) =>
    s.target(build.verifyPackage).runners("windows-2022", "windows-2025")
  );
  assertEquals(job.matrix, { os: ["windows-2022", "windows-2025"] });
  // Mutating one job's matrix must not leak into the next.
  job.matrix?.os.push("ubuntu-latest");
  const next = ChocolateyTasks.verifyJob((s) => s.target(build.verifyPackage));
  assertEquals(next.matrix, { os: ["windows-latest"] });
});

Deno.test("verify job: it renders as a matrix job in a generated workflow", () => {
  const build = new Release();
  const targets = new Map([["verifyPackage", build.verifyPackage]]);
  const yaml = generateCi(build.releaseWorkflow.pipelineFor(targets), "github");
  assertStringIncludes(yaml, "Verify Chocolatey package (${{ matrix.os }})");
  assertStringIncludes(yaml, 'runs-on: "${{ matrix.os }}"');
  assertStringIncludes(yaml, "- windows-latest");
  assertStringIncludes(yaml, "fail-fast: false");
  assertStringIncludes(yaml, "verifyPackage");
});

Deno.test("verify job: a target and at least one runner are required", () => {
  assertThrows(
    () => ChocolateyTasks.verifyJob((s) => s),
    Error,
    "requires .target(...)",
  );
  const build = new Release();
  assertThrows(
    () =>
      ChocolateyTasks.verifyJob((s) => s.target(build.verifyPackage).runners()),
    Error,
    "at least one .runners(...)",
  );
});
