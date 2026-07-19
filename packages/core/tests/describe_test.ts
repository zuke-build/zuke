import { assertEquals } from "./_assert.ts";
import { Build, describeCli, parameter, target } from "../mod.ts";
import { BUILTIN_FLAGS, RESERVED_COMMANDS } from "../src/cli_spec.ts";

class Sample extends Build {
  clean = target().description("Clean").executes(() => {});
  build = target().description("Build it").dependsOn(this.clean).executes(
    () => {},
  );
  hidden = target().unlisted().executes(() => {});
  default = target().dependsOn(this.build).executes(() => {});
  environment = parameter("Target environment").options("dev", "prod")
    .required();
  tags = parameter("Tags").array();
  verbose = parameter("Verbose").boolean();
}

Deno.test("describeCli mirrors the shared command and flag registry", () => {
  const d = describeCli(new Sample());
  assertEquals(
    d.commands.map((c) => c.name),
    RESERVED_COMMANDS.map((c) => c.name),
  );
  assertEquals(d.flags.map((f) => f.name), BUILTIN_FLAGS.map((f) => f.name));
});

Deno.test("describeCli reports targets with deps, default, and unlisted", () => {
  const targets = describeCli(new Sample()).targets;

  const build = targets.find((t) => t.name === "build");
  assertEquals(build?.description, "Build it");
  assertEquals(build?.dependsOn, ["clean"]);
  assertEquals(build?.default, false);
  assertEquals(build?.unlisted, false);

  const def = targets.find((t) => t.name === "default");
  assertEquals(def?.default, true);
  assertEquals(def?.dependsOn, ["build"]);

  // Unlisted targets are still reported (with the flag set), unlike `--list`.
  const hidden = targets.find((t) => t.name === "hidden");
  assertEquals(hidden?.unlisted, true);
  assertEquals(hidden?.description, "");
});

Deno.test("describeCli reports parameter flags, kinds, and options", () => {
  const params = describeCli(new Sample()).parameters;

  const env = params.find((p) => p.flag === "environment");
  assertEquals(env?.required, true);
  assertEquals(env?.options, ["dev", "prod"]);
  assertEquals(env?.boolean, false);

  assertEquals(params.find((p) => p.flag === "tags")?.array, true);
  assertEquals(params.find((p) => p.flag === "verbose")?.boolean, true);
});

Deno.test("describeCli hides a secret parameter's option values", () => {
  class WithSecret extends Build {
    // A secret whose declared options are real credentials must not surface.
    apiKey = parameter("API key").secret().options("sk-live-a", "sk-live-b");
  }
  const key = describeCli(new WithSecret()).parameters.find((p) =>
    p.flag === "api-key"
  );
  assertEquals(key?.options, []);
});

Deno.test("describeCli reports the property name, kind, and default", () => {
  class Params extends Build {
    skipE2e = parameter("Skip e2e").boolean();
    workers = parameter("Workers").number().default(4);
    region = parameter("Region").default("eu");
  }
  const params = describeCli(new Params()).parameters;

  const skip = params.find((p) => p.name === "skipE2e");
  // The property name is distinct from the kebab flag.
  assertEquals(skip?.flag, "skip-e2e");
  assertEquals(skip?.kind, "boolean");
  assertEquals(skip?.default, "false");

  const workers = params.find((p) => p.name === "workers");
  assertEquals(workers?.kind, "number");
  assertEquals(workers?.default, "4");

  // A parameter with no default carries none.
  assertEquals(params.find((p) => p.name === "region")?.default, "eu");
});

Deno.test("describeCli omitSecrets drops secret parameters entirely", () => {
  class WithSecret extends Build {
    apiKey = parameter("API key").secret();
    region = parameter("Region");
  }
  // By default the secret is present (with masked options).
  const all = describeCli(new WithSecret()).parameters.map((p) => p.name);
  assertEquals(all, ["apiKey", "region"]);
  // With omitSecrets it is gone, so it can never become a spawnable input.
  const visible = describeCli(new WithSecret(), { omitSecrets: true })
    .parameters.map((p) => p.name);
  assertEquals(visible, ["region"]);
});
