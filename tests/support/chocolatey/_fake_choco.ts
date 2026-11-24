// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A fake `choco` on disk for the tests that need a real process: a POSIX shim
 * named `choco` that runs `fixtures/fake_choco.ts` with the running `deno`
 * (`Deno.execPath()`), so nothing beyond `deno` and `/bin/sh` is needed.
 *
 * POSIX only: the fake and the shims it installs are shell scripts, which
 * Windows cannot launch — so the tests that use it skip there. What they prove
 * (the order of the calls, the cleanup, the masking) does not depend on the
 * host; the real `choco` on Windows is exercised by the verification job.
 *
 * @module
 */

/** A fake choco's paths and what it recorded. */
export interface FakeChoco {
  /** The directory holding the `choco` shim and the shims it installs, for `PATH`. */
  binDir: string;
  /** The shim itself, for `.toolPath(...)`. */
  choco: string;
  /** The environment the shim reads its log, bin and failures from. */
  env: Record<string, string>;
  /** Every recorded invocation, in order. */
  calls(): Array<{ args: string[]; cwd: string }>;
  /** Remove everything the fake created. */
  dispose(): void;
}

/** Create a fake choco; `fail` names verbs (and modes) that should fail. */
export function fakeChoco(fail: string[] = []): FakeChoco {
  const dir = Deno.makeTempDirSync({ prefix: "zuke-fake-choco-" });
  const binDir = `${dir}/bin`;
  const log = `${dir}/calls.jsonl`;
  Deno.mkdirSync(binDir);
  Deno.writeTextFileSync(log, "");
  const script = new URL("./fixtures/fake_choco.ts", import.meta.url).pathname;
  const choco = `${binDir}/choco`;
  Deno.writeTextFileSync(
    choco,
    `#!/bin/sh\nexec "${Deno.execPath()}" run --no-config --no-lock -A ` +
      `"${script}" "$@"\n`,
  );
  Deno.chmodSync(choco, 0o755);
  // The staging directory is created under TMPDIR. Pointed at a resolved path,
  // the directory a task passes to choco and the working directory the fake
  // records (which the OS reports resolved) agree on macOS, where the default
  // temp dir sits behind the /var -> /private/var link.
  const tmp = `${Deno.realPathSync(dir)}/tmp`;
  Deno.mkdirSync(tmp);
  const env = {
    TMPDIR: tmp,
    FAKE_CHOCO_LOG: log,
    FAKE_CHOCO_BIN: binDir,
    FAKE_CHOCO_FAIL: fail.join(","),
  };
  return {
    binDir,
    choco,
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
export const FAKE_CHOCO_UNSUPPORTED = Deno.build.os === "windows";
