/**
 * Provision an npm-registry package as a runnable, version-pinned tool — the
 * npm-ecosystem counterpart to {@link "./install.ts".installRelease}.
 *
 * `installNpmTool({ name: "vitest", version: "4.1.9" })` runs
 * `npm install --prefix <dir> --no-save vitest@4.1.9` into a Zuke-managed,
 * per-version directory and returns the installed bin's {@link AbsolutePath},
 * ready for a wrapper's `.toolPath(...)` — no ambient `npm ci`, and no
 * assumption that the tool is already on `PATH`. A marker file records the
 * pinned `{ name, version }`, so a matching prior install is reused without
 * re-running npm.
 *
 * npm itself is the one ambient requirement — it resolves and downloads the
 * package; everything else is Zuke's. Group several with
 * {@link "./tool.ts".Toolchain.npm}, or install one directly through
 * {@link "./tool.ts".ToolTasks.npm}.
 *
 * ```ts
 * import { installNpmTool } from "jsr:@zuke/core";
 * import { CmdTasks } from "jsr:@zuke/cmd";
 *
 * const vitest = await installNpmTool({ name: "vitest", version: "4.1.9" });
 * await CmdTasks.exec(String(vitest), (s) => s.args("run"));
 * ```
 *
 * @module
 */

import { Command } from "./shell.ts";
import { type AbsolutePath, absolutePath, type PathLike } from "./path.ts";
import { type OperatingSystem, operatingSystem } from "./host.ts";
import { DEFAULT_TOOLS_DIR } from "./tool.ts";

/** A specification of an npm-registry package to provision as a tool. */
export interface NpmToolSpec {
  /** The npm package to install, e.g. `"vitest"` or `"@nestjs/cli"`. */
  name: string;
  /** The exact version to pin, e.g. `"4.1.9"` — installed as `name@version`. */
  version: string;
  /**
   * The bin to resolve, when it differs from the package name — `@nestjs/cli`
   * publishes the `nest` bin, so `{ name: "@nestjs/cli", bin: "nest" }`.
   * Defaults to {@link name}.
   */
  bin?: string;
}

/**
 * Runs `npm install <args>` — the injectable subprocess seam. Defaults to
 * spawning the ambient `npm`; a test injects a fake that records the argv and
 * plants the expected bin, so provisioning stays hermetic and network-free.
 */
export type NpmRunner = (args: string[]) => Promise<void>;

/** Options for {@link installNpmTool}. */
export interface InstallNpmToolOptions {
  /**
   * The root tools directory; the package installs under
   * `<destDir>/npm/<name>@<version>`. Defaults to
   * {@link "./tool.ts".DEFAULT_TOOLS_DIR} (`.zuke/tools`).
   */
  destDir?: PathLike;
  /** The npm-install runner. Defaults to the ambient `npm`; a test seam. */
  run?: NpmRunner;
  /**
   * The OS whose bin-shim filename to return (`.cmd` on Windows). Defaults to
   * the host; a test seam for the Windows shim path.
   */
  os?: OperatingSystem;
}

/** The default {@link NpmRunner}: spawn the ambient `npm`, throwing on failure. */
const defaultNpmRun: NpmRunner = async (args) => {
  await new Command(["npm", ...args]);
};

/** Resolve a possibly-relative directory to an absolute path (against `cwd`). */
function resolveDir(dir: string): AbsolutePath {
  const slashed = dir.replace(/\\/g, "/");
  const isAbsolute = slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed);
  return absolutePath(isAbsolute ? slashed : `${Deno.cwd()}/${slashed}`);
}

/** The pinned package recorded beside an npm-provisioned tool. */
interface NpmToolMarker {
  /** The npm package name this install satisfied. */
  name: string;
  /** The pinned version this install satisfied. */
  version: string;
}

/** The marker file recording the pinned package an install satisfied. */
function markerPath(prefix: AbsolutePath): string {
  return String(prefix(".zuke-npm-tool.json"));
}

/** Parse a marker file's JSON, or `null` if it is absent or malformed. */
function parseMarker(text: string | null): NpmToolMarker | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" && parsed !== null &&
      "name" in parsed && typeof parsed.name === "string" &&
      "version" in parsed && typeof parsed.version === "string"
    ) {
      return { name: parsed.name, version: parsed.version };
    }
  } catch {
    // A corrupt marker is treated as absent — the tool just re-installs.
  }
  return null;
}

/** Read a file's text, or `null` when it does not exist. */
async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Whether a filesystem path resolves to an existing file (follows symlinks). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** The installed bin path npm plants for `spec`, `.cmd`-shimmed on Windows. */
function binPathOf(
  prefix: AbsolutePath,
  spec: NpmToolSpec,
  os: OperatingSystem,
): AbsolutePath {
  const bin = spec.bin ?? spec.name;
  return prefix("node_modules", ".bin", os === "windows" ? `${bin}.cmd` : bin);
}

/** npm package-name grammar: optionally scoped, no path separators or leading dash. */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
/** A bin name: a single path segment — no separators, no leading dash. */
const BIN_NAME = /^[a-z0-9][a-z0-9._~-]*$/i;

/**
 * Reject a spec whose `name`, `version`, or `bin` would build an unsafe install
 * path (a `..` escaping `<destDir>`) or splice an npm flag (a leading-dash name
 * npm reads as an option) — before npm ever runs. These come from the build
 * script, so this is a friendly guard-rail that names the offender, not a
 * trust-boundary defence; a valid scoped name like `@nestjs/cli` passes.
 */
function validateNpmSpec(spec: NpmToolSpec): void {
  if (!NPM_NAME.test(spec.name)) {
    throw new Error(
      `invalid npm tool name ${
        JSON.stringify(spec.name)
      }: expected a package ` +
        `name like "vitest" or "@nestjs/cli" — no path separators, spaces, or ` +
        `leading dash.`,
    );
  }
  if (
    spec.version === "" || /[\s/\\]/.test(spec.version) ||
    spec.version.startsWith("-") || spec.version.includes("..")
  ) {
    throw new Error(
      `invalid version ${JSON.stringify(spec.version)} for npm tool ` +
        `"${spec.name}": expected an exact version like "4.1.9" — no spaces, ` +
        `slashes, "..", or leading dash.`,
    );
  }
  if (spec.bin !== undefined && !BIN_NAME.test(spec.bin)) {
    throw new Error(
      `invalid bin ${JSON.stringify(spec.bin)} for npm tool "${spec.name}": ` +
        `expected a single bin name like "nest" — no path separators or ` +
        `leading dash.`,
    );
  }
}

/**
 * Provision an npm-registry package as a version-pinned, cached tool and return
 * the installed bin's {@link AbsolutePath} — hand it straight to a wrapper's
 * `.toolPath(...)`.
 *
 * The package installs under `<destDir>/npm/<name>@<version>` via
 * `npm install --prefix <dir> --no-save <name>@<version>`; a marker file records
 * the pinned `{ name, version }`, so a later run whose marker matches and whose
 * bin is still present is reused without invoking npm again. `npm` must be on
 * `PATH` (it resolves and downloads the package).
 *
 * Throws — without recording a marker — if `spec` is malformed (an unsafe name,
 * version, or bin), if npm fails, or if npm succeeds but the expected bin is
 * absent (a typo'd `bin`, or a package that ships no executable), so a bad
 * install fails loudly here instead of at a later `.toolPath(...)`.
 *
 * The marker is written only after the bin is verified present, so a matching
 * marker always has its bin — a reader never sees a half-written install.
 * Concurrent installs of the same pin into the same directory are not isolated;
 * they just do redundant work (the documented ceiling — a build resolves its
 * toolchain once, and distinct pins use distinct directories).
 */
export async function installNpmTool(
  spec: NpmToolSpec,
  options: InstallNpmToolOptions = {},
): Promise<AbsolutePath> {
  validateNpmSpec(spec);
  const os = options.os ?? operatingSystem();
  const root = resolveDir(String(options.destDir ?? DEFAULT_TOOLS_DIR));
  const prefix = root("npm", `${spec.name}@${spec.version}`);
  const bin = binPathOf(prefix, spec, os);

  // Cache hit: a prior install of the same name@version whose bin is still on
  // disk is reused without invoking npm again.
  const marker = parseMarker(await readTextOrNull(markerPath(prefix)));
  if (
    marker !== null && marker.name === spec.name &&
    marker.version === spec.version && await pathExists(String(bin))
  ) {
    return bin;
  }

  await Deno.mkdir(String(prefix), { recursive: true });
  await (options.run ?? defaultNpmRun)([
    "install",
    "--prefix",
    String(prefix),
    "--no-save",
    `${spec.name}@${spec.version}`,
  ]);
  // Confirm npm actually produced the bin before recording the install — a
  // typo'd `bin` or a package that ships no executable exits 0 without planting
  // it. Fail loudly here (like installRelease) rather than returning a path to a
  // nonexistent file that only breaks later at `.toolPath(...)`, and never write
  // a marker for an install that did not land.
  if (!await pathExists(String(bin))) {
    throw new Error(
      `npm installed ${spec.name}@${spec.version}, but its bin was not found ` +
        `at ${
          String(bin)
        }. If the package's bin name differs from the package ` +
        `name, pass { bin } (e.g. "@nestjs/cli" ships the "nest" bin).`,
    );
  }
  await Deno.writeTextFile(
    markerPath(prefix),
    `${JSON.stringify({ name: spec.name, version: spec.version })}\n`,
  );
  return bin;
}
