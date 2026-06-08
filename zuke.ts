/**
 * Zuke's own build, authored with Zuke — the project builds itself.
 *
 * Every CI and release step is a target here, so the GitHub workflows collapse
 * to a single `deno task zuke <target>` invocation (equivalently
 * `deno run -A zuke.ts <target>`):
 *
 *   deno task zuke ci        # fmt → lint → spell → check → test → coverage gate
 *   deno task zuke test      # type-check, then run the suite with coverage
 *   deno task zuke publish   # publish released packages to JSR, core first
 *   deno task zuke --list    # show every target
 */

import { Build, run, target } from "@zuke/core";
import { CmdTasks } from "@zuke/cmd";
import { DenoTasks } from "@zuke/deno";

/** Workspace packages, in dependency order: core must publish before the rest. */
const PACKAGES = ["core", "deno", "npm", "cmd"];

/** Per-package publish flag set by the release workflow (`true` to publish). */
function publishFlag(pkg: string): string | undefined {
  return Deno.env.get(`ZUKE_PUBLISH_${pkg.toUpperCase()}`);
}

class ZukeBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await CmdTasks.exec("rm", (s) => s.args("-rf", "dist"));
    });

  restore = target()
    .description("Warm the module cache")
    .executes(async () => {
      const mods = PACKAGES.map((p) => `packages/${p}/mod.ts`);
      await DenoTasks.cache((s) => s.paths(...mods));
    });

  format = target()
    .description("Check formatting (deno fmt --check)")
    .executes(async () => {
      await DenoTasks.fmt((s) => s.check());
    });

  lint = target()
    .description("Lint the workspace (deno lint)")
    .executes(async () => {
      await DenoTasks.lint();
    });

  spell = target()
    .description("Spell-check the repository (cspell)")
    .executes(async () => {
      const argv = ["run", "--allow-read", "--allow-env", "--allow-sys"];
      argv.push("npm:cspell@9", "lint", "--no-progress", "**");
      await CmdTasks.exec(Deno.execPath(), (s) => s.args(...argv));
    });

  check = target()
    .description("Type-check the whole workspace")
    .dependsOn(this.restore)
    .executes(async () => {
      await DenoTasks.task((s) => s.name("check"));
    });

  test = target()
    .description("Run the test suite with coverage")
    .dependsOn(this.check)
    .executes(async () => {
      await DenoTasks.test((s) => s.allowAll().coverage("cov_profile"));
    });

  coverage = target()
    .description("Enforce the 95% coverage gate")
    .dependsOn(this.test)
    .executes(async () => {
      const cov = ["coverage", "cov_profile", "--lcov"];
      cov.push("--exclude=(tests|scripts)/", "--output=cov.lcov");
      await CmdTasks.exec(Deno.execPath(), (s) => s.args(...cov));
      const gate = ["run", "--allow-read", "scripts/check-coverage.ts"];
      gate.push("cov.lcov", "95");
      await CmdTasks.exec(Deno.execPath(), (s) => s.args(...gate));
    });

  ci = target()
    .description("Full pre-commit / CI gate")
    .dependsOn(this.format, this.lint, this.spell, this.coverage)
    .executes(() => {});

  publish = target()
    .description("Publish released packages to JSR, in dependency order")
    .executes(async () => {
      const gated = PACKAGES.some((p) => publishFlag(p) !== undefined);
      const selected = gated
        ? PACKAGES.filter((p) => publishFlag(p) === "true")
        : [...PACKAGES];
      if (selected.length === 0) {
        console.log("Nothing to publish: no released packages selected.");
        return;
      }
      for (const pkg of selected) {
        console.log(`Publishing @zuke/${pkg} to JSR...`);
        await CmdTasks.exec(Deno.execPath(), (s) => {
          return s.cwd(`packages/${pkg}`).args("publish", "--allow-dirty");
        });
      }
    });

  // Convention: the `default` target runs when none is named.
  default = target()
    .description("Default: run the full CI gate")
    .dependsOn(this.ci)
    .executes(() => {});
}

if (import.meta.main) {
  await run(ZukeBuild);
}
