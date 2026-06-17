/**
 * Zuke's own build, authored with Zuke — the project builds itself.
 *
 * Every CI and release step is a target here, so the GitHub workflows collapse
 * to `deno task zuke <target>` invocations (equivalently
 * `deno run -A zuke.ts <target>`):
 *
 *   deno task zuke ci        # fmt → lint → spell → check → test → coverage gate
 *   deno task zuke test      # type-check, then run the suite with coverage
 *   deno task zuke release   # release-please: maintain release PRs & releases
 *   deno task zuke publish   # publish new package versions to JSR, core first
 *   deno task zuke --list    # show every target
 */

import { Build, run, target } from "@zuke/core";
import { CmdTasks } from "@zuke/cmd";
import { DenoTasks } from "@zuke/deno";
import { SecurityTasks } from "@zuke/security";

/** Workspace packages, in dependency order: core must publish before the rest. */
const PACKAGES = [
  "core",
  "deno",
  "npm",
  "bun",
  "pnpm",
  "yarn",
  "cmd",
  "cli",
  "docker",
  "docker-compose",
  "kubectl",
  "oxlint",
  "eslint",
  "cspell",
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "biome",
  "knip",
  "vite",
  "tsup",
  "turbo",
  "nx",
  "tsx",
  "tsgo",
  "dprint",
  "gcloud",
  "git",
  "gh",
  "terraform",
  "tofu",
  "security",
];

/** The `version` field of a package's `deno.json`, validated as a string. */
function readVersion(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("deno.json must be a JSON object.");
  }
  if (!("version" in value)) {
    throw new Error('deno.json is missing a "version" field.');
  }
  if (typeof value.version !== "string") {
    throw new Error('deno.json "version" must be a string.');
  }
  return value.version;
}

/** The current version declared in `packages/<pkg>/deno.json`. */
async function localVersion(pkg: string): Promise<string> {
  const text = await Deno.readTextFile(`packages/${pkg}/deno.json`);
  return readVersion(JSON.parse(text));
}

/** The set of version strings present in a JSR `meta.json` payload. */
function publishedVersions(meta: unknown): Set<string> {
  if (typeof meta !== "object" || meta === null) return new Set<string>();
  if (!("versions" in meta)) return new Set<string>();
  const versions = meta.versions;
  if (typeof versions !== "object" || versions === null) {
    return new Set<string>();
  }
  return new Set(Object.keys(versions));
}

/** Whether `@zuke/<pkg>@<version>` is already published on JSR. */
async function isOnJsr(pkg: string, version: string): Promise<boolean> {
  const res = await fetch(`https://jsr.io/@zuke/${pkg}/meta.json`);
  if (!res.ok) {
    await res.body?.cancel();
    return false;
  }
  return publishedVersions(await res.json()).has(version);
}

/** How long to wait for one `deno publish` before treating it as stalled. */
const PUBLISH_TIMEOUT_MS = 180_000;

/**
 * Publish one package with a timeout. Returns `true` on success, or `false` if
 * `deno publish` stalled past the timeout and was killed. JSR's post-upload
 * finalization (provenance) occasionally hangs *after* the upload completes, so
 * the caller re-checks JSR before deciding whether a `false` is fatal.
 */
async function publishWithTimeout(pkg: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
  const command = new Deno.Command(Deno.execPath(), {
    // `--allow-dirty`: release-please bumps `deno.json` versions on the release
    // PR branch, so the merged tree should already be clean here. It is kept as
    // a backstop; for the strongest "published == committed source" guarantee
    // (which provenance otherwise gives) drop it once a real release confirms
    // the publish tree is clean. See SECURITY.md.
    args: ["publish", "--allow-dirty"],
    cwd: `packages/${pkg}`,
    stdout: "inherit",
    stderr: "inherit",
    signal: controller.signal,
  });
  try {
    const status = await command.spawn().status;
    if (status.success) return true;
    if (controller.signal.aborted) return false;
    throw new Error(
      `deno publish for @zuke/${pkg} exited with code ${status.code}.`,
    );
  } finally {
    clearTimeout(timer);
  }
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
      await DenoTasks.test((s) =>
        s.allowAll().coverage("cov_profile").args("--frozen")
      );
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

  // Supply-chain scanning, dogfooding @zuke/security. Kept out of `ci` so the
  // core gate stays runnable without the scanner binaries installed; the
  // dedicated security workflow installs them and runs this target. Every
  // scanner runs (noThrow) so one finding doesn't mask the rest, then the
  // target fails if any reported issues.
  security = target()
    .description("Run supply-chain security scanners (zuke/security)")
    .executes(async () => {
      const failures: string[] = [];
      const gate = async (name: string, output: Promise<{ code: number }>) => {
        const { code } = await output;
        if (code !== 0) failures.push(`${name} (exit ${code})`);
      };
      await gate(
        "zizmor",
        SecurityTasks.zizmor((s) => s.paths(".github/workflows").noThrow()),
      );
      await gate("actionlint", SecurityTasks.actionlint((s) => s.noThrow()));
      await gate(
        "gitleaks",
        SecurityTasks.gitleaks((s) => s.source(".").redact().noThrow()),
      );
      // osv-scanner is omitted here: it has no extractor for Deno's lockfile.
      // The @zuke/security wrapper still ships it for projects with npm/cargo/
      // go/etc. lockfiles it does understand.
      if (failures.length > 0) {
        throw new Error(
          `Security scan reported issues: ${failures.join("; ")}`,
        );
      }
    });

  release = target()
    .description("Maintain release PRs and GitHub releases (release-please)")
    .executes(async () => {
      const token = Deno.env.get("GITHUB_TOKEN");
      const repo = Deno.env.get("GITHUB_REPOSITORY");
      if (token === undefined || repo === undefined) {
        throw new Error(
          "release requires GITHUB_TOKEN and GITHUB_REPOSITORY in the env.",
        );
      }
      const common = [
        "--token",
        token,
        "--repo-url",
        repo,
        "--target-branch",
        "master",
        "--config-file",
        ".release-please-config.json",
        "--manifest-file",
        ".release-please-manifest.json",
      ];
      const cli = ["run", "-A", "npm:release-please@16.18.0"];
      for (const cmd of ["release-pr", "github-release"]) {
        const argv = [...cli, cmd, ...common];
        await CmdTasks.exec(Deno.execPath(), (s) => s.args(...argv));
      }
    });

  publishJsr = target()
    .description("Publish new package versions to JSR, core first")
    .executes(async () => {
      for (const pkg of PACKAGES) {
        const version = await localVersion(pkg);
        if (version === "0.0.0") {
          console.log(`@zuke/${pkg} has no released version yet.`);
          continue;
        }
        if (await isOnJsr(pkg, version)) {
          console.log(`@zuke/${pkg}@${version} is already on JSR.`);
          continue;
        }
        console.log(`Publishing @zuke/${pkg}@${version} to JSR...`);
        if (await publishWithTimeout(pkg)) continue;
        // Timed out: the upload usually lands before JSR's finalization hangs,
        // so a re-check tells us whether it actually published.
        if (await isOnJsr(pkg, version)) {
          console.log(`@zuke/${pkg}@${version} uploaded (provenance stalled).`);
          continue;
        }
        throw new Error(
          `Publishing @zuke/${pkg}@${version} timed out before reaching JSR.`,
        );
      }
    });

  // `release` (release-please) needs a GITHUB_TOKEN; `publishJsr` needs JSR
  // OIDC. The release workflow runs them as two least-privilege jobs. This
  // aggregate keeps the single-command `./zuke publish` working locally and
  // runs release first (declared earlier) so versions are current before JSR.
  publish = target()
    .description("Release then publish new versions to JSR")
    .dependsOn(this.release, this.publishJsr)
    .executes(() => {});

  // Convention: the `default` target runs when none is named.
  default = target()
    .description("Default: run the full CI gate")
    .dependsOn(this.ci)
    .executes(() => {});
}

if (import.meta.main) {
  await run(ZukeBuild);
}
