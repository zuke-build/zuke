// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import {
  defaultMcpAuthorize,
  type McpCall,
  satisfiesRole,
} from "../src/mcp/roles.ts";
import type { McpIdentity } from "../src/mcp/auth.ts";
import type { RunSummary } from "../src/state/types.ts";

/** A caller holding `roles`. */
function caller(actor: string, roles: readonly string[]): McpIdentity {
  return { actor, kind: "human", roles };
}

/** A run summary, optionally with an initiator. */
function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    build: "CD",
    rootTarget: "deploy",
    status: "suspended",
    actor: "sweep-bot",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...over,
  };
}

/** Whether the default policy allows `call` for `identity`. */
function allows(identity: McpIdentity, call: McpCall): boolean {
  return defaultMcpAuthorize(identity, call).allow;
}

// ---- The role model --------------------------------------------------------

Deno.test("the built-in roles are ordered, and custom names are exact", () => {
  // An operator satisfies everything below it…
  for (const required of ["read", "run", "operator"]) {
    assertEquals(satisfiesRole(["operator"], required), true, required);
  }
  // …and `run` satisfies `read` but not `operator`.
  assertEquals(satisfiesRole(["run"], "read"), true);
  assertEquals(satisfiesRole(["run"], "run"), true);
  assertEquals(satisfiesRole(["run"], "operator"), false);
  assertEquals(satisfiesRole(["read"], "run"), false);

  // A name outside the tiers is matched exactly, in both directions: holding it
  // grants no tier, and holding a tier does not grant it. Ordering an unknown
  // name would mean guessing where someone else's group sits in a hierarchy it
  // never agreed to.
  assertEquals(satisfiesRole(["sre"], "sre"), true);
  assertEquals(satisfiesRole(["sre"], "run"), false);
  assertEquals(satisfiesRole(["operator"], "sre"), false);
  assertEquals(satisfiesRole([], "read"), false);
});

// ---- The default policy ----------------------------------------------------

Deno.test("read tools need read, and running needs run", () => {
  const reader = caller("ada", ["read"]);
  for (const tool of ["list_runs", "show_run", "describe_build", "graph"]) {
    assertEquals(allows(reader, { tool }), true, tool);
  }
  assertEquals(allows(reader, { tool: "run:deploy" }), false);
  assertEquals(allows(caller("ada", ["run"]), { tool: "run:deploy" }), true);
  assertEquals(allows(caller("ada", []), { tool: "list_runs" }), false);
});

Deno.test("a target may ask for more than run, and only more", () => {
  const runner = caller("ada", ["run"]);
  const op = caller("ada", ["operator"]);
  const call = { tool: "run:promote", requiredRole: "operator" };
  assertEquals(allows(runner, call), false);
  assertEquals(allows(op, call), true);

  // A custom requirement is checked *in addition* to `run`, and is satisfied
  // only by that exact role — an operator does not inherit someone else's
  // group, and holding the group alone is not permission to execute anything.
  const custom = { tool: "run:release", requiredRole: "release-manager" };
  assertEquals(allows(op, custom), false);
  assertEquals(allows(caller("ada", ["release-manager"]), custom), false);
  assertEquals(allows(caller("ada", ["run", "release-manager"]), custom), true);

  // requiresRole can only raise the bar. Requiring it *instead of* `run` would
  // let a build declaration hand a read-only caller the ability to execute.
  assertEquals(
    allows(caller("ada", ["read"]), { tool: "run:x", requiredRole: "read" }),
    false,
  );
  assertEquals(
    allows(caller("ada", ["run"]), { tool: "run:x", requiredRole: "read" }),
    true,
  );
});

Deno.test("a run-scoped mutation needs the initiator, or an operator", () => {
  const owned = run({
    initiator: { actor: "ada", kind: "human", at: "2026-09-06T10:00:00.000Z" },
  });
  for (const tool of ["cancel_run", "signal_run", "force_target"]) {
    // The person who started it may steer it…
    assertEquals(
      allows(caller("ada", ["run"]), { tool, run: owned }),
      true,
      tool,
    );
    // …a stranger with the same role may not…
    assertEquals(
      allows(caller("bob", ["run"]), { tool, run: owned }),
      false,
      tool,
    );
    // …and an operator may.
    assertEquals(
      allows(caller("bob", ["operator"]), { tool, run: owned }),
      true,
      tool,
    );
    // Below `run` nobody may, not even the initiator.
    assertEquals(
      allows(caller("ada", ["read"]), { tool, run: owned }),
      false,
      tool,
    );
  }
});

Deno.test("a service-initiated run may be steered by any run caller", () => {
  // A scheduler's run has no person to ask; treating the scheduler as its owner
  // would mean nobody could intervene.
  const machine = run({
    initiator: {
      actor: "nightly",
      kind: "service",
      at: "2026-09-06T10:00:00.000Z",
    },
  });
  assertEquals(
    allows(caller("bob", ["run"]), { tool: "cancel_run", run: machine }),
    true,
  );
  assertEquals(
    allows(caller("bob", ["read"]), { tool: "cancel_run", run: machine }),
    false,
  );
});

Deno.test("a run with no initiator falls back to its actor as owner", () => {
  // A record written before initiators existed; `actor` is the closest answer.
  const legacy = run({ actor: "ada" });
  assertEquals(
    allows(caller("ada", ["run"]), { tool: "cancel_run", run: legacy }),
    true,
  );
  assertEquals(
    allows(caller("bob", ["run"]), { tool: "cancel_run", run: legacy }),
    false,
  );
});

Deno.test("a sweep over every run needs operator", () => {
  // No run named: it touches all of them, which no single run's owner can
  // authorize.
  const sweep = { tool: "resume_check" };
  assertEquals(allows(caller("ada", ["run"]), sweep), false);
  assertEquals(allows(caller("ada", ["operator"]), sweep), true);

  // Named, it is an ordinary run-scoped call.
  const owned = run({
    initiator: { actor: "ada", kind: "human", at: "2026-09-06T10:00:00.000Z" },
  });
  assertEquals(
    allows(caller("ada", ["run"]), { tool: "resume_check", run: owned }),
    true,
  );
});

Deno.test("a denial says which rule refused, and names the owner", () => {
  const owned = run({
    initiator: { actor: "ada", kind: "human", at: "2026-09-06T10:00:00.000Z" },
  });
  const verdict = defaultMcpAuthorize(caller("bob", ["run"]), {
    tool: "cancel_run",
    run: owned,
  });
  assertEquals(verdict.allow, false);
  if (verdict.allow) throw new Error("expected a denial");
  assertStringIncludes(verdict.reason, "ada");
  assertStringIncludes(verdict.reason, "operator");

  // The floor is reported first for a caller who cannot run at all…
  const noRun = defaultMcpAuthorize(caller("bob", ["read"]), {
    tool: "run:promote",
    requiredRole: "operator",
  });
  if (noRun.allow) throw new Error("expected a denial");
  assertStringIncludes(noRun.reason, '"run"');

  // …and the target's own requirement once they clear it.
  const needsRole = defaultMcpAuthorize(caller("bob", ["run"]), {
    tool: "run:promote",
    requiredRole: "operator",
  });
  if (needsRole.allow) throw new Error("expected a denial");
  assertStringIncludes(needsRole.reason, '"operator"');
});
