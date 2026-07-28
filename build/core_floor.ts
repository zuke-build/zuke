/**
 * The `@zuke/core` version-floor check.
 *
 * Every package declares the oldest core it supports, as a caret range in its
 * own `deno.json` imports. Nothing verifies that claim. Because the root
 * `deno.json` declares a workspace, `deno check` resolves `@zuke/core` to the
 * local `packages/core` source no matter what a package's range says — so a
 * package can use a core symbol that only exists in a newer core than it
 * declares, and every local gate stays green while a consumer installing from
 * JSR gets a type error or a missing export. That has already happened here
 * once; see docs/versioning.md.
 *
 * The check type-checks each package against the core it actually declares. It
 * writes a throwaway config carrying the package's own imports and, crucially,
 * no `workspace` field, then points `deno check --config` at it: with no
 * workspace to resolve against, `@zuke/core` resolves from JSR. `--no-lock`
 * keeps the committed lock out of it — these resolutions are deliberately not
 * the project's.
 *
 * The core specifier is pinned to the range's exact minimum, which is the part
 * that makes this a real check rather than a decorative one. A caret range
 * resolves to the newest matching version, so checking the range as written
 * would exercise the current core and pass regardless of the declared floor.
 * See {@link exactFloorSpecifier}.
 *
 * It therefore needs the network, which is why it is its own target and its own
 * CI job rather than part of the offline `./zuke ci` gate.
 *
 * @module
 */

import { DenoTasks } from "@zuke/deno";
import { FileTasks } from "@zuke/core";

/** The dependency whose declared floor is verified. */
export const CORE_PACKAGE = "@zuke/core";

/** A package's declared core floor, and the entrypoint to check against it. */
export interface CoreFloor {
  /** The workspace-relative package directory name, e.g. `gh`. */
  package: string;
  /** The specifier the package declares, e.g. `jsr:@zuke/core@^1.31.0`. */
  specifier: string;
  /** The package's full import map, copied into the throwaway config. */
  imports: Record<string, string>;
}

/** One package's verdict from {@link checkCoreFloors}. */
export interface FloorResult {
  /** The package that was checked. */
  package: string;
  /** The core specifier it was checked against. */
  specifier: string;
  /** Whether it type-checks against that published core. */
  ok: boolean;
  /** The type-checker's output when it does not. */
  detail?: string;
}

/**
 * Read a package's `deno.json` and extract its declared core floor, or
 * `undefined` when it declares none — which is correct for core itself.
 *
 * Pure apart from the read, and tolerant of a malformed file: a package whose
 * config cannot be parsed has no verifiable claim to make, so it is skipped
 * rather than failing the run.
 */
export function readCoreFloor(
  pkg: string,
  readText: (path: string) => string,
): CoreFloor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(`packages/${pkg}/deno.json`));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const raw = "imports" in parsed ? parsed.imports : undefined;
  if (typeof raw !== "object" || raw === null) return undefined;
  const imports: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") imports[name] = value;
  }
  const specifier = imports[CORE_PACKAGE];
  if (specifier === undefined) return undefined;
  return { package: pkg, specifier, imports };
}

/**
 * Rewrite a range specifier to pin its minimum version exactly, or `undefined`
 * when the minimum cannot be determined.
 *
 * This is the difference between a check that works and one that only looks like
 * it does. A caret range resolves to the *newest* matching version, so checking
 * `^1.25.0` against JSR pulls the current 1.x and passes no matter how new a
 * symbol the package uses — the floor is never exercised. Pinning the range's
 * minimum is what actually tests the claim "this package works with core this
 * old".
 */
export function exactFloorSpecifier(specifier: string): string | undefined {
  const at = specifier.lastIndexOf("@");
  if (at <= 0) return undefined;
  const name = specifier.slice(0, at);
  const range = specifier.slice(at + 1).trim();
  const version = range.replace(/^(\^|~|>=|>|=)\s*/, "");
  // Only a plain `major.minor.patch` (optionally with a prerelease or build
  // suffix) has an unambiguous minimum. Anything else — a wildcard, a compound
  // range — is reported rather than guessed at.
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return undefined;
  return `${name}@${version}`;
}

/** The only specifier prefix the generated config is allowed to carry. */
export const ALLOWED_PREFIX = "jsr:@zuke/";

/**
 * Whether a specifier may be carried into the generated config.
 *
 * The config is built from a package's own `deno.json`, which on a pull request
 * is attacker-controlled, and the check resolves it with `--no-lock` — so
 * without a restriction a PR could point an import at any URL and have CI fetch
 * it, unpinned by the committed lock. Every package in this workspace depends
 * only on `jsr:@zuke/*` (the library is dependency-free), so allowing just that
 * costs nothing. Type-checking never executes the fetched code, but making the
 * runner fetch attacker-chosen URLs is a capability worth not granting.
 *
 * This is necessary and **not sufficient**: it governs the import map only. A
 * source file can import an absolute URL directly, which `deno check` follows
 * whatever the map says. The blocked egress allowlist on the `core-floors` job
 * in `ci.yml` is what covers that case; the two are layers of one control, so
 * neither should be removed on the assumption the other suffices.
 */
export function isAllowedSpecifier(specifier: string): boolean {
  return specifier.startsWith(ALLOWED_PREFIX);
}

/**
 * Render the throwaway config for one package: its allowed imports with the core
 * specifier pinned to its exact floor, and no `workspace` field.
 *
 * The absence of `workspace` is the whole mechanism — with it, Deno would
 * substitute the local `packages/core` member and the check would prove
 * nothing.
 *
 * `minimumDependencyAge` is zeroed because Deno otherwise refuses a version
 * published in the last day as a supply-chain precaution. That default is right
 * when installing dependencies to run, and wrong here: this check installs
 * nothing, and the case it most needs to verify is a floor naming the core that
 * was *just* released alongside it. Left at the default, every package
 * declaring a fresh core would fail spuriously for a day after each release.
 */
export function floorConfig(floor: CoreFloor, pinned: string): string {
  const imports: Record<string, string> = {};
  for (const [name, specifier] of Object.entries(floor.imports)) {
    if (isAllowedSpecifier(specifier)) imports[name] = specifier;
  }
  imports[CORE_PACKAGE] = pinned;
  const config = { imports, minimumDependencyAge: 0 };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Summarise results as the lines a failing target prints, most useful first.
 * Pure, so the message is testable without running a type-check.
 */
export function formatFloorFailures(results: readonly FloorResult[]): string[] {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return [];
  const lines = [
    `${failed.length} package(s) do not type-check against the ${CORE_PACKAGE} ` +
    `version they declare:`,
  ];
  for (const result of failed) {
    lines.push(`  packages/${result.package} declares ${result.specifier}`);
    for (const line of (result.detail ?? "").split("\n")) {
      if (line.trim() !== "") lines.push(`    ${line}`);
    }
  }
  lines.push(
    `Raise the floor in the package's deno.json to a core version that has ` +
      `the symbols it uses, or stop using them. A local gate cannot catch this: ` +
      `workspace resolution substitutes the local packages/core regardless of ` +
      `the declared range.`,
  );
  return lines;
}

/**
 * Type-check each package against the published core it declares.
 *
 * Packages are checked in the given order; each gets a throwaway config in its
 * own temporary directory, removed afterwards. A package declaring no core
 * floor is skipped and absent from the results.
 */
export async function checkCoreFloors(
  packages: readonly string[],
  readText: (path: string) => string = Deno.readTextFileSync,
): Promise<FloorResult[]> {
  const results: FloorResult[] = [];
  for (const pkg of packages) {
    const floor = readCoreFloor(pkg, readText);
    if (floor === undefined) continue;
    const pinned = exactFloorSpecifier(floor.specifier);
    if (pinned === undefined) {
      results.push({
        package: pkg,
        specifier: floor.specifier,
        ok: false,
        detail: `Cannot determine a minimum version from this range, so the ` +
          `floor cannot be verified. Declare it as a caret range over an ` +
          `exact version, e.g. ${CORE_PACKAGE}@^1.32.0.`,
      });
      continue;
    }
    // The mapping's *target* is as attacker-controlled as the rest of the file
    // on a pull request, so the entry named `@zuke/core` must actually resolve
    // core and not some other package wearing its name.
    if (!pinned.startsWith(`${ALLOWED_PREFIX}core@`)) {
      results.push({
        package: pkg,
        specifier: floor.specifier,
        ok: false,
        detail: `The ${CORE_PACKAGE} entry must resolve ` +
          `${ALLOWED_PREFIX}core, not ${pinned}.`,
      });
      continue;
    }
    const dir = await Deno.makeTempDir({ prefix: `zuke-floor-${pkg}-` });
    try {
      const config = `${dir}/deno.json`;
      await FileTasks.writeText(config, floorConfig(floor, pinned));
      const output = await DenoTasks.check((s) =>
        s.config(config).noLock().paths(`packages/${pkg}/mod.ts`).noThrow()
      );
      results.push({
        package: pkg,
        specifier: floor.specifier,
        ok: output.code === 0,
        detail: output.code === 0
          ? undefined
          : `${output.stderr}\n${output.stdout}`.trim(),
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
  return results;
}
