// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `package.json` of a package's npm build, derived from its `deno.json`.
 * Pure: it reads nothing, so the same input is always the same manifest.
 *
 * Every package is published to npm as `@zuke-build/<name>` (the `@zuke` scope
 * belongs to someone else there) and consumed as `@zuke/<name>` through an npm
 * alias, so the specifiers in compiled code stay what the sources say.
 */

/** The npm scope the packages are published under. */
export const NPM_SCOPE = "@zuke-build";

/** The fields of a `deno.json` the manifest is built from, validated. */
export interface DenoPackage {
  /** `@zuke/<name>`. */
  name: string;
  /** The package's version. */
  version: string;
  /** The package's description, when its `deno.json` has one. */
  description?: string;
  /** Export key (`"."`, `"./shell"`) to source path (`"./src/shell.ts"`). */
  exports: Record<string, string>;
  /** `@zuke/<name>` to its declared semver range, for each `@zuke/*` import. */
  dependencies: Record<string, string>;
}

const JSR_ZUKE = /^jsr:(@zuke\/[a-z0-9-]+)@(.+)$/;

function stringField(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== "string") {
    throw new Error(`deno.json "${key}" must be a string.`);
  }
  return value;
}

/**
 * Validate a parsed `deno.json` as a publishable package.
 *
 * @throws {Error} naming the field, for a missing or mistyped field and for
 * any import that is not a `jsr:@zuke/*` one: a package has no other
 * dependency, and an npm build must not quietly ship a specifier it cannot
 * resolve.
 */
export function parseDenoPackage(value: unknown): DenoPackage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("deno.json must be a JSON object.");
  }
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  const name = stringField(record, "name");
  const exportsField = record.exports;
  const exports: Record<string, string> = {};
  if (typeof exportsField === "string") exports["."] = exportsField;
  else if (typeof exportsField === "object" && exportsField !== null) {
    for (const [key, path] of Object.entries(exportsField)) {
      if (typeof path !== "string") {
        throw new Error(`${name}: export "${key}" must be a string path.`);
      }
      exports[key] = path;
    }
  } else throw new Error(`${name}: deno.json "exports" is missing.`);
  const dependencies: Record<string, string> = {};
  const imports = record.imports;
  if (imports !== undefined) {
    if (typeof imports !== "object" || imports === null) {
      throw new Error(`${name}: deno.json "imports" must be an object.`);
    }
    for (const [key, target] of Object.entries(imports)) {
      const match = typeof target === "string" ? JSR_ZUKE.exec(target) : null;
      if (match === null || match[1] !== key) {
        throw new Error(
          `${name}: import "${key}" (${String(target)}) is not a ` +
            "jsr:@zuke/* package; npm packages have no other dependencies.",
        );
      }
      dependencies[key] = match[2];
    }
  }
  return {
    name,
    version: stringField(record, "version"),
    ...(record.description === undefined
      ? {}
      : { description: stringField(record, "description") }),
    exports,
    dependencies,
  };
}

/** `@zuke/core` → `core`: the part after the scope. */
export function shortName(denoName: string): string {
  if (!denoName.startsWith("@zuke/")) {
    throw new Error(`${denoName} is not an @zuke/* package.`);
  }
  return denoName.slice("@zuke/".length);
}

/** Where a source file's compiled output is, extension swapped: `.ts` → `ext`. */
export function emitted(path: string, ext: ".js" | ".d.ts"): string {
  if (!path.endsWith(".ts")) throw new Error(`${path} is not a .ts file.`);
  return path.slice(0, -3) + ext;
}

/** The `package.json` object for the package whose `deno.json` is `deno`. */
export function npmManifest(deno: unknown): Record<string, unknown> {
  const pkg = parseDenoPackage(deno);
  const short = shortName(pkg.name);
  return {
    name: `${NPM_SCOPE}/${short}`,
    version: pkg.version,
    ...(pkg.description === undefined ? {} : { description: pkg.description }),
    license: "MIT",
    type: "module",
    exports: Object.fromEntries(
      Object.entries(pkg.exports).map(([key, path]) => [key, {
        types: emitted(path, ".d.ts"),
        default: emitted(path, ".js"),
      }]),
    ),
    files: ["**/*.js", "**/*.d.ts"],
    ...(short === NPM_BIN_PACKAGE ? { bin: { zuke: NPM_BIN_FILE } } : {}),
    engines: { node: ">=24.12" },
    repository: {
      type: "git",
      url: "git+https://github.com/zuke-build/zuke.git",
      directory: `packages/${short}`,
    },
    homepage: "https://zuke.build",
    bugs: { url: "https://github.com/zuke-build/zuke/issues" },
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, range]) => [
          name,
          `npm:${NPM_SCOPE}/${shortName(name)}@${range}`,
        ]),
    ),
  };
}

/**
 * The packages that are not published to npm: `engine` loads `jsr:` specifiers
 * with a runtime `import()` (its tool wrappers), which Node cannot resolve, so
 * an npm install of it would fail the first time it ran. It stays out until
 * the Node support of the engine's phase 3 lets it load without `jsr:`.
 */
export const NPM_EXCLUDED: readonly string[] = ["engine"];

/** The package whose npm build also ships the `zuke` executable. */
export const NPM_BIN_PACKAGE = "cli";

/** The `bin` entry of {@link NPM_BIN_PACKAGE}: the file `npmBuild` writes. */
export const NPM_BIN_FILE = "zuke.js";

/**
 * The executable `npmBuild` writes beside the CLI's compiled modules. It calls
 * the entry itself: npm's bin symlinks and Windows `.cmd` shims would make an
 * `import.meta.main` check false.
 */
export const NPM_BIN_SOURCE = `#!/usr/bin/env node
// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { RuntimeTasks } from "@zuke/core";
import { main } from "./mod.js";

RuntimeTasks.exit(await main(RuntimeTasks.args()));
`;

/** `packages` without {@link NPM_EXCLUDED}: what `npmBuild`, `publishNpm` and `npmTrust` handle. */
export function npmPackages(packages: readonly string[]): string[] {
  return packages.filter((pkg) => !NPM_EXCLUDED.includes(pkg));
}
