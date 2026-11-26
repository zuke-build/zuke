// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `DenoDeployTasks`: a real build, driven through the
 * CLI `main()` entry point, that sets a secret and deploys to production.
 *
 * It proves what a unit test cannot: the token reaches the spawned process in
 * `DENO_DEPLOY_TOKEN` and never its argv, and when a command carrying a
 * secret value fails, the error the build prints masks that value.
 *
 * Hermetic per AGENTS.md guideline 5: the "deno" is a POSIX shell shim that
 * runs a small script with the running runtime, so nothing reaches Deno
 * Deploy. Like the fake brew, the shim does not run on Windows.
 *
 * @module
 */

import { test } from "../_testing.ts";
import { assertEquals, assertStringIncludes } from "../_assert.ts";
import {
  Build,
  FileTasks,
  RuntimeTasks,
  target,
} from "../../packages/core/mod.ts";
import { DenoDeployTasks } from "../../packages/deno/mod.ts";
import { runCli, withoutMaskDirectives } from "./_harness.ts";
import { RUN_SCRIPT } from "../_eval.ts";

const TOKEN = "ddp_integration_token_never_printed";
const SECRET = "sk-integration-secret-never-printed";

/**
 * The fake `deno`: prints its argv and whether the expected token arrived in
 * the environment, and exits 3 when an argv token equals `FAKE_FAIL_ON`.
 */
const FAKE = `
const args = process.argv.slice(2);
const ok = process.env.DENO_DEPLOY_TOKEN === process.env.FAKE_TOKEN;
console.log("fake-deploy " + JSON.stringify(args) + " token-ok=" + ok);
if (args.includes(process.env.FAKE_FAIL_ON ?? "")) process.exit(3);
`;

/** Run `fn` with a fake `deno` shim, removed afterwards. */
async function withFakeDeno(
  fn: (deno: string) => Promise<void>,
): Promise<void> {
  const dir = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-it-deploy-")
  );
  try {
    await FileTasks.writeText(`${dir}/fake.ts`, FAKE);
    const shim = `${dir}/deno`;
    await FileTasks.writeText(
      shim,
      `#!/bin/sh\nexec "${RuntimeTasks.execPath()}" ${RUN_SCRIPT.join(" ")} ` +
        `"${dir}/fake.ts" "$@"\n`,
    );
    await FileTasks.chmod(shim, 0o755);
    await fn(shim);
  } finally {
    await FileTasks.remove(dir, { recursive: true });
  }
}

/**
 * Set a secret, then deploy to production, both through the fake, recording
 * what the fake printed into `printed`.
 */
function release(deno: string, printed: string[], failOn = "-") {
  const env = { FAKE_TOKEN: TOKEN, FAKE_FAIL_ON: failOn };
  return class Release extends Build {
    secret = target().executes(async () => {
      const out = await DenoDeployTasks.envAdd((s) =>
        s.toolPath(deno).env(env).quiet().token(TOKEN)
          .org("acme").app("api").nonInteractive()
          .variable("API_KEY").secretValue(SECRET)
      );
      printed.push(out.stdout.trim());
    });
    deploy = target().dependsOn(this.secret).executes(async () => {
      const out = await DenoDeployTasks.deploy((s) =>
        s.toolPath(deno).env(env).quiet().token(TOKEN)
          .org("acme").app("api").prod().json().nonInteractive()
      );
      printed.push(out.stdout.trim());
    });
  };
}

test({
  name: "deno deploy: the token rides the environment, not the argv",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    const printed: string[] = [];
    await withFakeDeno(async (deno) => {
      const { code, err } = await runCli(release(deno, printed), ["deploy"]);
      assertEquals(code, 0, err);
    });
    assertEquals(printed, [
      'fake-deploy ["deploy","env","add","--org=acme","--app=api",' +
      `"--non-interactive","--secret","API_KEY","${SECRET}"] token-ok=true`,
      'fake-deploy ["deploy","--org=acme","--app=api","--json",' +
      '"--non-interactive","--prod"] token-ok=true',
    ]);
  },
});

test({
  name: "deno deploy: a failed command fails the run with the secret masked",
  ignore: RuntimeTasks.os() === "windows",
  fn: async () => {
    const printed: string[] = [];
    let result = { code: -1, out: "", err: "" };
    await withFakeDeno(async (deno) => {
      result = await runCli(release(deno, printed, "API_KEY"), ["deploy"]);
    });
    assertEquals(result.code, 1);
    assertEquals(printed, []);
    const shown = withoutMaskDirectives(result.out + result.err);
    assertStringIncludes(shown, "API_KEY [redacted]");
    assertEquals(shown.includes(SECRET), false);
  },
});
