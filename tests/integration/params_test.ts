/**
 * Integration: build parameters (`--<flag>`, `.env()`, `.options()`,
 * `.boolean()`, `.secret()`), driven through the real CLI. Each test defines a
 * fixture build whose target reads `this.<param>.value`, runs it via
 * {@link runCli}, and asserts on the exit code plus captured output — so the
 * whole parse → resolve → execute path is exercised, not a unit seam.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, REDACTED, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

Deno.test("a missing required parameter fails the build with a clear error", async () => {
  class Deploy extends Build {
    environment = parameter("Target environment").required();
    deploy = target().executes(() => {});
  }
  const { code, err } = await runCli(Deploy, ["deploy"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "--environment is required");
});

Deno.test("a required array parameter is enforced through the CLI", async () => {
  const seen: string[][] = [];
  class Deploy extends Build {
    repos = parameter("repos to deploy").required().array();
    deploy = target().executes(() => void seen.push(this.repos.value));
  }
  // Unsupplied: the build fails before running, not a silent empty list.
  const missing = await runCli(Deploy, ["deploy"]);
  assertEquals(missing.code, 1);
  assertStringIncludes(missing.err, "--repos is required");
  assertEquals(seen, []);
  // Supplied: the target sees the parsed list.
  const ok = await runCli(Deploy, ["deploy", "--repos", "a,b,c"]);
  assertEquals(ok.code, 0);
  assertEquals(seen, [["a", "b", "c"]]);
});

Deno.test("options() rejects an invalid value and accepts a valid one", async () => {
  class Deploy extends Build {
    environment = parameter("Target environment").options("dev", "prod")
      .required();
    deploy = target().executes(() => {
      console.log(`env=${this.environment.value}`);
    });
  }

  const bad = await runCli(Deploy, ["deploy", "--environment", "staging"]);
  assertEquals(bad.code, 1);
  assertStringIncludes(bad.err, "expected one of dev, prod");

  const good = await runCli(Deploy, ["deploy", "--environment", "prod"]);
  assertEquals(good.code, 0);
  assertStringIncludes(good.out, "env=prod");
});

Deno.test("a boolean flag resolves true when present and false when absent", async () => {
  const log: Array<boolean> = [];
  class Deploy extends Build {
    verbose = parameter("Verbose logging").boolean();
    deploy = target().executes(() => void log.push(this.verbose.value));
  }

  const present = await runCli(Deploy, ["deploy", "--verbose"]);
  assertEquals(present.code, 0);

  const absent = await runCli(Deploy, ["deploy"]);
  assertEquals(absent.code, 0);

  assertEquals(log, [true, false]);
});

Deno.test("a parameter falls back to its .env() variable when no flag is given", async () => {
  const prev = Deno.env.get("DEPLOY_TOKEN");
  Deno.env.set("DEPLOY_TOKEN", "from-env");
  try {
    const log: string[] = [];
    class Deploy extends Build {
      token = parameter("Token").env("DEPLOY_TOKEN").required();
      deploy = target().executes(() => void log.push(this.token.value));
    }
    const { code } = await runCli(Deploy, ["deploy"]);
    assertEquals(code, 0);
    assertEquals(log, ["from-env"]);
  } finally {
    if (prev === undefined) Deno.env.delete("DEPLOY_TOKEN");
    else Deno.env.set("DEPLOY_TOKEN", prev);
  }
});

Deno.test("a secret parameter's value is redacted if it leaks into reported output", async () => {
  // A target that echoes the secret via its own console.log bypasses the
  // executor's reporter entirely (runCli captures the raw console, not a
  // filtered stream), so that path isn't observable through the CLI. What is
  // observable: the executor reports a failing target's thrown error message
  // through its (redacting) reporter, so a secret leaked into an error is
  // masked before it reaches stderr — see resolveParameters/execute in
  // packages/core/src/params.ts and src/executor.ts.
  class Deploy extends Build {
    token = parameter("Token").secret().required();
    deploy = target().executes(() => {
      throw new Error(`auth rejected token ${this.token.value}`);
    });
  }
  const { code, err } = await runCli(Deploy, ["deploy", "--token", "hunter2"]);
  assertEquals(code, 1);
  assertStringIncludes(err, REDACTED);
  assertEquals(err.includes("hunter2"), false);
});
