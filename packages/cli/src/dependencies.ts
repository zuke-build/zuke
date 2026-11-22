// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `zuke add` and `zuke remove`: change the project's dependencies with
 * `deno add` and `deno remove`, run in the project root.
 *
 * A bare name is a Zuke package, so `zuke add docker gh` adds
 * `jsr:@zuke/docker` and `jsr:@zuke/gh` to the project's `deno.json` imports
 * — the bare-specifier form a build imports them by. A scoped name (`@x/y`)
 * is a JSR package, and a full specifier (`jsr:…`, `npm:…`) passes through.
 *
 * Neither takes `--min-dep-age`: `deno add` rejects Deno's
 * `--minimum-dependency-age` flag. Both honour the project's own
 * `minimumDependencyAge` in `deno.json`, which Deno reads for them.
 *
 * In a project whose build runs on Node they run `npm install` and
 * `npm uninstall` instead, with `--ignore-scripts`, and change `package.json`:
 * a bare name becomes the alias `@zuke/<name>` for `npm:@zuke-build/<name>@^1`,
 * as `zuke setup --runtime node` writes it, and an `npm:` specifier passes
 * through. A JSR package has no npm install, so it is refused there.
 *
 * @module
 */

import type { BuildProbe } from "./dispatch.ts";
import type { CliPaint } from "./paint.ts";
import { type ProjectHost, projectLocation } from "./project.ts";
import { zukeNpmDependency } from "./starter.ts";
import { projectConfigText } from "./version_report.ts";

/** A bare Zuke package name, as `zuke add docker` takes it. */
const BARE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** A scoped package name, `@scope/name`. */
const SCOPED_NAME = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

/** A full specifier with a registry prefix, passed through as written. */
const FULL_SPECIFIER = /^(jsr|npm):\S+$/;

/** What `zuke add` and `zuke remove` do with their packages. */
export type DependencyCommand = "add" | "remove";

/**
 * The `deno add` / `deno remove` operand for `name`: a bare name becomes the
 * Zuke package `jsr:@zuke/<name>`, a scoped name `jsr:@scope/name`, and a
 * full `jsr:` or `npm:` specifier passes through.
 *
 * @throws {Error} naming `command` on anything else — an option Deno would
 * read, or a name no registry accepts — rather than handing it to Deno.
 */
export function dependencySpecifier(
  command: DependencyCommand,
  name: string,
): string {
  if (BARE_NAME.test(name)) return `jsr:@zuke/${name}`;
  if (SCOPED_NAME.test(name)) return `jsr:${name}`;
  if (FULL_SPECIFIER.test(name)) return name;
  throw new Error(
    `zuke ${command}: "${name}" is not a package. Pass a Zuke package name ` +
      "(docker), a scoped JSR name (@scope/name), or a jsr: or npm: " +
      "specifier.",
  );
}

/** The `@zuke/<name>` a Zuke package's specifier names, if it is one. */
const ZUKE_JSR = /^jsr:@zuke\/([a-z0-9][a-z0-9-]*)$/;

/**
 * The `npm install` / `npm uninstall` operand for `specifier`, one
 * {@link dependencySpecifier} returned: a Zuke package becomes its
 * `@zuke/<name>` alias (to add) or that alias (to remove), and an `npm:`
 * specifier is npm's own, without the prefix. A removal names the package
 * alone, as `npm uninstall` takes it.
 *
 * @throws {Error} naming `command` on any other JSR package, which npm
 * cannot install.
 */
export function npmOperand(
  command: DependencyCommand,
  specifier: string,
): string {
  const zuke = ZUKE_JSR.exec(specifier)?.[1];
  if (zuke !== undefined) {
    return command === "add"
      ? `@zuke/${zuke}@${zukeNpmDependency(zuke)}`
      : `@zuke/${zuke}`;
  }
  if (specifier.startsWith("npm:")) {
    const spec = specifier.slice("npm:".length);
    if (command === "add") return spec;
    // `name@range` names `name`; a scoped name's own `@` comes first.
    const at = spec.indexOf("@", 1);
    return at === -1 ? spec : spec.slice(0, at);
  }
  throw new Error(
    `zuke ${command}: ${specifier} is a JSR package, and this project's build ` +
      "runs on Node, which installs from npm. Pass its npm name as " +
      "npm:<name>.",
  );
}

/**
 * Parse `zuke add`'s or `zuke remove`'s arguments: one or more packages, and
 * `--dry-run`.
 *
 * @throws {Error} naming `command` when no package is given, or on anything
 * {@link dependencySpecifier} refuses.
 */
export function parseDependencyArgs(
  command: DependencyCommand,
  args: readonly string[],
): { specifiers: string[]; dryRun: boolean } {
  const dryRun = args.includes("--dry-run");
  const names = args.filter((arg) => arg !== "--dry-run");
  if (names.length === 0) {
    throw new Error(
      `zuke ${command}: name at least one package, as in ` +
        `zuke ${command} docker.`,
    );
  }
  return {
    specifiers: names.map((name) => dependencySpecifier(command, name)),
    dryRun,
  };
}

/**
 * Run `zuke add <args>` or `zuke remove <args>` from `cwd`, reporting
 * through `log`, and return the exit code.
 *
 * @throws {Error} with a message for the user when the request cannot be
 * carried out. `main` prints the message and exits 1.
 */
export async function runDependencies(
  command: DependencyCommand,
  args: string[],
  log: (line: string) => void,
  host: ProjectHost,
  paint: CliPaint,
  cwd: string,
  probe: BuildProbe,
): Promise<number> {
  const { specifiers, dryRun } = parseDependencyArgs(command, args);
  const { root, runtime } = await projectLocation(cwd, probe, command);
  const node = runtime === "node";
  const tool = node ? "npm" : "deno";
  const toolArgs = node
    ? [
      command === "add" ? "install" : "uninstall",
      "--ignore-scripts",
      ...specifiers.map((specifier) => npmOperand(command, specifier)),
    ]
    : [command, ...specifiers];
  if (dryRun) {
    log(`Would run in ${root}: ${tool} ${toolArgs.join(" ")}`);
    return 0;
  }
  const manifest = node ? "package.json" : "deno.json";
  // What the report names: the packages as the manifest spells them.
  const named =
    (node
      ? specifiers.map((specifier) => npmOperand("remove", specifier))
      : specifiers).join(", ");
  const config = node
    ? () => host.readText(`${root}/package.json`).catch(() => undefined)
    : () => projectConfigText((path) => host.readText(path), root);
  const before = await config();
  const code = node
    ? await host.npm(toolArgs, root)
    : await host.deno(toolArgs, root);
  if (code !== 0) {
    log(paint.fail(`zuke ${command}: ${tool} ${toolArgs[0]} exited ${code}.`));
    return code;
  }
  // `deno remove` and `npm uninstall` exit 0 when they find nothing to
  // remove; an unchanged manifest is how that shows.
  if (command === "remove" && (await config()) === before) {
    log(paint.fail(
      `zuke remove: nothing was removed; this project's ${manifest} has no ` +
        `${named}.`,
    ));
    return 1;
  }
  log(paint.ok(
    `${command === "add" ? "Added" : "Removed"} ${named}.`,
  ));
  return 0;
}
