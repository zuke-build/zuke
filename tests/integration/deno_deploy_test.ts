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
 * runs a small script with the running `deno`, so nothing reaches Deno
 * Deploy. Like the fake brew, the shim does not run on Windows.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import { DenoDeployTasks } from "../../packages/deno/mod.ts";
import { runCli } from "./_harness.ts";

const TOKEN = "ddp_integration_token_never_printed";
const SECRET = "sk-integration-secret-never-printed";

/**
 * The fake `deno`: prints its argv and whether the expected token arrived in
 * the environment, and exits 3 when an argv token equals `FAKE_FAIL_ON`.
 */
const FAKE = `
const ok = Deno.env.get("DENO_DEPLOY_TOKEN") === Deno.env.get("FAKE_TOKEN");
console.log("fake-deploy " + JSON.stringify(Deno.args) + " token-ok=" + ok);
if (Deno.args.includes(Deno.env.get("FAKE_FAIL_ON") ?? "")) Deno.exit(3);
`;

/** Run `fn` with a fake `deno` shim, removed afterwards. */
async function withFakeDeno(
  fn: (deno: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-it-deploy-" });
  try {
    await Deno.writeTextFile(`${dir}/fake.ts`, FAKE);
    const shim = `${dir}/deno`;
    await Deno.writeTextFile(
      shim,
      `#!/bin/sh\nexec "${Deno.execPath()}" run --no-config --no-lock -A ` +
        `"${dir}/fake.ts" "$@"\n`,
    );
    await Deno.chmod(shim, 0o755);
    await fn(shim);
  } finally {
    await Deno.remove(dir, { recursive: true });
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

Deno.test({
  name: "deno deploy: the token rides the environment, not the argv",
  ignore: Deno.build.os === "windows",
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

Deno.test({
  name: "deno deploy: a failed command fails the run with the secret masked",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const printed: string[] = [];
    let result = { code: -1, out: "", err: "" };
    await withFakeDeno(async (deno) => {
      result = await runCli(release(deno, printed, "API_KEY"), ["deploy"]);
    });
    assertEquals(result.code, 1);
    assertEquals(printed, []);
    const shown = result.out + result.err;
    assertStringIncludes(shown, "API_KEY [redacted]");
    assertEquals(shown.includes(SECRET), false);
  },
});
