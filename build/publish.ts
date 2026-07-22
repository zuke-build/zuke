/**
 * Release/publish helpers: where build-time CLIs are installed, the on-demand
 * CLI installer, and the timeout-guarded JSR publish for one package.
 */

import { type AbsolutePath, repoRoot } from "@zuke/core";
import { CommandTimeoutError } from "@zuke/core/shell";
import { type DenoInstallSettings, DenoTasks } from "@zuke/deno";

/**
 * Where build-time CLIs are installed on demand. Gitignored (`/.zuke/`), so the
 * install is a transient, per-run artifact.
 */
export const TOOLS_ROOT: AbsolutePath = repoRoot(".zuke", "tools");

/**
 * The pinned Codecov CLI version `coverageUpload` downloads. Pinned (never
 * `latest`) so the build is reproducible and fetches a fixed artifact rather
 * than a moving target; bump it deliberately. Codecov serves versioned binaries
 * at `cli.codecov.io/v<semver>/<platform>/codecov`.
 */
export const CODECOV_CLI_VERSION = "v11.2.8";

/** How long to wait for one `deno publish` before treating it as stalled. */
export const PUBLISH_TIMEOUT_MS = 180_000;

/**
 * Install an npm-distributed CLI as a local executable under {@link TOOLS_ROOT}
 * and return the absolute path to its launcher. cspell and release-please ship
 * only on npm, so the build provisions them with `deno install` rather than
 * assuming a global binary — keeping the gate runnable without a separate setup
 * step. The caller's `permit` lambda grants the launcher its permissions.
 */
export async function installCli(
  module: string,
  name: string,
  permit: (s: DenoInstallSettings) => DenoInstallSettings,
): Promise<AbsolutePath> {
  await DenoTasks.install((s) =>
    permit(s.global().force().root(TOOLS_ROOT).name(name)).module(module)
  );
  return TOOLS_ROOT("bin", name);
}

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
export async function publishPackage(pkg: string): Promise<boolean> {
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
