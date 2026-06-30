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
