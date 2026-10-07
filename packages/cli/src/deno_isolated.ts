// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Running a one-off Deno subcommand away from the caller's project.
 *
 * `zuke doc` (`deno doc <spec>`) and `zuke upgrade` (`deno install -g …`)
 * both run Deno on the CLI's own behalf rather than the project's, so neither
 * may pick up the surrounding repo's `deno.json`, import map, `node_modules`
 * or `tsconfig`. Both run from a throwaway directory, and both relay what the
 * child printed through the package's sink instead of inheriting its stdio.
 *
 * @module
 */

import { spawnDeno } from "./deno_path.ts";
import { output } from "./output.ts";

/**
 * Spawn `deno <denoArgs>` — {@link spawnDeno} finds the Deno to run, and puts
 * that Deno first on the child's `PATH` — in a fresh temp directory named
 * with `prefix`, which is removed afterwards. Returns the child's exit code.
 *
 * The child's output is not inherited. It can repeat arguments the user passed
 * (`deno doc` names a `--filter` it could not find), and it can print a
 * third-party package's own text, and neither may reach an Actions runner raw.
 * Its stdin is closed rather than inherited: these subcommands never read the
 * terminal, and the CLI's own stdin is not theirs to consume.
 */
export async function runDenoIsolated(
  denoArgs: string[],
  prefix: string,
): Promise<number> {
  const cwd = await Deno.makeTempDir({ prefix });
  try {
    const child = spawnDeno(denoArgs, {
      cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await child.output();
    const relay = (bytes: Uint8Array, write: (line: string) => void) => {
      const text = new TextDecoder().decode(bytes);
      // The console adds the line's own newline; keep the text otherwise as
      // the child wrote it, blank lines included.
      if (text !== "") write(text.endsWith("\n") ? text.slice(0, -1) : text);
    };
    relay(stdout, output.info);
    relay(stderr, output.error);
    return code;
  } finally {
    await Deno.remove(cwd, { recursive: true });
  }
}
