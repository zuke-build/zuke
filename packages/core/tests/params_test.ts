import { assertEquals, assertThrows } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { execute } from "../src/executor.ts";
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

Deno.test("array parameters resolve through the CLI map (repeated flag joined)", () => {
  class B extends Build {
    tags = parameter("Tags").array();
  }
  const params = discoverParameters(new B());
  // The CLI joins repeated flags with commas before resolution.
  const errors = resolveParameters(params, { tags: "x,y" }, () => undefined);
  assertEquals(errors, []);
  const p = params.get("tags");
  if (p instanceof Parameter) assertEquals(p.value, ["x", "y"]);
});

Deno.test("resolveParameters prompts for a missing required value", () => {
  class B extends Build {
    token = parameter("API token").required();
  }
  const params = discoverParameters(new B());
  const errors = resolveParameters(
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

Deno.test("resolveParameters: CLI beats env beats default", () => {
  const params = discoverParameters(new Demo());
  const env = (name: string) => (name === "WORKERS" ? "8" : undefined);
  const errors = resolveParameters(params, { environment: "prod" }, env);
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

Deno.test("resolveParameters reports missing required and invalid values", () => {
  const params = discoverParameters(new Demo());
  const errors = resolveParameters(
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
