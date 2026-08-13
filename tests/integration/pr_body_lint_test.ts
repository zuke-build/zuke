// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the `prBodyLint`-style target wiring — a `.env("PR_BODY")`
 * parameter feeding {@link lintPrBody} and failing the build on any finding —
 * driven through the real CLI, mirroring how `zuke.ts`'s own `prBodyLint`
 * target is wired (see `zuke.ts` and `build/pr_body_lint.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { lintPrBody } from "../../build/pr_body_lint.ts";
import { runCli } from "./_harness.ts";

class Gate extends Build {
  prBody = parameter("Pull request body to lint").env("PR_BODY");
  prBodyLint = target().executes(() => {
    const body = this.prBody.value;
    if (body === undefined || body === "") {
      console.log("no PR body to lint");
      return;
    }
    const findings = lintPrBody(body);
    if (findings.length > 0) {
      throw new Error(
        `PR body has ${findings.length} issue(s); see RELEASING.md:\n  ${
          findings.join("\n  ")
        }`,
      );
    }
    console.log("PR body is clean");
  });
}

/** Run `Gate`'s `prBodyLint` target with `PR_BODY` set to `body` for the call. */
async function runWithPrBody(body: string | undefined) {
  const prev = Deno.env.get("PR_BODY");
  if (body === undefined) {
    Deno.env.delete("PR_BODY");
  } else {
    Deno.env.set("PR_BODY", body);
  }
  try {
    return await runCli(Gate, ["prBodyLint"]);
  } finally {
    if (prev === undefined) Deno.env.delete("PR_BODY");
    else Deno.env.set("PR_BODY", prev);
  }
}

Deno.test("no PR_BODY env (a push run, or local): the target is a clean no-op", async () => {
  const { code, out } = await runWithPrBody(undefined);
  assertEquals(code, 0);
  assertStringIncludes(out, "no PR body to lint");
});

Deno.test("a clean PR body passes the gate", async () => {
  const { code, out } = await runWithPrBody(
    "Fixes the retry logic (see #241).",
  );
  assertEquals(code, 0);
  assertStringIncludes(out, "PR body is clean");
});

Deno.test("a PR body with a member-call fragment fails the gate", async () => {
  const { code, err } = await runWithPrBody(
    'Names the anti-pattern CmdTasks.exec("docker", args) in the cheatsheet.',
  );
  assertEquals(code, 1);
  assertStringIncludes(err, "RELEASING.md");
  assertStringIncludes(err, "code fragment");
});

Deno.test("a PR body with a fenced code block fails the gate and points to RELEASING.md", async () => {
  const { code, err } = await runWithPrBody(
    ["Summary.", "```ts", 'const x = () => "y";', "```"].join("\n"),
  );
  assertEquals(code, 1);
  assertStringIncludes(err, "RELEASING.md");
  assertStringIncludes(err, "fenced code block");
});
