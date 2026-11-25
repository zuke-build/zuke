// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Fake `xcrun notarytool` and `security` subprocesses, built from the running
 * runtime alone (AGENTS.md guideline 5).
 *
 * Both tools put a subcommand right after the binary — `xcrun notarytool
 * submit …`, `security import …` — and both runtimes run `<runtime> <file>
 * <args…>` as a script. So pointing a wrapper at `RuntimeTasks.execPath()` and
 * running it in a directory holding a script named after that first token
 * (`notarytool`, `import`, …) spawns the script with the wrapper's real argv.
 * No shell, no copied binary, and it works the same on every OS. The scripts
 * run with no permissions, so all they can do is read their argv and print.
 *
 * @module
 */

import { FileTasks } from "@zuke/core";
import { assertRejects } from "../../_assert.ts";

/**
 * Assert that `fn` rejects with an `ErrorClass` and return the error typed as
 * one, so a test can read the class's own fields.
 */
export async function rejection<E extends Error>(
  fn: () => PromiseLike<unknown>,
  ErrorClass: new (...args: never[]) => E,
): Promise<E> {
  const error = await assertRejects(fn, ErrorClass);
  if (error instanceof ErrorClass) return error;
  throw new Error(`expected a ${ErrorClass.name}`);
}

/** One canned answer of a fake subcommand. */
export interface FakeResponse {
  /** Printed on stdout. */
  stdout?: string;
  /** Printed on stderr. */
  stderr?: string;
  /** The exit code (default 0). */
  code?: number;
  /** Argv tokens that must all be present, else the fake exits 4. */
  needs?: string[];
}

/**
 * The script for one fake: it dispatches on its first argument — the
 * notarytool subcommand — or, when `dispatch` is false, answers the same for
 * any argv. It reads `process`, which both runtimes provide as a global.
 */
function script(
  responses: Record<string, FakeResponse>,
  dispatch: boolean,
): string {
  return [
    `const responses = ${JSON.stringify(responses)};`,
    `const args = process.argv.slice(2);`,
    `const r = ${dispatch ? "responses[args[0]]" : 'responses[""]'};`,
    `if (r === undefined) { console.error("unexpected " + args[0]); process.exit(3); }`,
    `if (r.needs && !r.needs.every((a) => args.includes(a))) {`,
    `  console.error("missing " + r.needs.join(" ")); process.exit(4);`,
    `}`,
    `if (r.stderr) console.error(r.stderr);`,
    `if (r.stdout) console.log(r.stdout);`,
    `process.exit(r.code ?? 0);`,
  ].join("\n");
}

/**
 * A temp directory holding a fake `notarytool` that answers each subcommand
 * (`submit`, `log`, …) from `responses`. Run a notarytool wrapper against it
 * with `.toolPath(RuntimeTasks.execPath()).cwd(dir)`.
 */
export async function fakeNotarytool(
  responses: Record<string, FakeResponse>,
): Promise<string> {
  const dir = await FileTasks.makeTempDirectory((s) =>
    s.prefix("zuke-apple-fake-")
  );
  await FileTasks.writeText(`${dir}/notarytool`, script(responses, true));
  return dir;
}

/**
 * Write a fake `security` subcommand per entry of `responses` (keyed by the
 * subcommand, e.g. `find-identity`) into `dir`, each answering the same for any
 * argv. Run a security wrapper against it with
 * `.toolPath(RuntimeTasks.execPath()).cwd(dir)`, or from `dir` as the working
 * directory.
 */
export async function writeFakeSecurity(
  dir: string,
  responses: Record<string, FakeResponse>,
): Promise<void> {
  for (const [subcommand, response] of Object.entries(responses)) {
    await FileTasks.writeText(
      `${dir}/${subcommand}`,
      script({ "": response }, false),
    );
  }
}
