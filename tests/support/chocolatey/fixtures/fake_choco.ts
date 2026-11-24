// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A stand-in for `choco`, run by the running `deno` through the shim
 * `tests/_fake_choco.ts` writes. It records every invocation and imitates just
 * enough of Chocolatey for a verification or a publish to run against it:
 *
 * - `pack <id>.nuspec --output-directory=<dir>` reads the nuspec from the
 *   working directory and writes `<dir>/<id>.<version>.nupkg`;
 * - `install <id> --source=<dir> --version=<v>` fails unless that `.nupkg` is
 *   in the source, which is what proves the package was packed there, then
 *   puts a shim named `<id>` in `$FAKE_CHOCO_BIN` that prints `<id> v<v>`;
 * - `uninstall <id>` removes the shim;
 * - a verb named in `$FAKE_CHOCO_FAIL` exits 1, printing its argv on stderr
 *   (so a test can prove a key is masked there too); `pack-none` and
 *   `pack-two` make `pack` write no `.nupkg` or two, and `shim` makes the
 *   installed shim exit 1.
 *
 * @module
 */

const log = Deno.env.get("FAKE_CHOCO_LOG") ?? "";
const bin = Deno.env.get("FAKE_CHOCO_BIN") ?? "";
const failing = (Deno.env.get("FAKE_CHOCO_FAIL") ?? "").split(",");
const args = Deno.args;
const verb = args[0] ?? "";

/** The value of `--<name>=…` in the argv, if present. */
function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

Deno.writeTextFileSync(
  log,
  JSON.stringify({ args, cwd: Deno.cwd() }) + "\n",
  { append: true },
);

if (failing.includes(verb)) {
  console.error(`fake choco: ${verb} failed: ${args.join(" ")}`);
  Deno.exit(1);
}
if (verb === "pack") {
  const nuspec = Deno.readTextFileSync(args[1] ?? "");
  const id = /<id>(.*)<\/id>/.exec(nuspec)?.[1] ?? "";
  const version = /<version>(.*)<\/version>/.exec(nuspec)?.[1] ?? "";
  const out = option("output-directory") ?? ".";
  if (!failing.includes("pack-none")) {
    Deno.writeTextFileSync(`${out}/${id}.${version}.nupkg`, nuspec);
  }
  if (failing.includes("pack-two")) {
    Deno.writeTextFileSync(`${out}/${id}.0.0.1.nupkg`, nuspec);
  }
} else if (verb === "install") {
  const id = args[1] ?? "";
  const version = option("version") ?? "";
  try {
    Deno.statSync(`${option("source")}/${id}.${version}.nupkg`);
  } catch {
    console.error(`${id} not installed. The package was not found.`);
    Deno.exit(1);
  }
  const shim = `${bin}/${id}`;
  const exit = failing.includes("shim") ? "exit 1" : "exit 0";
  Deno.writeTextFileSync(
    shim,
    `#!/bin/sh\necho "${id} v${version} $*"\n${exit}\n`,
  );
  Deno.chmodSync(shim, 0o755);
} else if (verb === "uninstall") {
  Deno.removeSync(`${bin}/${args[1] ?? ""}`);
}
