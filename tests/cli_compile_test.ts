// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for building the CLI's standalone binaries: what the bundle is asked
 * for, and the version check run on the binary built for this machine.
 *
 * The version check runs a real executable — the running `deno`, whose
 * `--version` first line is known — so it is exercised without a compile.
 *
 * @module
 */

import { test } from "../packages/core/tests/_testing.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { withTemp, withTempCwd } from "../packages/core/tests/_temp.ts";
import { absolutePath, RuntimeTasks } from "@zuke/core";
import { DenoBundleSettings } from "@zuke/deno";
import {
  assertReportsVersion,
  awaitJsrListing,
  BUNDLE_FILE,
  cliSpecifier,
  compileCliBinaries,
  ENTRY_FILE,
  jsrMetaUrl,
} from "../build/cli_compile.ts";
import { hostTriple } from "../build/cli_node_compile.ts";
import { binaryPath } from "../build/cli_package.ts";

/** The running deno, as the absolute path the smoke check takes. */
const deno = absolutePath(Deno.execPath());

/** The first line `deno --version` prints. */
async function denoVersionLine(): Promise<string> {
  const { stdout } = await new Deno.Command(Deno.execPath(), {
    args: ["--version"],
  }).output();
  return new TextDecoder().decode(stdout).split("\n")[0];
}

test("the binaries are compiled from the published JSR release", () => {
  assertEquals(cliSpecifier("1.14.0"), "jsr:@zuke/cli@1.14.0");
});

/** Bundle settings that remember the directory the bundle runs in. */
class InDirectory extends DenoBundleSettings {
  /** The `cwd` it was given. */
  dir = "";

  /** Remember `path`, then set it. */
  override cwd(path: string): this {
    this.dir = path;
    return super.cwd(path);
  }
}

test("compileCliBinaries bundles the entry, compiles the bundle, and runs the host's binary", async () => {
  await withTemp(async (dir) => {
    const bin = absolutePath(dir, "bin");
    const bundles: string[][] = [];
    const host = hostTriple(RuntimeTasks.os(), RuntimeTasks.arch());
    const expected = host === undefined ? "1.14.0" : await denoVersionLine();
    let compiled = "";
    const signed: string[] = [];
    await compileCliBinaries(
      expected,
      bin,
      "// the entry\n",
      async (configure) => {
        const settings = new InDirectory();
        configure(settings);
        bundles.push(settings.argv().slice(1));
        // The entry is written before the bundle reads it, in its directory.
        const cwd = settings.dir;
        assertEquals(
          await Deno.readTextFile(`${cwd}/${ENTRY_FILE}`),
          "// the entry\n",
        );
        await Deno.writeTextFile(`${cwd}/${BUNDLE_FILE}`, "// bundled\n");
      },
      async (bundle, binDir) => {
        compiled = await Deno.readTextFile(bundle.path);
        assertEquals(binDir.path, bin.path);
        // Stand in for the binary built for this machine with the running
        // deno, whose --version the check then reads. Copied, not linked:
        // a symlink needs privileges on Windows, which is a host too.
        if (host !== undefined) {
          await Deno.mkdir(`${bin.path}/${host}`, { recursive: true });
          await Deno.copyFile(Deno.execPath(), binaryPath(bin.path, host));
        }
      },
      (binary) => {
        signed.push(binary);
        return Promise.resolve();
      },
    );
    // Only a macOS host signs its binary before running it.
    assertEquals(
      signed,
      host !== undefined && RuntimeTasks.os() === "darwin"
        ? [binaryPath(bin.path, host)]
        : [],
    );
    assertEquals(bundles, [["bundle", "--output", BUNDLE_FILE, ENTRY_FILE]]);
    assertEquals(compiled, "// bundled\n");
  });
});

test("assertReportsVersion accepts exactly the version asked for", async () => {
  await assertReportsVersion(deno, await denoVersionLine());
  await assertRejects(
    () => assertReportsVersion(deno, "1.14.0"),
    Error,
    "did not resolve the release it was asked for",
  );
});

test("assertReportsVersion names the binary and what it reported", async () => {
  const error = await assertRejects(
    () => assertReportsVersion(deno, "9.9.9"),
    Error,
  );
  assertStringIncludes(error.message, deno.path);
  assertStringIncludes(error.message, JSON.stringify(await denoVersionLine()));
});

test("assertReportsVersion runs a binary named relative to the build's directory", async () => {
  // The signing job names the binary under `dist/cli/bin`, relative to the
  // checkout; the check runs it from a temporary directory, so the path must
  // be resolved against the checkout first.
  if (Deno.build.os === "windows") return;
  await withTempCwd(async () => {
    await Deno.mkdir("bin/host", { recursive: true });
    await Deno.symlink(Deno.execPath(), binaryPath("bin", "host"));
    await assertReportsVersion(
      absolutePath(Deno.cwd(), binaryPath("bin", "host")),
      await denoVersionLine(),
    );
  });
});

/**
 * A registry answering each call from `answers` in turn: a status, or the
 * versions a 200 lists. The last answer repeats once they run out.
 */
function registry(
  answers: Array<number | string[]>,
): { fetcher: typeof fetch; urls: string[]; waits: number[] } {
  const urls: string[] = [];
  const waits: number[] = [];
  let calls = 0;
  const fetcher: typeof fetch = (input) => {
    urls.push(String(input));
    const answer = answers[Math.min(calls++, answers.length - 1)];
    return Promise.resolve(
      typeof answer === "number"
        ? new Response("", { status: answer })
        : Response.json({
          latest: answer.at(-1),
          versions: Object.fromEntries(answer.map((v) => [v, {}])),
        }),
    );
  };
  return { fetcher, urls, waits };
}

/** The clock {@link awaitJsrListing} is given: records, never sleeps. */
function clock(waits: number[]): (ms: number) => Promise<void> {
  return (ms) => {
    waits.push(ms);
    return Promise.resolve();
  };
}

test("awaitJsrListing returns at once when the registry already lists the version", async () => {
  const { fetcher, urls, waits } = registry([["1.0.0", "2.1.0"]]);
  await awaitJsrListing("cli", "2.1.0", fetcher, clock(waits));
  assertEquals(urls, ["https://jsr.io/@zuke/cli/meta.json"]);
  assertEquals(waits, []);
});

test("awaitJsrListing polls until the version appears, through a registry hiccup", async () => {
  const { fetcher, urls, waits } = registry([["1.0.0"], 503, [
    "1.0.0",
    "2.1.0",
  ]]);
  await awaitJsrListing("docker", "2.1.0", fetcher, clock(waits));
  assertEquals(urls.length, 3);
  assertEquals(urls[0], jsrMetaUrl("docker"));
  assertEquals(waits, [5000, 5000]);
});

test("awaitJsrListing gives up after the deadline, naming the last answer", async () => {
  const { fetcher, waits } = registry([["1.0.0"]]);
  await assertRejects(
    () => awaitJsrListing("cli", "2.1.0", fetcher, clock(waits)),
    Error,
    "@zuke/cli 2.1.0 is not listed by https://jsr.io/@zuke/cli/meta.json after 180s (last answer: a document not listing it)",
  );
  // Three minutes of five-second polls, then the deadline.
  assertEquals(waits.length, 36);
  const failing = registry([500]);
  await assertRejects(
    () =>
      awaitJsrListing("cli", "2.1.0", failing.fetcher, clock(failing.waits)),
    Error,
    "last answer: HTTP 500",
  );
});
