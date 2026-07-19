/**
 * The `zuke register` command: write (or refresh) this build's
 * {@link BuildDescriptor} into a {@link BuildRegistry}, so an MCP host driven by
 * the registry can discover the pipeline without a redeploy (see M11 / PR2).
 *
 * The descriptor is derived entirely from static metadata —
 * {@link "../describe.ts".describeCli} for the surface, the running module for
 * the location — so it carries no parameter values and no secrets, exactly like
 * a run record. Registration is idempotent: it re-reads the current descriptor
 * and compare-and-swaps, retrying on a conflict, so concurrent registrations
 * converge instead of corrupting the record.
 *
 * @module
 */

import type { Build } from "../build.ts";
import { describeCli } from "../describe.ts";
import { absolutePath } from "../path.ts";
import { findConfigDir, pathExists } from "../config.ts";
import { defaultStateHost } from "../state/store.ts";
import { resolveActor } from "../state/record.ts";
import type { BuildDescriptor, BuildLocation } from "./descriptor.ts";
import type { BuildRegistry } from "./registry.ts";
import { resolveBuildRegistry } from "./resolve.ts";

/** How many times a conflicting registration CAS is re-read and retried. */
const MAX_RETRIES = 10;

/** Read an environment variable, treating missing env access as unset. */
function defaultReadEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Inputs for {@link registerCommand}. */
export interface RegisterOptions {
  /** The build id to register under; defaults to the build class name. */
  id?: string;
  /** Who to attribute the registration to (else `ZUKE_ACTOR`, CI, `anonymous`). */
  actor?: string;
  /** Emit the written descriptor as JSON instead of a human confirmation. */
  json?: boolean;
  /**
   * Registry override, resolved like a run store (explicit → `registry()` → env
   * → `.zuke/builds`); `false` disables the registry. Tests inject one here.
   */
  registry?: BuildRegistry | false;
  /** Reads an environment variable (injectable for tests). */
  readEnv?: (name: string) => string | undefined;
  /** The build's launch location; derived from the running module when absent. */
  location?: BuildLocation;
  /** Clock for `createdAt`/`updatedAt` (injectable for tests). */
  now?: () => string;
}

/** Resolve the registry for a `register` — like a run store, but always defaulting on. */
function resolveRegisterRegistry(
  option: BuildRegistry | false | undefined,
  build: Build,
  readEnv: (name: string) => string | undefined,
): BuildRegistry | undefined {
  return resolveBuildRegistry(option, build.registry(), {
    readEnv,
    host: defaultStateHost,
    defaultDir: absolutePath(
      findConfigDir(Deno.cwd(), pathExists) ?? Deno.cwd(),
    )(".zuke", "builds").path,
    enableDefault: true,
  });
}

/**
 * Strip embedded credentials from a module URL before it is persisted — a build
 * launched from a remote entrypoint like `https://user:token@host/build.ts`
 * carries basic-auth userinfo in {@link Deno.mainModule} that must not land in
 * the descriptor. A plain filesystem path (not a URL) is returned unchanged, and
 * Deno's remote auth uses `DENO_AUTH_TOKENS`, so stripping userinfo does not
 * break a runner relaunch.
 */
export function redactModuleUrl(module: string): string {
  try {
    const url = new URL(module);
    if (url.username === "" && url.password === "") return module;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return module; // a bare filesystem path is not a URL — leave it as-is
  }
}

/** Derive the launch location from the running module, cwd, and CI repo slug. */
function deriveLocation(
  readEnv: (name: string) => string | undefined,
): BuildLocation {
  const repo = readEnv("GITHUB_REPOSITORY");
  const location: BuildLocation = {
    kind: "module",
    module: redactModuleUrl(Deno.mainModule),
    cwd: Deno.cwd(),
  };
  if (repo !== undefined && repo !== "") location.repo = repo;
  return location;
}

/**
 * Write `descriptor` fields into `registry`, preserving the original
 * `createdAt` on an update, and compare-and-swapping so two concurrent
 * registrations converge on one record. Retries on conflict.
 *
 * @throws if the write cannot land after {@link MAX_RETRIES} conflicts.
 */
async function writeDescriptor(
  registry: BuildRegistry,
  fields: Omit<BuildDescriptor, "createdAt" | "updatedAt">,
  now: () => string,
): Promise<BuildDescriptor> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const current = await registry.getBuild(fields.id);
    const descriptor: BuildDescriptor = {
      ...fields,
      createdAt: current?.descriptor.createdAt ?? now(),
      updatedAt: now(),
    };
    const result = await registry.register(
      descriptor,
      current?.version ?? null,
    );
    if (result.ok) return descriptor;
  }
  throw new Error(
    `register: gave up registering "${fields.id}" after repeated conflicts.`,
  );
}

/**
 * Run `zuke register`: build this build's descriptor and write it to the
 * resolved registry — an idempotent, retrying compare-and-swap — printing a
 * confirmation (or the JSON descriptor) and resolving to a process exit code
 * (0 success, 1 when no registry is configured).
 *
 * @throws if the registry write fails (a store outage); the caller reports it.
 */
export async function registerCommand(
  build: Build,
  options: RegisterOptions = {},
): Promise<number> {
  const readEnv = options.readEnv ?? defaultReadEnv;
  const registry = resolveRegisterRegistry(options.registry, build, readEnv);
  if (registry === undefined) {
    console.error(
      "register: no build registry is configured. Set ZUKE_REGISTRY_DIR / " +
        "ZUKE_REGISTRY_URL, or override registry() on the build.",
    );
    return 1;
  }

  const now = options.now ?? (() => new Date().toISOString());
  const descriptor = await writeDescriptor(registry, {
    id: options.id ?? build.constructor.name,
    name: build.constructor.name,
    location: options.location ?? deriveLocation(readEnv),
    // Omit secret parameters: a registered pipeline's secrets must never become
    // a spawnable MCP input or cross the spawn boundary — the child resolves
    // them from its own environment / `.from()` source instead.
    surface: describeCli(build, { omitSecrets: true }),
    actor: resolveActor(options.actor, readEnv),
  }, now);

  if (options.json) {
    console.log(JSON.stringify(descriptor, null, 2));
  } else {
    console.log(
      `Registered build "${descriptor.id}" ` +
        `(${descriptor.surface.targets.length} target(s)) to the registry.`,
    );
  }
  return 0;
}
