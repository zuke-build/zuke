// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A fake `brew` on disk for the tests that need a real process: a POSIX shim
 * named `brew` that runs `fixtures/fake_brew.ts` with the running `deno`
 * (`Deno.execPath()`), so nothing beyond `deno` and `/bin/sh` is needed.
 *
 * POSIX only — Homebrew itself runs only on macOS and Linux, so the tests that
 * use this skip on Windows.
 *
 * @module
 */

/** A fake brew's paths and what it recorded. */
export interface FakeBrew {
  /** The directory holding the `brew` shim, for `PATH`. */
  binDir: string;
  /** The shim itself, for `.toolPath(...)`. */
  brew: string;
  /** Where the fake keeps its taps. */
  root: string;
  /** The environment the shim reads its log, root and failures from. */
  env: Record<string, string>;
  /** Every recorded invocation, in order. */
  calls(): Array<{ args: string[]; autoUpdate: string | null }>;
  /** Remove everything the fake created. */
  dispose(): void;
}

/** Create a fake brew; `fail` names verbs that should exit 1. */
export function fakeBrew(fail: string[] = []): FakeBrew {
  const dir = Deno.makeTempDirSync({ prefix: "zuke-fake-brew-" });
  const binDir = `${dir}/bin`;
  const root = `${dir}/taps`;
  const log = `${dir}/calls.jsonl`;
  Deno.mkdirSync(binDir);
  Deno.mkdirSync(root);
  Deno.writeTextFileSync(log, "");
  const script = new URL("./fixtures/fake_brew.ts", import.meta.url).pathname;
  const brew = `${binDir}/brew`;
  Deno.writeTextFileSync(
    brew,
    `#!/bin/sh\nexec "${Deno.execPath()}" run --no-config --no-lock -A ` +
      `"${script}" "$@"\n`,
  );
  Deno.chmodSync(brew, 0o755);
  const env = {
    FAKE_BREW_LOG: log,
    FAKE_BREW_ROOT: root,
    FAKE_BREW_FAIL: fail.join(","),
  };
  return {
    binDir,
    brew,
    root,
    env,
    calls() {
      return Deno.readTextFileSync(log).trim().split("\n").filter((line) =>
        line !== ""
      ).map((line) => JSON.parse(line));
    },
    dispose() {
      Deno.removeSync(dir, { recursive: true });
    },
  };
}

/** Whether the fake can run here: it is a POSIX shell shim. */
export const FAKE_BREW_UNSUPPORTED = Deno.build.os === "windows";
