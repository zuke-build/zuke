// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `RemediationContext.redact`.
 *
 * A remediation is the one thing in a run that publishes over the network — a
 * pull-request comment, a job summary — and it does not go through the reporter
 * or the run record, both of which redact what they emit. Its prompt is built
 * from the failed command and its output, so a secret the build holds can come
 * back in whatever it publishes. This proves the redactor reaches it.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  parameter,
  type RemediationContext,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("a remediation can mask a secret the build declared", async () => {
  const seen: string[] = [];

  class Healing extends Build {
    token = parameter("token").secret().default("hunter2");

    lint = target()
      .recoverWith({
        remediate: (context: RemediationContext) => {
          // What a real fixer publishes is a model's reply to a prompt built
          // from this failure, so the secret arrives back inside the text.
          const published = `the model said: use ${this.token.value} to retry`;
          seen.push(context.redact(published));
          return Promise.resolve({ retry: false });
        },
      })
      .executes(() => {
        throw new Error("lint failed");
      });
  }

  const { code } = await runCli(Healing, ["lint"]);
  assertEquals(code, 1); // diagnose-only: the failure still stands
  assertEquals(seen.length, 1);
  assertStringIncludes(seen[0] ?? "", "[redacted]");
  assertEquals(
    (seen[0] ?? "").includes("hunter2"),
    false,
    "the declared secret must not survive redact()",
  );
});
