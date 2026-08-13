// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the executor's planning helpers — the interactive parameter
 * prompt's terminal/CI gating, and the condition-skip walk that prunes a
 * `whenSkipped("skip-dependencies")` target without dropping what a `triggers`
 * edge still reaches.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import { Build, discoverTargets } from "../src/build.ts";
import { target } from "../src/target.ts";
import { conditionSkips, defaultPrompt } from "../src/execute_plan.ts";

/** Every variable {@link "../src/host.ts".detectCiHost} and `isCI` consult. */
const CI_VARS = [
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "TF_BUILD",
  "BITBUCKET_BUILD_NUMBER",
  "CI",
];

/** Run `fn` with every CI marker cleared, so `isCI()` reads local. */
function withLocalHost(fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const name of CI_VARS) {
    saved.set(name, Deno.env.get(name));
    Deno.env.delete(name);
  }
  try {
    fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

/** Run `fn` with `Deno.stdin.isTerminal` stubbed, restored afterwards. */
function withStdinTerminal(stub: () => boolean, fn: () => void): void {
  const original = Deno.stdin.isTerminal;
  Deno.stdin.isTerminal = stub;
  try {
    fn();
  } finally {
    Deno.stdin.isTerminal = original;
  }
}

/** Run `fn` with the global `prompt` stubbed, restored afterwards. */
function withPrompt(
  stub: (message?: string, defaultValue?: string) => string | null,
  fn: () => void,
): void {
  const original = globalThis.prompt;
  globalThis.prompt = stub;
  try {
    fn();
  } finally {
    globalThis.prompt = original;
  }
}

Deno.test("defaultPrompt never prompts when the terminal check itself throws", () => {
  // A runtime with no stdin (a worker, a stripped-down embed) throws from
  // isTerminal(); that must read as "not interactive", not crash resolution.
  withPrompt(() => {
    throw new Error("prompt must not be reached");
  }, () => {
    withStdinTerminal(() => {
      throw new Error("stdin unavailable");
    }, () => {
      assertEquals(defaultPrompt("env", "target environment"), undefined);
    });
  });
});

Deno.test("defaultPrompt asks at an interactive terminal, labelling flag and description", () => {
  withLocalHost(() =>
    withStdinTerminal(() => true, () => {
      const asked: (string | undefined)[] = [];
      withPrompt((message) => {
        asked.push(message);
        return "sit-7";
      }, () => {
        assertEquals(defaultPrompt("env", "target environment"), "sit-7");
      });
      // The label names the flag the operator would have passed, with the
      // declared description so they know what is being asked for.
      assertEquals(asked, ["--env (target environment):"]);
    })
  );
});

Deno.test("a dismissed prompt leaves the parameter unset", () => {
  withLocalHost(() =>
    withStdinTerminal(() => true, () => {
      const asked: (string | undefined)[] = [];
      withPrompt((message) => {
        asked.push(message);
        return null; // the operator hit Ctrl-D / entered nothing
      }, () => {
        assertEquals(defaultPrompt("env", undefined), undefined);
      });
      // Without a description the label is the bare flag.
      assertEquals(asked, ["--env:"]);
    })
  );
});

Deno.test("conditionSkips keeps triggered targets and tolerates an unbound dependency", async () => {
  class B extends Build {
    helper = target().executes(() => {});
    optional = target()
      .dependsOn(this.helper)
      .onlyWhen(() => false)
      .whenSkipped("skip-dependencies")
      .executes(() => {});
    fire = target().executes(() => {});
    root = target()
      .triggers(this.fire)
      // @ts-expect-error deliberately forward-references a later field: class
      // fields initialise top-to-bottom, so `this.later` is undefined here and
      // the walk's runtime guard must skip it instead of crashing on `.name_`.
      .dependsOn(this.optional, this.later)
      .executes(() => {});
    later = target().executes(() => {});
  }
  const b = new B();
  discoverTargets(b);

  const names = await conditionSkips(b.root, [
    b.helper,
    b.optional,
    b.fire,
    b.root,
  ]);
  // The pruned target and the dependency only it needed are skipped; the
  // target reachable through `triggers` survives (the walk follows trigger
  // edges, not just dependencies); the unbound forward reference is ignored.
  assertEquals(names, new Set(["optional", "helper"]));
});
