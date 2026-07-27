/**
 * Unit tests for the build-registry vocabulary and the filesystem backend:
 * descriptor parse/round-trip, {@link FileSystemBuildRegistry} compare-and-swap,
 * and {@link resolveBuildRegistry} precedence. Mirrors the state-layer tests.
 */

import { assertEquals, assertRejects, assertThrows } from "./_assert.ts";
import { defaultStateHost, type StateHost } from "../src/state/store.ts";
import type { CliDescription } from "../src/describe.ts";
import {
  type BuildDescriptor,
  parseBuildDescriptor,
  parseBuildSummary,
  stringifyBuildDescriptor,
  toBuildSummary,
} from "../src/registry/descriptor.ts";
import { FileSystemBuildRegistry } from "../src/registry/fs_registry.ts";
import { HttpBuildRegistry } from "../src/registry/http_registry.ts";
import {
  envBuildRegistry,
  resolveBuildRegistry,
} from "../src/registry/resolve.ts";

/** An in-memory {@link StateHost}: a flat file map plus a lock set. */
class FakeStateHost implements StateHost {
  readonly files = new Map<string, string>();
  readonly locks = new Set<string>();

  readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }
  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }
  rename(from: string, to: string): Promise<void> {
    // A real rename rejects when the source is gone, and moves an exclusively
    // created (empty) file just as it moves one with content — the mutex relies
    // on both when it reclaims an abandoned marker.
    const content = this.files.get(from);
    if (content === undefined && !this.locks.has(from)) {
      return Promise.reject(new Deno.errors.NotFound(`rename ${from}`));
    }
    if (content !== undefined) {
      this.files.set(to, content);
      this.files.delete(from);
    }
    if (this.locks.delete(from)) this.locks.add(to);
    return Promise.resolve();
  }
  createExclusive(path: string): Promise<boolean> {
    if (this.locks.has(path)) return Promise.resolve(false);
    this.locks.add(path);
    return Promise.resolve(true);
  }
  remove(path: string): Promise<void> {
    this.files.delete(path);
    this.locks.delete(path);
    return Promise.resolve();
  }
  listDir(path: string): Promise<string[]> {
    const prefix = `${path}/`;
    const names: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
    }
    return Promise.resolve(names);
  }
  mkdirp(): Promise<void> {
    return Promise.resolve();
  }
  /** A controllable clock for the mutex-TTL tests; advance it with `time`. */
  time = 1_000_000;
  now(): number {
    return this.time;
  }
}

/** A minimal CLI surface for a descriptor. */
function sampleSurface(): CliDescription {
  return {
    commands: [{ name: "graph", description: "Show the dependency graph" }],
    flags: [{ name: "--list", description: "List all targets" }],
    targets: [
      {
        name: "build",
        description: "Compile",
        dependsOn: ["lint"],
        default: false,
        unlisted: false,
      },
    ],
    parameters: [
      {
        name: "environment",
        flag: "environment",
        description: "Deploy target",
        required: true,
        kind: "string",
        boolean: false,
        array: false,
        options: ["sit", "prod"],
      },
    ],
  };
}

/** A sample descriptor, with overridable fields. */
function sampleDescriptor(
  overrides: Partial<BuildDescriptor> = {},
): BuildDescriptor {
  return {
    id: "CI",
    name: "CI",
    location: { kind: "module", module: "file:///x/zuke.ts", cwd: "/x" },
    surface: sampleSurface(),
    actor: "me",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ------------------------------------------------------------- descriptor

Deno.test("stringify then parse round-trips a descriptor", () => {
  const descriptor = sampleDescriptor();
  assertEquals(
    parseBuildDescriptor(stringifyBuildDescriptor(descriptor)),
    descriptor,
  );
});

Deno.test("parseBuildDescriptor round-trips a command location with a repo", () => {
  const descriptor = sampleDescriptor({
    location: {
      kind: "command",
      command: ["deno", "run", "-A", "zuke.ts"],
      cwd: "/w",
      repo: "acme/app",
    },
  });
  assertEquals(
    parseBuildDescriptor(stringifyBuildDescriptor(descriptor)),
    descriptor,
  );
});

Deno.test("toBuildSummary projects the summary fields", () => {
  assertEquals(toBuildSummary(sampleDescriptor()), {
    id: "CI",
    name: "CI",
    actor: "me",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
});

Deno.test("parseBuildDescriptor rejects malformed descriptors", () => {
  assertThrows(() => parseBuildDescriptor("not json"), Error, "not valid JSON");
  assertThrows(() => parseBuildDescriptor("[]"), Error, "not an object");
  // Missing required field.
  const noId = JSON.stringify({ ...sampleDescriptor(), id: undefined });
  assertThrows(() => parseBuildDescriptor(noId), Error, '"id"');
  // Unknown location kind.
  const badKind = JSON.stringify({
    ...sampleDescriptor(),
    location: { kind: "carrier-pigeon", cwd: "/x" },
  });
  assertThrows(() => parseBuildDescriptor(badKind), Error, "location kind");
  // Surface is not an object.
  const badSurface = JSON.stringify({ ...sampleDescriptor(), surface: 7 });
  assertThrows(() => parseBuildDescriptor(badSurface), Error, '"surface"');
  // A surface target with a non-boolean flag.
  const badTarget = JSON.stringify({
    ...sampleDescriptor(),
    surface: {
      commands: [],
      flags: [],
      targets: [{
        name: "x",
        description: "",
        dependsOn: [],
        default: false,
        unlisted: "no",
      }],
      parameters: [],
    },
  });
  assertThrows(() => parseBuildDescriptor(badTarget), Error, "not a boolean");
});

/** Serialize the sample descriptor with malformed fields spliced in. */
function mangled(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...sampleDescriptor(), ...overrides });
}

Deno.test("parseBuildDescriptor validates surface and location shapes", () => {
  // A non-string field that is not `id`.
  assertThrows(
    () => parseBuildDescriptor(mangled({ name: 5 })),
    Error,
    "not a string",
  );
  // A location that is not an object, and one whose repo is the wrong type.
  assertThrows(
    () => parseBuildDescriptor(mangled({ location: 5 })),
    Error,
    "location",
  );
  assertThrows(
    () =>
      parseBuildDescriptor(
        mangled({
          location: { kind: "module", module: "m", cwd: "/c", repo: 5 },
        }),
      ),
    Error,
    "not a string",
  );
  // A surface whose collections are the wrong shape.
  const surface = (over: Record<string, unknown>) =>
    mangled({
      surface: {
        commands: [],
        flags: [],
        targets: [],
        parameters: [],
        ...over,
      },
    });
  assertThrows(
    () => parseBuildDescriptor(surface({ commands: 5 })),
    Error,
    "not an array",
  );
  assertThrows(
    () => parseBuildDescriptor(surface({ commands: [5] })),
    Error,
    "surface entry",
  );
  assertThrows(
    () => parseBuildDescriptor(surface({ targets: [5] })),
    Error,
    "surface target",
  );
  assertThrows(
    () =>
      parseBuildDescriptor(
        surface({
          targets: [{
            name: "x",
            description: "",
            dependsOn: "no",
            default: false,
            unlisted: false,
          }],
        }),
      ),
    Error,
    "not a string array",
  );
  assertThrows(
    () => parseBuildDescriptor(surface({ parameters: [5] })),
    Error,
    "surface parameter",
  );
});

Deno.test("parseParameterInfo carries kind/default and tolerates a legacy descriptor", () => {
  const withParams = (parameters: unknown[]) =>
    JSON.stringify({
      ...sampleDescriptor(),
      surface: { commands: [], flags: [], targets: [], parameters },
    });

  // A modern parameter round-trips name, kind, and default.
  const modern = parseBuildDescriptor(withParams([{
    name: "workers",
    flag: "workers",
    description: "n",
    required: false,
    kind: "number",
    boolean: false,
    array: false,
    options: [],
    default: "4",
  }])).surface.parameters[0];
  assertEquals(modern.name, "workers");
  assertEquals(modern.kind, "number");
  assertEquals(modern.default, "4");

  // A pre-M12 descriptor has no name/kind: derive kind from `boolean` and the
  // key from `flag`.
  const legacyBool = parseBuildDescriptor(withParams([{
    flag: "verbose",
    description: "",
    required: false,
    boolean: true,
    array: false,
    options: [],
  }])).surface.parameters[0];
  assertEquals(legacyBool.name, "verbose");
  assertEquals(legacyBool.kind, "boolean");
  assertEquals(legacyBool.default, undefined);

  const legacyString = parseBuildDescriptor(withParams([{
    flag: "env",
    description: "",
    required: false,
    boolean: false,
    array: false,
    options: [],
  }])).surface.parameters[0];
  assertEquals(legacyString.kind, "string");

  // An unrecognised kind is rejected.
  assertThrows(
    () =>
      parseBuildDescriptor(withParams([{
        name: "x",
        flag: "x",
        description: "",
        required: false,
        kind: "date",
        boolean: false,
        array: false,
        options: [],
      }])),
    Error,
    "valid kind",
  );
});

Deno.test("parseBuildDescriptor round-trips a module location with a repo", () => {
  const descriptor = sampleDescriptor({
    location: {
      kind: "module",
      module: "file:///x/zuke.ts",
      cwd: "/x",
      repo: "acme/app",
    },
  });
  assertEquals(
    parseBuildDescriptor(stringifyBuildDescriptor(descriptor)),
    descriptor,
  );
});

Deno.test("parseBuildSummary validates untrusted summaries", () => {
  assertThrows(() => parseBuildSummary(42), Error, "not an object");
  assertThrows(() => parseBuildSummary({ id: 1 }), Error, '"id"');
  assertEquals(parseBuildSummary(toBuildSummary(sampleDescriptor())).id, "CI");
});

// ----------------------------------------------------- filesystem backend

Deno.test("FileSystemBuildRegistry persists and reconstructs a descriptor", async () => {
  const host = new FakeStateHost();
  const registry = new FileSystemBuildRegistry("/builds", host);
  const created = await registry.register(sampleDescriptor(), null);
  if (!created.ok) throw new Error("expected create to succeed");
  const loaded = await registry.getBuild("CI");
  assertEquals(loaded?.descriptor.name, "CI");
  assertEquals(loaded?.version, created.version);
  assertEquals(await registry.getBuild("missing"), null);
});

Deno.test("FileSystemBuildRegistry CAS rejects a stale write", async () => {
  const host = new FakeStateHost();
  const registry = new FileSystemBuildRegistry("/builds", host);
  const created = await registry.register(sampleDescriptor(), null);
  if (!created.ok) throw new Error("expected create to succeed");
  // A second create at null (must-not-exist) now conflicts.
  assertEquals(await registry.register(sampleDescriptor(), null), {
    ok: false,
    conflict: true,
  });
  // A write at a stale version conflicts too.
  assertEquals(await registry.register(sampleDescriptor(), "stale"), {
    ok: false,
    conflict: true,
  });
  // A write at the current version succeeds.
  const ok = await registry.register(
    sampleDescriptor({ actor: "you" }),
    created.version,
  );
  assertEquals(ok.ok, true);
});

Deno.test("FileSystemBuildRegistry: concurrent registrations — exactly one wins", async () => {
  const host = new FakeStateHost();
  const registry = new FileSystemBuildRegistry("/builds", host);
  const created = await registry.register(sampleDescriptor(), null);
  if (!created.ok) throw new Error("expected create to succeed");
  const results = await Promise.all([
    registry.register(sampleDescriptor({ actor: "b" }), created.version),
    registry.register(sampleDescriptor({ actor: "c" }), created.version),
  ]);
  assertEquals(results.filter((r) => r.ok).length, 1);
  assertEquals(results.filter((r) => !r.ok).length, 1);
});

Deno.test("FileSystemBuildRegistry deregister removes a build", async () => {
  const host = new FakeStateHost();
  const registry = new FileSystemBuildRegistry("/builds", host);
  await registry.register(sampleDescriptor(), null);
  await registry.deregister("CI");
  assertEquals(await registry.getBuild("CI"), null);
  // Deregistering a missing build is a no-op.
  await registry.deregister("CI");
});

Deno.test("FileSystemBuildRegistry listBuilds filters, sorts, and skips junk", async () => {
  const host = new FakeStateHost();
  const registry = new FileSystemBuildRegistry("/builds", host);
  await registry.register(
    sampleDescriptor({
      id: "a",
      name: "a",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    null,
  );
  await registry.register(
    sampleDescriptor({
      id: "b",
      name: "b",
      createdAt: "2026-02-01T00:00:00.000Z",
    }),
    null,
  );
  // A corrupt file and a non-json marker must not break listing.
  host.files.set("/builds/corrupt.json", "{ not json");
  host.files.set("/builds/note.txt", "ignore me");

  const all = await registry.listBuilds({});
  assertEquals(all.map((s) => s.id), ["b", "a"]); // newest first

  const byName = await registry.listBuilds({ name: "a" });
  assertEquals(byName.map((s) => s.id), ["a"]);

  const since = await registry.listBuilds({
    since: "2026-01-15T00:00:00.000Z",
  });
  assertEquals(since.map((s) => s.id), ["b"]);
});

Deno.test("FileSystemBuildRegistry rejects an unsafe build id", async () => {
  const registry = new FileSystemBuildRegistry("/builds", new FakeStateHost());
  await assertRejects(
    () => registry.getBuild("../escape"),
    Error,
    "unsafe build id",
  );
  await assertRejects(
    () => registry.register(sampleDescriptor({ id: "../escape" }), null),
    Error,
    "unsafe build id",
  );
  await assertRejects(
    () => registry.deregister("a/b"),
    Error,
    "unsafe build id",
  );
});

Deno.test("FileSystemBuildRegistry listBuilds skips a vanished file", async () => {
  // A file listed by the directory but gone by the time it is read (deleted
  // between listing and reading) is skipped, not an error.
  class PhantomHost extends FakeStateHost {
    override listDir(): Promise<string[]> {
      return Promise.resolve(["ghost.json"]);
    }
  }
  const registry = new FileSystemBuildRegistry("/builds", new PhantomHost());
  assertEquals(await registry.listBuilds({}), []);
});

Deno.test("FileSystemBuildRegistry gives up on a permanently held mutex", async () => {
  const host = new FakeStateHost();
  // Pre-hold the lock marker so createExclusive never succeeds, stamped now so
  // it reads as a live holder that is never stolen from.
  const marker = "/builds/CI.json.lock";
  host.locks.add(marker);
  host.files.set(marker, String(host.time));
  const registry = new FileSystemBuildRegistry("/builds", host);
  await assertRejects(
    () => registry.register(sampleDescriptor(), null),
    Error,
    "could not acquire the mutex",
  );
  assertEquals(host.locks.has(marker), true); // never stolen from a live holder
});

Deno.test("FileSystemBuildRegistry takes over a mutex marker left past its TTL", async () => {
  // A `zuke register` killed mid-write leaves its marker behind. Without an
  // expiry that marker wedges every later writer until a human deletes it, so
  // the registry shares the state store's mutex: past the TTL it is reclaimed.
  const host = new FakeStateHost();
  const marker = "/builds/CI.json.lock";
  host.locks.add(marker);
  host.files.set(marker, String(host.time)); // stamped when it was acquired
  host.time += 60_000; // …and never released

  const registry = new FileSystemBuildRegistry("/builds", host);
  const result = await registry.register(sampleDescriptor(), null);
  assertEquals(result.ok, true);
  assertEquals(host.locks.has(marker), false); // released again after the write
  assertEquals(host.files.has("/builds/CI.json"), true);
});

Deno.test("FileSystemBuildRegistry reclaims an unstamped mutex marker", async () => {
  // A marker left by an older zuke that never stamped its markers carries no age
  // to compare; once a waiter has spun far longer than the create→stamp window it
  // reclaims it rather than wedging the directory for good.
  const host = new FakeStateHost();
  const marker = "/builds/CI.json.lock";
  host.locks.add(marker);
  const registry = new FileSystemBuildRegistry("/builds", host);
  assertEquals((await registry.register(sampleDescriptor(), null)).ok, true);
  assertEquals(host.locks.has(marker), false);
});

Deno.test("FileSystemBuildRegistry round-trips through the real filesystem", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry = new FileSystemBuildRegistry(
      `${dir}/builds`,
      defaultStateHost,
    );
    const created = await registry.register(sampleDescriptor(), null);
    if (!created.ok) throw new Error("expected create to succeed");
    const loaded = await registry.getBuild("CI");
    assertEquals(loaded?.descriptor.surface.targets[0].name, "build");
    assertEquals((await registry.listBuilds({})).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --------------------------------------------------------------- resolve

Deno.test("resolveBuildRegistry follows its precedence", () => {
  const host = new FakeStateHost();
  const explicit = new FileSystemBuildRegistry("/explicit", host);
  const declared = new FileSystemBuildRegistry("/declared", host);
  const opts = {
    readEnv: () => undefined,
    host,
    defaultDir: "/default",
    enableDefault: false,
  };

  // `false` disables entirely.
  assertEquals(resolveBuildRegistry(false, declared, opts), undefined);
  // An explicit option wins.
  assertEquals(resolveBuildRegistry(explicit, declared, opts), explicit);
  // Then a declared (build.registry()) override.
  assertEquals(resolveBuildRegistry(undefined, declared, opts), declared);
  // Then nothing, unless enableDefault.
  assertEquals(resolveBuildRegistry(undefined, undefined, opts), undefined);
  const defaulted = resolveBuildRegistry(undefined, undefined, {
    ...opts,
    enableDefault: true,
  });
  assertEquals(defaulted instanceof FileSystemBuildRegistry, true);
});

Deno.test("resolveBuildRegistry reads the environment when nothing is declared", () => {
  const host = new FakeStateHost();
  const env = new Map<string, string>([["ZUKE_REGISTRY_DIR", "/env-builds"]]);
  const fromDir = resolveBuildRegistry(undefined, undefined, {
    readEnv: (name) => env.get(name),
    host,
    defaultDir: "/default",
    enableDefault: false,
  });
  assertEquals(fromDir instanceof FileSystemBuildRegistry, true);
});

Deno.test("envBuildRegistry prefers URL over DIR", () => {
  const host = new FakeStateHost();
  const env = new Map<string, string>([
    ["ZUKE_REGISTRY_URL", "https://registry.example"],
    ["ZUKE_REGISTRY_TOKEN", "t"],
    ["ZUKE_REGISTRY_DIR", "/ignored"],
  ]);
  const http = envBuildRegistry((name) => env.get(name), host);
  assertEquals(http instanceof HttpBuildRegistry, true);

  const dirOnly = new Map<string, string>([["ZUKE_REGISTRY_DIR", "/only"]]);
  assertEquals(
    envBuildRegistry((name) => dirOnly.get(name), host) instanceof
      FileSystemBuildRegistry,
    true,
  );

  assertEquals(envBuildRegistry(() => undefined, host), undefined);
});
