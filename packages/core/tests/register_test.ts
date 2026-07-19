/**
 * Unit tests for the `zuke register` command ({@link registerCommand}): the
 * descriptor it builds, its secret-free surface, idempotent compare-and-swap
 * with conflict retry, `--json` output, and the no-registry error path.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { Build } from "../src/build.ts";
import { target } from "../src/target.ts";
import { parameter } from "../src/params.ts";
import {
  type BuildDescriptor,
  type BuildLocation,
  toBuildSummary,
} from "../src/registry/descriptor.ts";
import type {
  BuildRegistry,
  PutBuildResult,
} from "../src/registry/registry.ts";
import { redactModuleUrl, registerCommand } from "../src/registry/register.ts";

/** Run `fn` with `console.log`/`console.error` captured instead of printed. */
async function capture(
  fn: () => Promise<number> | number,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => void out.push(args.join(" "));
  console.error = (...args: unknown[]) => void err.push(args.join(" "));
  try {
    const code = await fn();
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/** An in-memory {@link BuildRegistry} that can force a set number of conflicts. */
class FakeBuildRegistry implements BuildRegistry {
  readonly builds = new Map<
    string,
    { descriptor: BuildDescriptor; version: string }
  >();
  #version = 0;
  #conflictsLeft: number;

  constructor(conflicts = 0) {
    this.#conflictsLeft = conflicts;
  }

  getBuild(
    id: string,
  ): Promise<{ descriptor: BuildDescriptor; version: string } | null> {
    return Promise.resolve(this.builds.get(id) ?? null);
  }

  register(
    descriptor: BuildDescriptor,
    expectedVersion: string | null,
  ): Promise<PutBuildResult> {
    if (this.#conflictsLeft > 0) {
      this.#conflictsLeft--;
      return Promise.resolve({ ok: false, conflict: true });
    }
    const current = this.builds.get(descriptor.id);
    if ((current?.version ?? null) !== expectedVersion) {
      return Promise.resolve({ ok: false, conflict: true });
    }
    const version = `v${++this.#version}`;
    this.builds.set(descriptor.id, { descriptor, version });
    return Promise.resolve({ ok: true, version });
  }

  deregister(id: string): Promise<void> {
    this.builds.delete(id);
    return Promise.resolve();
  }

  listBuilds() {
    return Promise.resolve(
      [...this.builds.values()].map((b) => toBuildSummary(b.descriptor)),
    );
  }
}

/** A fixture build with a secret parameter, to prove secrets stay out. */
class Sample extends Build {
  apiToken = parameter("api token").secret();
  region = parameter("Region").options("eu", "us");
  compile = target().description("Compile the app").executes(() => {});
}

/** A fixed launch location, so tests never depend on the running module. */
const LOCATION: BuildLocation = {
  kind: "module",
  module: "file:///repo/zuke.ts",
  cwd: "/repo",
};

Deno.test("registerCommand writes a descriptor built from the build", async () => {
  const registry = new FakeBuildRegistry();
  const { code } = await capture(() =>
    registerCommand(new Sample(), {
      registry,
      location: LOCATION,
      actor: "alice",
      readEnv: () => undefined,
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  assertEquals(code, 0);
  const stored = registry.builds.get("Sample");
  assertEquals(stored?.descriptor.id, "Sample");
  assertEquals(stored?.descriptor.name, "Sample");
  assertEquals(stored?.descriptor.actor, "alice");
  assertEquals(stored?.descriptor.location, LOCATION);
  assertEquals(
    stored?.descriptor.surface.targets.map((t) => t.name),
    ["compile"],
  );
});

Deno.test("registerCommand excludes secret parameters from the descriptor", async () => {
  const registry = new FakeBuildRegistry();
  // A secret is configured in the environment; it must never reach the record.
  await capture(() =>
    registerCommand(new Sample(), {
      registry,
      location: LOCATION,
      readEnv: (name) => (name === "API_TOKEN" ? "s3cr3t-value" : undefined),
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  const descriptor = registry.builds.get("Sample")?.descriptor;
  // The secret parameter is omitted entirely — only the non-secret one remains,
  // so a secret can never become a spawnable MCP input or cross the boundary.
  const names = descriptor?.surface.parameters.map((p) => p.name);
  assertEquals(names, ["region"]);
  // Neither the secret's flag nor its value appears anywhere in the record.
  assertEquals(JSON.stringify(descriptor).includes("api-token"), false);
  assertEquals(JSON.stringify(descriptor).includes("s3cr3t-value"), false);
});

Deno.test("registerCommand --json prints the written descriptor", async () => {
  const registry = new FakeBuildRegistry();
  const { code, out } = await capture(() =>
    registerCommand(new Sample(), {
      registry,
      location: LOCATION,
      json: true,
      readEnv: () => undefined,
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  assertEquals(code, 0);
  const parsed: unknown = JSON.parse(out);
  assertEquals(parsed !== null && typeof parsed === "object", true);
  assertStringIncludes(out, '"id": "Sample"');
});

Deno.test("registerCommand is idempotent and preserves createdAt on update", async () => {
  const registry = new FakeBuildRegistry();
  const times = ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"];
  let i = 0;
  const now = () => times[Math.min(i++, times.length - 1)];
  const opts = { registry, location: LOCATION, readEnv: () => undefined, now };
  await capture(() => registerCommand(new Sample(), opts));
  await capture(() => registerCommand(new Sample(), opts));
  const descriptor = registry.builds.get("Sample")?.descriptor;
  assertEquals(descriptor?.createdAt, times[0]); // preserved
  assertEquals(descriptor?.updatedAt, times[1]); // refreshed
});

Deno.test("registerCommand retries on a registry conflict", async () => {
  const registry = new FakeBuildRegistry(1); // one forced conflict, then succeeds
  const { code } = await capture(() =>
    registerCommand(new Sample(), {
      registry,
      location: LOCATION,
      readEnv: () => undefined,
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  assertEquals(code, 0);
  assertEquals(registry.builds.has("Sample"), true);
});

Deno.test("registerCommand accepts an explicit id override", async () => {
  const registry = new FakeBuildRegistry();
  await capture(() =>
    registerCommand(new Sample(), {
      registry,
      id: "sample-prod",
      location: LOCATION,
      readEnv: () => undefined,
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  assertEquals(registry.builds.get("sample-prod")?.descriptor.name, "Sample");
});

Deno.test("registerCommand derives a module location with the CI repo", async () => {
  const registry = new FakeBuildRegistry();
  // No location injected, so deriveLocation runs against the running module.
  await capture(() =>
    registerCommand(new Sample(), {
      registry,
      readEnv: (
        name,
      ) => (name === "GITHUB_REPOSITORY" ? "acme/app" : undefined),
      now: () => "2026-03-01T00:00:00.000Z",
    })
  );
  const location = registry.builds.get("Sample")?.descriptor.location;
  assertEquals(location?.kind, "module");
  assertEquals(location?.repo, "acme/app");
});

Deno.test("registerCommand throws after repeated registry conflicts", async () => {
  const registry = new FakeBuildRegistry(999); // never stops conflicting
  await assertRejects(
    () =>
      registerCommand(new Sample(), {
        registry,
        location: LOCATION,
        readEnv: () => undefined,
        now: () => "2026-03-01T00:00:00.000Z",
      }),
    Error,
    "gave up registering",
  );
});

Deno.test("redactModuleUrl strips credentials but leaves plain URLs and paths", () => {
  // Embedded basic-auth userinfo is stripped from a remote entrypoint.
  assertEquals(
    redactModuleUrl("https://user:token@host/build.ts"),
    "https://host/build.ts",
  );
  // A credential-free URL and a bare path are returned unchanged.
  assertEquals(
    redactModuleUrl("file:///repo/zuke.ts"),
    "file:///repo/zuke.ts",
  );
  assertEquals(redactModuleUrl("/repo/zuke.ts"), "/repo/zuke.ts");
});

Deno.test("registerCommand errors when no registry is configured", async () => {
  const { code, err } = await capture(() =>
    registerCommand(new Sample(), {
      registry: false,
      location: LOCATION,
      readEnv: () => undefined,
    })
  );
  assertEquals(code, 1);
  assertStringIncludes(err, "no build registry is configured");
});
