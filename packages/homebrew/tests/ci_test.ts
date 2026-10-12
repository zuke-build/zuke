// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `HomebrewTasks.verifyJob`: the job it declares, and that a
 * pipeline listing it renders a macOS + Linux matrix that runs the target.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { Build, cicd, generateCi, target } from "@zuke/core";
import { HomebrewTasks } from "../mod.ts";

/** A build with a verifying target and the workflow that runs it. */
class Release extends Build {
  verifyFormula = target().description("Verify the formula")
    .executes(() => {});
  releaseWorkflow = cicd({
    invokes: [HomebrewTasks.verifyJob((s) => s.target(this.verifyFormula))],
  });
}

Deno.test("verify job: a macOS + Linux matrix running the target", () => {
  const build = new Release();
  const job = HomebrewTasks.verifyJob((s) => s.target(build.verifyFormula));
  assertEquals(job, {
    target: build.verifyFormula,
    name: "Verify formula (${{ matrix.os }})",
    matrix: { os: ["macos-latest", "ubuntu-latest"] },
    failFast: false,
    before: [{
      name: "Put Homebrew on PATH",
      if: "runner.os == 'Linux'",
      run: 'echo "/home/linuxbrew/.linuxbrew/bin" >> "$GITHUB_PATH"',
    }],
  });
});

Deno.test("verify job: the runners are configurable, and each job owns its steps", () => {
  const build = new Release();
  const job = HomebrewTasks.verifyJob((s) =>
    s.target(build.verifyFormula).runners("macos-15", "macos-15-intel")
  );
  assertEquals(job.matrix, { os: ["macos-15", "macos-15-intel"] });
  // Mutating one job's steps must not leak into the next.
  job.before?.push({ run: "true" });
  const next = HomebrewTasks.verifyJob((s) => s.target(build.verifyFormula));
  assertEquals(next.before?.length, 1);
});

Deno.test("verify job: it renders as a matrix job in a generated workflow", () => {
  const build = new Release();
  const targets = new Map([["verifyFormula", build.verifyFormula]]);
  const yaml = generateCi(build.releaseWorkflow.pipelineFor(targets), "github");
  assertStringIncludes(yaml, "Verify formula (${{ matrix.os }})");
  assertStringIncludes(yaml, 'runs-on: "${{ matrix.os }}"');
  assertStringIncludes(yaml, "- macos-latest");
  assertStringIncludes(yaml, "- ubuntu-latest");
  assertStringIncludes(yaml, "fail-fast: false");
  assertStringIncludes(yaml, `if: "runner.os == 'Linux'"`);
  assertStringIncludes(yaml, "run: ./zuke verifyFormula");
});

Deno.test("verify job: a target and at least one runner are required", () => {
  assertThrows(
    () => HomebrewTasks.verifyJob((s) => s),
    Error,
    "requires .target(...)",
  );
  const build = new Release();
  assertThrows(
    () =>
      HomebrewTasks.verifyJob((s) => s.target(build.verifyFormula).runners()),
    Error,
    "at least one .runners(...)",
  );
});
