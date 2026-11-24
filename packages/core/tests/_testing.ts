// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Test registration that runs on either runtime: every test in the suite is
 * registered with {@link test}, which hands it to `Deno.test` under Deno and
 * to Vitest under Node, so one set of files serves the Deno lane and the Node
 * lane alike.
 *
 * Only what the suite uses is mirrored: a name and a body, or a definition
 * with `ignore`, Deno's two sanitizers and its permissions, and `t.step` for
 * a body made of named stages. Vitest has no sanitizers and no nested steps,
 * so under Node the sanitizers are dropped and a step runs inline, failing
 * the test with its own error; a test that sets Deno permissions is skipped.
 *
 * Vitest is loaded with a specifier Deno cannot see, and only under Node:
 * Deno type-checks a literal dynamic import, and resolving Vitest would send
 * every `deno test` to npm.
 */

/** The context a test body is given: one way to run a named stage. */
export interface TestContext {
  /** Run `fn` as a stage named `name`; resolves to whether it passed. */
  step(name: string, fn: () => unknown): Promise<boolean>;
}

/** A test body. */
export type TestFn = (t: TestContext) => unknown;

/** A test, with the options the suite sets. */
export interface TestDefinition {
  /** The test's name, as the runner reports it. */
  name: string;
  /** The body. */
  fn: TestFn;
  /** Whether to skip it. */
  ignore?: boolean;
  /** Deno's resource sanitizer; Vitest has none. */
  sanitizeResources?: boolean;
  /** Deno's async-operation sanitizer; Vitest has none. */
  sanitizeOps?: boolean;
  /**
   * Deno's permissions for the test. Only Deno has a permission system, so a
   * test that sets them is about Deno and is skipped under Node.
   */
  permissions?: Deno.PermissionOptions;
}

/** The part of Vitest's `test` this module calls. */
interface VitestTest {
  (name: string, fn: () => Promise<void>, timeout: number): void;
  skip(name: string, fn: () => Promise<void>): void;
}

/** Whether the suite is running on Deno. */
const ON_DENO = typeof Deno !== "undefined";

/** Vitest's package name, kept out of Deno's sight (see the module doc). */
const VITEST = ["vi", "test"].join("");

/** Vitest's `test` under Node; unused under Deno. */
const vitestTest: VitestTest | undefined = ON_DENO
  ? undefined
  : (await import(VITEST)).test;

/**
 * Vitest's per-test time limit. Deno sets none, and the suite's subprocess
 * and e2e tests run for minutes, so the limit only stops a test that hangs.
 */
const NODE_TIMEOUT_MS = 600_000;

/** A step under Node: the stage runs inline, and its failure fails the test. */
const inline: TestContext = {
  step: async (_name, fn) => {
    await fn();
    return true;
  },
};

/** Register a test named `name` whose body is `fn`. */
export function test(name: string, fn: TestFn): void;
/** Register the test `definition` describes. */
export function test(definition: TestDefinition): void;
export function test(
  nameOrDefinition: string | TestDefinition,
  fn?: TestFn,
): void {
  const definition = typeof nameOrDefinition === "string"
    ? { name: nameOrDefinition, fn }
    : nameOrDefinition;
  const body = definition.fn;
  if (body === undefined) {
    throw new TypeError(`test "${definition.name}" has no body`);
  }
  if (vitestTest === undefined) {
    Deno.test({
      ...definition,
      fn: async (t) => {
        await body(t);
      },
    });
    return;
  }
  const run = async () => {
    await body(inline);
  };
  const denoOnly = "permissions" in definition &&
    definition.permissions !== undefined;
  if (denoOnly || ("ignore" in definition && definition.ignore === true)) {
    vitestTest.skip(definition.name, run);
  } else {
    vitestTest(definition.name, run, NODE_TIMEOUT_MS);
  }
}
