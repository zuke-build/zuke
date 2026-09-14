// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for the redactor a run hands to the things that publish:
 * `RemediationContext.redact` and `ValidationContext.redact`.
 *
 * A remediation and a validation are what publish over the network — a
 * pull-request comment, a review thread, a job summary — and neither goes
 * through the reporter or the run record, both of which redact what they emit.
 * What they publish is built from a diff or from a failed command and its
 * output, so a secret the build holds can come back inside it. These prove the
 * redactor reaches both.
 *
 * They live in one file because they are one question asked twice. The two
 * contexts disagreeing about whether a publisher can mask what it publishes is
 * exactly the defect this guards, and that is easier to notice with the cases
 * side by side.
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
  type ValidationContext,
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

Deno.test("a validation can mask a secret the build declared", async () => {
  // The reviewer case: a validation that posts its assessment to a pull
  // request. It never fails the target and never touches the tree, so this is
  // a run that "changed nothing" and still published — which is where an
  // unmasked secret would have gone out unnoticed.
  const seen: string[] = [];

  class Reviewed extends Build {
    token = parameter("token").secret().default("hunter2");

    lint = target()
      .validateAfter({
        validate: (context: ValidationContext) => {
          const published = `the model said: ${this.token.value} looks wrong`;
          seen.push(context.redact(published));
        },
      })
      .executes(() => {});
  }

  const { code } = await runCli(Reviewed, ["lint"]);
  assertEquals(code, 0);
  assertEquals(seen.length, 1);
  assertStringIncludes(seen[0] ?? "", "[redacted]");
  assertEquals(
    (seen[0] ?? "").includes("hunter2"),
    false,
    "the declared secret must not survive redact()",
  );
});

Deno.test("a validateBefore gate gets the same redactor", async () => {
  // Pinned separately because the two hooks are two call sites: one of them
  // being wired and the other not is the shape this would regress into.
  const seen: string[] = [];

  class Gated extends Build {
    token = parameter("token").secret().default("hunter2");

    lint = target()
      .validateBefore({
        validate: (context: ValidationContext) => {
          seen.push(context.redact(`before saw ${this.token.value}`));
        },
      })
      .executes(() => {});
  }

  const { code } = await runCli(Gated, ["lint"]);
  assertEquals(code, 0);
  assertEquals(seen.length, 1);
  assertEquals((seen[0] ?? "").includes("hunter2"), false);
});
