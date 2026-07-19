/**
 * The build-registry vocabulary: a {@link BuildDescriptor} — a small, versioned
 * record describing one pipeline (build) that has registered itself — and its
 * parts.
 *
 * A descriptor says **which** build exists, **where** it lives (so a runner can
 * launch it), and **what** its CLI surface is (the same {@link CliDescription}
 * `describeCli(build)` produces, so an MCP host can expose its targets as tools
 * without loading the build). It carries no parameter *values* and no run data —
 * only static structural metadata — so, like a run record, it excludes secrets
 * by construction.
 *
 * The record's shape is validated on read (a registry's HTTP backend reads
 * descriptors from a service Zuke does not control), mirroring
 * {@link "../state/types.ts".parseRunRecord}.
 *
 * @module
 */

import type {
  CliCommandInfo,
  CliDescription,
  CliFlagInfo,
  CliParameterInfo,
  CliTargetInfo,
} from "../describe.ts";

/**
 * Where a registered build lives, so a runner can launch it. Two forms: a
 * `module` (the entry file `deno run` executes — the form `zuke register`
 * writes) or an explicit `command` (a launch argv, for a build fronted by a
 * wrapper script). Both carry the working directory and, in CI, the repository.
 */
export type BuildLocation =
  | {
    /** A build launched by running its entry module. */
    kind: "module";
    /** The entry module `deno run` executes (a `file:`/`https:` URL or path). */
    module: string;
    /** The working directory the build expects to run in. */
    cwd: string;
    /** The `owner/name` repository slug, when known (from `GITHUB_REPOSITORY`). */
    repo?: string;
  }
  | {
    /** A build launched by an explicit command (e.g. a wrapper script). */
    kind: "command";
    /** The launch argv, already tokenised (never a shell string). */
    command: string[];
    /** The working directory the command runs in. */
    cwd: string;
    /** The `owner/name` repository slug, when known. */
    repo?: string;
  };

/**
 * A versioned snapshot of one registered build. Persisted as JSON; a registry's
 * opaque `version` (an ETag / content hash) drives compare-and-swap writes so
 * two registrations racing at the same version cannot both win.
 */
export interface BuildDescriptor {
  /** Stable id of the build (its class name, unless overridden). */
  id: string;
  /** Human-facing build name (the build class name). */
  name: string;
  /** Where the build lives, so a runner can launch it. */
  location: BuildLocation;
  /** The build's CLI surface, exactly as {@link "../describe.ts".describeCli} produces it. */
  surface: CliDescription;
  /** Who registered the build (a resolved actor; secrets never appear here). */
  actor: string;
  /** ISO-8601 timestamp when the build was first registered. */
  createdAt: string;
  /** ISO-8601 timestamp of the last registration write. */
  updatedAt: string;
}

/** A compact registry listing row, returned by {@link "./registry.ts".BuildRegistry.listBuilds}. */
export interface BuildSummary {
  /** The build id. */
  id: string;
  /** The build name. */
  name: string;
  /** Who last registered the build. */
  actor: string;
  /** ISO-8601 first-registration timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the last registration write. */
  updatedAt: string;
}

/** Filters for {@link "./registry.ts".BuildRegistry.listBuilds}; all fields optional. */
export interface BuildQuery {
  /** Keep only builds whose `name` equals this. */
  name?: string;
  /** Keep only builds registered at or after this ISO-8601 timestamp. */
  since?: string;
}

/** The projection of a {@link BuildDescriptor} down to its {@link BuildSummary}. */
export function toBuildSummary(descriptor: BuildDescriptor): BuildSummary {
  return {
    id: descriptor.id,
    name: descriptor.name,
    actor: descriptor.actor,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
  };
}

/** Serialise a descriptor to the canonical stored form (pretty JSON + newline). */
export function stringifyBuildDescriptor(descriptor: BuildDescriptor): string {
  return `${JSON.stringify(descriptor, null, 2)}\n`;
}

// --- Hardened parsing (untrusted JSON in, no casts) --------------------------

/** Narrow an unknown value to a plain object without casting, else `null`. */
function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

/** Read a required string field, throwing a descriptive error if it is not one. */
function str(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string") {
    throw new Error(`registry: descriptor field "${field}" is not a string`);
  }
  return value;
}

/** Read an optional string field, throwing if present but not a string. */
function optionalStr(
  object: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`registry: descriptor field "${field}" is not a string`);
  }
  return value;
}

/** Read a required boolean field, throwing if it is not one. */
function bool(object: Record<string, unknown>, field: string): boolean {
  const value = object[field];
  if (typeof value !== "boolean") {
    throw new Error(`registry: descriptor field "${field}" is not a boolean`);
  }
  return value;
}

/** Read a required array-of-strings field, throwing if it is not one. */
function strArray(object: Record<string, unknown>, field: string): string[] {
  const value = object[field];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(
      `registry: descriptor field "${field}" is not a string array`,
    );
  }
  return value.filter((v): v is string => typeof v === "string");
}

/** Read a required array field and map each element through `parse`. */
function arrayOf<T>(
  object: Record<string, unknown>,
  field: string,
  parse: (value: unknown) => T,
): T[] {
  const value = object[field];
  if (!Array.isArray(value)) {
    throw new Error(`registry: descriptor field "${field}" is not an array`);
  }
  return value.map(parse);
}

/** Validate one `{ name, description }` entry (a command or a flag). */
function parseNamed(value: unknown): CliCommandInfo & CliFlagInfo {
  const object = asObject(value);
  if (object === null) {
    throw new Error("registry: surface entry is not an object");
  }
  return { name: str(object, "name"), description: str(object, "description") };
}

/** Validate one {@link CliTargetInfo}. */
function parseTargetInfo(value: unknown): CliTargetInfo {
  const object = asObject(value);
  if (object === null) {
    throw new Error("registry: surface target is not an object");
  }
  return {
    name: str(object, "name"),
    description: str(object, "description"),
    dependsOn: strArray(object, "dependsOn"),
    default: bool(object, "default"),
    unlisted: bool(object, "unlisted"),
  };
}

/** Validate one {@link CliParameterInfo}. */
function parseParameterInfo(value: unknown): CliParameterInfo {
  const object = asObject(value);
  if (object === null) {
    throw new Error("registry: surface parameter is not an object");
  }
  return {
    flag: str(object, "flag"),
    description: str(object, "description"),
    required: bool(object, "required"),
    boolean: bool(object, "boolean"),
    array: bool(object, "array"),
    options: strArray(object, "options"),
  };
}

/** Validate and narrow a {@link CliDescription} (the build surface). */
function parseCliDescription(value: unknown): CliDescription {
  const object = asObject(value);
  if (object === null) {
    throw new Error('registry: descriptor field "surface" is not an object');
  }
  return {
    commands: arrayOf(object, "commands", parseNamed),
    flags: arrayOf(object, "flags", parseNamed),
    targets: arrayOf(object, "targets", parseTargetInfo),
    parameters: arrayOf(object, "parameters", parseParameterInfo),
  };
}

/** Validate and narrow a {@link BuildLocation}. */
function parseBuildLocation(value: unknown): BuildLocation {
  const object = asObject(value);
  if (object === null) {
    throw new Error('registry: descriptor field "location" is not an object');
  }
  const cwd = str(object, "cwd");
  const repo = optionalStr(object, "repo");
  if (object.kind === "command") {
    const command = strArray(object, "command");
    return repo === undefined
      ? { kind: "command", command, cwd }
      : { kind: "command", command, cwd, repo };
  }
  if (object.kind === "module") {
    const module = str(object, "module");
    return repo === undefined
      ? { kind: "module", module, cwd }
      : { kind: "module", module, cwd, repo };
  }
  throw new Error(
    `registry: unknown location kind "${String(object.kind)}"`,
  );
}

/**
 * Parse and validate a stored {@link BuildDescriptor}. Throws a descriptive
 * error when the text is not JSON or does not match the shape — the HTTP backend
 * reads descriptors from a service Zuke does not control, so the shape is checked
 * rather than trusted (mirroring {@link "../state/types.ts".parseRunRecord}).
 */
export function parseBuildDescriptor(text: string): BuildDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("registry: descriptor is not valid JSON");
  }
  const object = asObject(parsed);
  if (object === null) throw new Error("registry: descriptor is not an object");
  return {
    id: str(object, "id"),
    name: str(object, "name"),
    location: parseBuildLocation(object.location),
    surface: parseCliDescription(object.surface),
    actor: str(object, "actor"),
    createdAt: str(object, "createdAt"),
    updatedAt: str(object, "updatedAt"),
  };
}

/**
 * Parse and validate a {@link BuildSummary} from an untrusted value (an element
 * of the HTTP list response). Throws when a field is missing or the wrong type.
 */
export function parseBuildSummary(value: unknown): BuildSummary {
  const object = asObject(value);
  if (object === null) {
    throw new Error("registry: build summary is not an object");
  }
  return {
    id: str(object, "id"),
    name: str(object, "name"),
    actor: str(object, "actor"),
    createdAt: str(object, "createdAt"),
    updatedAt: str(object, "updatedAt"),
  };
}
