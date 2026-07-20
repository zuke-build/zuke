import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { execute, type Reporter } from "../src/executor.ts";
import {
  type AnyParameter,
  discoverParameters,
  envVarName,
  flagName,
  Parameter,
  parameter,
  ParameterError,
  resolveParameters,
} from "../src/params.ts";
import { REDACTED, Redactor } from "../src/redact.ts";
import type { SecretSource } from "../src/secret.ts";

/** A canned secret source that yields a fixed value, for hermetic tests. */
function fixedSource(value: string): SecretSource {
  return { resolve: () => Promise.resolve(value) };
}

/** A secret source that always fails, for the error path. */
function failingSource(message: string): SecretSource {
  return { resolve: () => Promise.reject(new Error(message)) };
}

/** A reporter that records every line it is given. */
function recordingReporter(): { reporter: Reporter; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    reporter: {
      info: (line) => void lines.push(line),
      error: (line) => void lines.push(line),
    },
  };
}

Deno.test("a fresh parameter is an optional string", () => {
  const p = parameter("desc");
  p.resolve_(undefined);
  assertEquals(p.value, undefined);
  p.resolve_("hello");
  assertEquals(p.value, "hello");
});

Deno.test("reading a value before resolution throws", () => {
  assertThrows(
    () => parameter("x").value,
    ParameterError,
    "before it was resolved",
  );
});

Deno.test("default makes the value definite", () => {
  const p = parameter("desc").default("Debug");
  p.resolve_(undefined);
  assertEquals(p.value, "Debug");
  p.resolve_("Release");
  assertEquals(p.value, "Release");
  assertEquals(p.required_, false);
  assertEquals(p.hasFallback_, true);
});

Deno.test("required has no fallback and stays unresolved without input", () => {
  const p = parameter("desc").required();
  assertEquals([p.required_, p.hasFallback_], [true, false]);
  p.resolve_(undefined);
  assertThrows(() => p.value, ParameterError);
});

Deno.test("number parses and rejects non-numbers", () => {
  const p = parameter().number().default(1);
  p.resolve_("42");
  assertEquals(p.value, 42);
  assertThrows(() => p.resolve_("abc"), ParameterError, "expected a number");
  assertThrows(() => p.resolve_(""), ParameterError, "expected a number");
});

Deno.test("boolean parses truthy/falsy spellings and defaults to false", () => {
  const flag = parameter().boolean();
  flag.resolve_(undefined);
  assertEquals(flag.value, false);
  for (const yes of ["true", "1", "yes"]) {
    const p = parameter().boolean();
    p.resolve_(yes);
    assertEquals(p.value, true);
  }
  for (const no of ["false", "0", "no"]) {
    const p = parameter().boolean();
    p.resolve_(no);
    assertEquals(p.value, false);
  }
  assertThrows(
    () => parameter().boolean().resolve_("maybe"),
    ParameterError,
    "expected a boolean",
  );
});

Deno.test("options restrict a string to a fixed set", () => {
  const p = parameter("env").options("dev", "prod");
  assertEquals(p.options_, ["dev", "prod"]);
  p.resolve_("dev");
  assertEquals(p.value, "dev");
  assertThrows(() => p.resolve_("staging"), ParameterError, "expected one of");
});

Deno.test("env overrides the environment variable name", () => {
  const p = parameter("token").env("CI_TOKEN");
  assertEquals(p.envName_, "CI_TOKEN");
});

Deno.test("secret survives chaining and stringValue exposes the value", () => {
  const before = parameter("token").secret().required();
  const after = parameter("token").required().secret();
  assertEquals(before.secret_, true);
  assertEquals(after.secret_, true);
  assertEquals(parameter("plain").secret_, false);

  before.resolve_("hunter2");
  assertEquals(before.stringValue_(), "hunter2");
  assertEquals(parameter("x").stringValue_(), undefined); // unresolved
});

Deno.test("array parses a comma-separated list and defaults to []", () => {
  const p = parameter("tags").array();
  assertEquals(p.array_, true);
  p.resolve_(undefined);
  assertEquals(p.value, []);
  p.resolve_("a, b ,c");
  assertEquals(p.value, ["a", "b", "c"]);
  // Blank entries are dropped.
  p.resolve_("a,,b,");
  assertEquals(p.value, ["a", "b"]);
});

Deno.test("array preserves env override and secret flags", () => {
  const p = parameter("tags").array().env("TAGS").secret();
  assertEquals([p.array_, p.envName_, p.secret_], [true, "TAGS", true]);
});

Deno.test("array parameters resolve through the CLI map (repeated flag joined)", async () => {
  class B extends Build {
    tags = parameter("Tags").array();
  }
  const params = discoverParameters(new B());
  // The CLI joins repeated flags with commas before resolution.
  const errors = await resolveParameters(
    params,
    { tags: "x,y" },
    () => undefined,
  );
  assertEquals(errors, []);
  const p = params.get("tags");
  if (p instanceof Parameter) assertEquals(p.value, ["x", "y"]);
});

Deno.test("resolveParameters prompts for a missing required value", async () => {
  class B extends Build {
    token = parameter("API token").required();
  }
  const params = discoverParameters(new B());
  const errors = await resolveParameters(
    params,
    {},
    () => undefined,
    (flag, description) => {
      assertEquals(flag, "token");
      assertEquals(description, "API token");
      return "from-prompt";
    },
  );
  assertEquals(errors, []);
  const p = params.get("token");
  if (p instanceof Parameter) assertEquals(p.value, "from-prompt");
});

Deno.test("flagName and envVarName convert camelCase and dotted paths", () => {
  assertEquals(flagName("environment"), "environment");
  assertEquals(flagName("targetEnv"), "target-env");
  assertEquals(flagName("release.token"), "release-token");
  assertEquals(envVarName("environment"), "ENVIRONMENT");
  assertEquals(envVarName("targetEnv"), "TARGET_ENV");
  assertEquals(envVarName("release.token"), "RELEASE_TOKEN");
});

Deno.test("discoverParameters recurses into component bundles", () => {
  const component = () => ({ token: parameter("Token").required() });
  class B extends Build {
    release = component();
  }
  const params = discoverParameters(new B());
  assertEquals([...params.keys()], ["release.token"]);
  assertEquals(params.get("release.token")?.name_, "release.token");
});

class Demo extends Build {
  environment = parameter("Target environment").options("dev", "prod")
    .required();
  workers = parameter("Worker count").number().default(2);
  verbose = parameter("Verbose logging").boolean();
}

Deno.test("discoverParameters names and collects parameters", () => {
  const params = discoverParameters(new Demo());
  assertEquals([...params.keys()], ["environment", "workers", "verbose"]);
  assertEquals(params.get("environment")?.name_, "environment");
});

Deno.test("resolveParameters: CLI beats env beats default", async () => {
  const params = discoverParameters(new Demo());
  const env = (name: string) => (name === "WORKERS" ? "8" : undefined);
  const errors = await resolveParameters(params, { environment: "prod" }, env);
  assertEquals(errors, []);
  const get = (n: string): AnyParameter => {
    const p = params.get(n);
    if (!p) throw new Error(`missing ${n}`);
    return p;
  };
  // value is typed on Parameter; narrow via the concrete class.
  const env_ = get("environment");
  if (env_ instanceof Parameter) assertEquals(env_.value, "prod");
  const workers = get("workers");
  if (workers instanceof Parameter) assertEquals(workers.value, 8); // env
  const verbose = get("verbose");
  if (verbose instanceof Parameter) assertEquals(verbose.value, false); // default
});

Deno.test("resolveParameters reports missing required and invalid values", async () => {
  const params = discoverParameters(new Demo());
  const errors = await resolveParameters(
    params,
    { workers: "lots" },
    () => undefined,
  );
  assertEquals(errors.length, 2);
  assertEquals(
    errors.some((e) => e.includes("--environment is required")),
    true,
  );
  assertEquals(
    errors.some((e) => e.includes("--workers: expected a number")),
    true,
  );
});

Deno.test("execute resolves parameters from the params map before running", async () => {
  const seen: string[] = [];
  class Deploy extends Build {
    environment = parameter("env").required();
    deploy = target().executes(() => void seen.push(this.environment.value));
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  const result = await execute(build, root, {
    silent: true,
    params: { environment: "production" },
    readEnv: () => undefined,
  });
  assertEquals(result.ok, true);
  assertEquals(seen, ["production"]);
});

Deno.test("execute resolves parameters from the environment", async () => {
  const seen: string[] = [];
  class Deploy extends Build {
    environment = parameter("env").required();
    deploy = target().executes(() => void seen.push(this.environment.value));
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  const result = await execute(build, root, {
    silent: true,
    readEnv: (name) => (name === "ENVIRONMENT" ? "staging" : undefined),
  });
  assertEquals(result.ok, true);
  assertEquals(seen, ["staging"]);
});

Deno.test("execute fails before running when a required parameter is missing", async () => {
  let ran = false;
  class Deploy extends Build {
    environment = parameter("env").required();
    deploy = target().executes(() => void (ran = true));
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  const result = await execute(build, root, {
    silent: true,
    readEnv: () => undefined,
  });
  assertEquals(result.ok, false);
  assertEquals(ran, false);
  assertEquals(result.error instanceof ParameterError, true);
});

Deno.test("a secret source resolves the value when no flag/env supplied one", async () => {
  class B extends Build {
    token = parameter("Token").secret().from(fixedSource("from-source"));
  }
  const params = discoverParameters(new B());
  const errors = await resolveParameters(params, {}, () => undefined);
  assertEquals(errors, []);
  const p = params.get("token");
  if (p instanceof Parameter) assertEquals(p.value, "from-source");
});

Deno.test("a flag and env both beat a secret source", async () => {
  class B extends Build {
    token = parameter("Token").secret().from(fixedSource("from-source"));
  }
  // CLI wins.
  const viaCli = discoverParameters(new B());
  await resolveParameters(viaCli, { token: "from-cli" }, () => undefined);
  const cli = viaCli.get("token");
  if (cli instanceof Parameter) assertEquals(cli.value, "from-cli");
  // Env wins over the source too.
  const viaEnv = discoverParameters(new B());
  await resolveParameters(
    viaEnv,
    {},
    (name) => (name === "TOKEN" ? "from-env" : undefined),
  );
  const env = viaEnv.get("token");
  if (env instanceof Parameter) assertEquals(env.value, "from-env");
});

Deno.test("a failing secret source is reported as a parameter error", async () => {
  class B extends Build {
    token = parameter("Token").secret().from(failingSource("vault is sealed"));
  }
  const params = discoverParameters(new B());
  const errors = await resolveParameters(params, {}, () => undefined);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], "--token: vault is sealed");
});

Deno.test("from() preserves the source across further configuration", async () => {
  // Order-independent: whether .secret() or .from() comes first, and after a
  // kind change, the source survives.
  class B extends Build {
    a = parameter("A").from(fixedSource("11")).secret().number();
    b = parameter("B").secret().from(fixedSource("later"));
  }
  const params = discoverParameters(new B());
  await resolveParameters(params, {}, () => undefined);
  const a = params.get("a");
  if (a instanceof Parameter) assertEquals(a.value, 11);
  const b = params.get("b");
  if (b instanceof Parameter) assertEquals(b.value, "later");
});

Deno.test("resolveParameters registers a secret's raw value with the redactor", async () => {
  class B extends Build {
    token = parameter("Token").secret().from(fixedSource("top-secret"));
    plain = parameter("Plain").default("visible");
  }
  const params = discoverParameters(new B());
  const redactor = new Redactor();
  await resolveParameters(params, {}, () => undefined, undefined, redactor);
  assertEquals(redactor.size, 1); // only the secret was registered
  assertEquals(
    redactor.redact("using top-secret and visible"),
    `using ${REDACTED} and visible`,
  );
});

Deno.test("execute redacts a secret leaked in a target's failure message", async () => {
  const { reporter, lines } = recordingReporter();
  class Deploy extends Build {
    token = parameter("Token").secret().from(fixedSource("hunter2xyz"));
    deploy = target()
      .description("deploy")
      .executes(() => {
        // A failure that echoes the secret in its message must be masked when
        // the executor reports the failure through its reporter.
        throw new Error(`auth rejected token ${this.token.value}`);
      });
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  // github:false isolates this from the ambient CI env — the point is the
  // platform-independent reporter redaction, not the GitHub `::add-mask::`
  // directive (which intentionally carries the real value; covered separately).
  const result = await execute(build, root, {
    reporter,
    github: false,
    readEnv: () => undefined,
  });
  assertEquals(result.ok, false);
  const joined = lines.join("\n");
  assertStringIncludes(joined, REDACTED);
  assertEquals(joined.includes("hunter2xyz"), false);
});

Deno.test("execute redacts a secret's invalid value from the parameter error", async () => {
  const { reporter, lines } = recordingReporter();
  class Deploy extends Build {
    // A source that yields a non-numeric value fails to parse; the error must
    // not echo the raw secret.
    port = parameter("Port").secret().from(fixedSource("s3cr3t-not-a-number"))
      .number();
    deploy = target().executes(() => {});
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  const result = await execute(build, root, {
    reporter,
    github: false,
    readEnv: () => undefined,
  });
  assertEquals(result.ok, false);
  const joined = lines.join("\n");
  assertEquals(joined.includes("s3cr3t-not-a-number"), false);
  assertStringIncludes(joined, REDACTED);
});

Deno.test("a custom reporter is never handed the raw secret via ::add-mask::", async () => {
  const { reporter, lines } = recordingReporter();
  class Deploy extends Build {
    token = parameter("Token").secret().from(fixedSource("real-value-123"));
    deploy = target().executes(() => {});
  }
  const build = new Deploy();
  const root = discoverTargets(build).get("deploy");
  if (!root) throw new Error("no deploy target");
  await execute(build, root, {
    reporter,
    github: true,
    readEnv: () => undefined,
  });
  // The add-mask directive bypasses redaction (a masked directive hides
  // nothing), so it must reach only the real runner stdout — never a custom
  // reporter, which an embedded execute() supplies. The raw value must not leak
  // in any form. (The positive real-console case is covered in executor_test.)
  assertEquals(lines.some((l) => l.includes("real-value-123")), false);
  assertEquals(lines.some((l) => l.startsWith("::add-mask::")), false);
});

Deno.test("discoverParameters rejects a reserved MCP control name", () => {
  // A parameter field named after a run-tool control key would be shadowed by
  // that key in the MCP input schema, so discovery refuses it.
  class BadDryRun extends Build {
    dryRun = parameter();
  }
  class BadConfirm extends Build {
    confirm = parameter();
  }
  class BadOperatorToken extends Build {
    operatorToken = parameter();
  }
  for (
    const [Bad, name] of [
      [BadDryRun, "dryRun"],
      [BadConfirm, "confirm"],
      [BadOperatorToken, "operatorToken"],
    ] as const
  ) {
    const error = assertThrows(
      () => discoverParameters(new Bad()),
      ParameterError,
    );
    assertStringIncludes(error.message, name);
    assertStringIncludes(error.message, "reserved");
  }
});

Deno.test("a parameter exposes its default as a display string", () => {
  const withDefault = parameter().default("eu");
  assertEquals(withDefault.default_, "eu");
  const bool = parameter().boolean();
  assertEquals(bool.default_, "false");
  const num = parameter().number().default(4);
  assertEquals(num.default_, "4");
  // An empty-list array default and an undefined optional carry no default.
  assertEquals(parameter().array().default_, undefined);
  assertEquals(parameter().default_, undefined);
});
