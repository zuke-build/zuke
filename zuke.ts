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

import { Build, FileTasks, run, target } from "@zuke/core";
import { CommandTimeoutError } from "@zuke/core/shell";
import { type DenoInstallSettings, DenoTasks } from "@zuke/deno";
import { CspellTasks } from "@zuke/cspell";
import { isPublished } from "@zuke/jsr";
import {
  type ReleasePleaseGithubReleaseSettings,
  type ReleasePleaseReleasePrSettings,
  ReleasePleaseTasks,
} from "@zuke/release-please";
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
  "helm",
  "kustomize",
  "oxlint",
  "eslint",
  "cspell",
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "biome",
  "knip",
  "dpdm",
  "jsr",
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
  "release-please",
  "security",
];

/**
 * Where build-time CLIs are installed on demand. Gitignored (`/.zuke/`), so the
 * install is a transient, per-run artifact.
 */
const TOOLS_ROOT = ".zuke/tools";

/**
 * Install an npm-distributed CLI as a local executable under {@link TOOLS_ROOT}
 * and return the path to its launcher. cspell and release-please ship only on
 * npm, so the build provisions them with `deno install` rather than assuming a
 * global binary — keeping the gate runnable without a separate setup step. The
 * caller's `permit` lambda grants the launcher its permissions.
 */
async function installCli(
  module: string,
  name: string,
  permit: (s: DenoInstallSettings) => DenoInstallSettings,
): Promise<string> {
  await DenoTasks.install((s) =>
    permit(s.global().force().root(TOOLS_ROOT).name(name)).module(module)
  );
  return `${TOOLS_ROOT}/bin/${name}`;
}

/**
 * `PATH` with the running Deno's directory prepended. The launcher that
 * `deno install` writes for an npm package runs `exec deno …` by name, so an
 * installed CLI only works when `deno` is resolvable on `PATH`. The ./zuke
 * bootstrap may invoke Deno by absolute path without exporting it, so make it
 * discoverable for the installed shims here.
 */
function pathWithDeno(): string {
  const exe = Deno.execPath();
  const sep = Deno.build.os === "windows" ? ";" : ":";
  const cut = Math.max(exe.lastIndexOf("/"), exe.lastIndexOf("\\"));
  const denoDir = cut >= 0 ? exe.slice(0, cut) : exe;
  const current = Deno.env.get("PATH") ?? "";
  return current.length > 0 ? `${denoDir}${sep}${current}` : denoDir;
}

/** Validate and return the `version` field of a parsed `deno.json`. */
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
  return readVersion(await FileTasks.readJson(`packages/${pkg}/deno.json`));
}

/** How long to wait for one `deno publish` before treating it as stalled. */
const PUBLISH_TIMEOUT_MS = 180_000;

/**
 * Publish one package with a timeout. Returns `true` on success, or `false` if
 * `deno publish` stalled past the timeout and was killed. JSR's post-upload
 * finalization (provenance) occasionally hangs *after* the upload completes, so
 * the caller re-checks JSR before deciding whether a `false` is fatal.
 *
 * `--allow-dirty`: release-please bumps `deno.json` versions on the release PR
 * branch, so the merged tree should already be clean here. It is kept as a
 * backstop; for the strongest "published == committed source" guarantee (which
 * provenance otherwise gives) drop it once a real release confirms the publish
 * tree is clean. See SECURITY.md.
 */
async function publishPackage(pkg: string): Promise<boolean> {
  try {
    await DenoTasks.publish((s) =>
      s.allowDirty().cwd(`packages/${pkg}`).killAfter(PUBLISH_TIMEOUT_MS)
    );
    return true;
  } catch (error) {
    if (error instanceof CommandTimeoutError) return false;
    throw error;
  }
}

class ZukeBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await FileTasks.remove("dist", { recursive: true });
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
      const cspell = await installCli(
        "npm:cspell@9",
        "cspell",
        (s) => s.allow("read").allow("env").allow("sys"),
      );
      await CspellTasks.lint((s) =>
        s.toolPath(cspell).env({ PATH: pathWithDeno() }).files("**")
          .noProgress()
      );
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
      await DenoTasks.coverage((s) =>
        s.dir("cov_profile").lcov().exclude("(tests|scripts)/").output(
          "cov.lcov",
        )
      );
      await DenoTasks.run((s) =>
        s.allow("read").script("scripts/check-coverage.ts").scriptArgs(
          "cov.lcov",
          "95",
        )
      );
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
      const bin = await installCli(
        "npm:release-please@16.18.0",
        "release-please",
        (s) => s.allowAll(),
      );
      // Both subcommands take the same connection/config flags. Apply them with
      // a settings object already narrowed to its concrete type at each call.
      const apply = (
        s: ReleasePleaseReleasePrSettings | ReleasePleaseGithubReleaseSettings,
      ) =>
        s
          .toolPath(bin)
          .env({ PATH: pathWithDeno() })
          .token(token)
          .repoUrl(repo)
          .targetBranch("master")
          .configFile(".release-please-config.json")
          .manifestFile(".release-please-manifest.json");
      await ReleasePleaseTasks.releasePr((s) => {
        apply(s);
        return s;
      });
      await ReleasePleaseTasks.githubRelease((s) => {
        apply(s);
        return s;
      });
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
        if (await isPublished(`@zuke/${pkg}`, version)) {
          console.log(`@zuke/${pkg}@${version} is already on JSR.`);
          continue;
        }
        console.log(`Publishing @zuke/${pkg}@${version} to JSR...`);
        if (await publishPackage(pkg)) continue;
        // Timed out: the upload usually lands before JSR's finalization hangs,
        // so a re-check tells us whether it actually published.
        if (await isPublished(`@zuke/${pkg}`, version)) {
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
