// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `redactUrl` from the public `@zuke/core` surface, used the way a
 * build or a package uses it — to report a failing request without the
 * credentials its URL carried — and run through the real CLI.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import {
  Build,
  redactUrl,
  redactUrls,
  target,
} from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** A webhook URL with a password and a token, as a build might hold one. */
const HOOK =
  "https://deploy:hunter2@hooks.example/notify?token=abc&channel=ops";

class Notify extends Build {
  notify = target().executes(() => {
    throw new Error(`could not reach ${redactUrl(HOOK)}`);
  });
}

Deno.test("a failure reported through redactUrl never shows the URL's credentials", async () => {
  const { code, out, err } = await runCli(Notify, ["notify"]);
  assertEquals(code, 1);
  const shown = out + err;
  assertStringIncludes(
    shown,
    "could not reach https://hooks.example/notify?token=REDACTED&channel=ops",
  );
  for (const secret of ["hunter2", "deploy:", "token=abc"]) {
    assertEquals(shown.includes(secret), false, secret);
  }
});

class Fetcher extends Build {
  fetchIt = target().executes(() => {
    // An error from below quoting the URL it failed on, as fetch's does.
    const cause = `error sending request for url (${HOOK}): connection refused`;
    throw new Error(redactUrls(cause));
  });
}

Deno.test("redactUrls cleans every URL a wrapped error quotes", async () => {
  const { code, out, err } = await runCli(Fetcher, ["fetchIt"]);
  assertEquals(code, 1);
  const shown = out + err;
  assertStringIncludes(shown, "connection refused");
  for (const secret of ["hunter2", "deploy:", "token=abc"]) {
    assertEquals(shown.includes(secret), false, secret);
  }
});
