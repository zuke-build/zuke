// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

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
import { BUILTIN_FLAG_NAMES, VALID_FLAG_NAME } from "../cli_spec.ts";
import { asObject, fields } from "../json_shape.ts";

/** The field readers for a build descriptor's fields. */
const { optionalStr, str, strArray } = fields("registry: descriptor field");

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

/** Read a required boolean field, throwing if it is not one. */
function bool(object: Record<string, unknown>, field: string): boolean {
  const value = object[field];
  if (typeof value !== "boolean") {
    throw new Error(`registry: descriptor field "${field}" is not a boolean`);
  }
  return value;
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

/**
 * Read the parameter `kind`, tolerating a pre-M12 descriptor that has no `kind`
 * field by deriving it from the `boolean` flag (older descriptors only
 * distinguished boolean from string).
 */
function paramKind(
  object: Record<string, unknown>,
  boolean: boolean,
): "string" | "number" | "boolean" {
  const value = object.kind;
  if (value === undefined) return boolean ? "boolean" : "string";
  if (value === "string" || value === "number" || value === "boolean") {
    return value;
  }
  throw new Error(`registry: descriptor field "kind" is not a valid kind`);
}

/**
 * Refuse a descriptor whose parameters collide — on their flag, or on their
 * name.
 *
 * With the derived-flag rule gone, this is what stops one parameter shadowing
 * another, and it has to cover both keys because the two are read by different
 * consumers. The MCP registry server advertises a parameter by **name** and
 * spawns it by **flag**, keying each through a last-wins map, so either
 * duplicate hides a value from the caller who supplied it: two parameters
 * named `env` with different flags advertise one `env` property and put the
 * value on whichever flag came last, while two claiming `--env` land it on
 * whichever the child's parser matched first.
 *
 * The removed rule enforced name uniqueness as a side effect — two entries
 * with one name derived one flag — so dropping it needed both halves back, not
 * just the flag half.
 */
function assertDistinctParameters(
  parameters: CliParameterInfo[],
): CliParameterInfo[] {
  const byFlag = new Map<string, string>();
  const names = new Set<string>();
  for (const parameter of parameters) {
    if (names.has(parameter.name)) {
      throw new Error(
        `registry: descriptor declares two parameters named ` +
          `"${parameter.name}". A caller can only supply one of them, and ` +
          `the value would reach whichever the registry read last, so the ` +
          `descriptor is refused.`,
      );
    }
    names.add(parameter.name);
    const claimed = byFlag.get(parameter.flag);
    if (claimed !== undefined) {
      throw new Error(
        `registry: descriptor parameters "${claimed}" and ` +
          `"${parameter.name}" both claim the flag "--${parameter.flag}". A ` +
          `spawned run would apply the caller's value to whichever the ` +
          `child's parser matched first, so the descriptor is refused.`,
      );
    }
    byFlag.set(parameter.flag, parameter.name);
  }
  return parameters;
}

/**
 * Validate one {@link CliParameterInfo}.
 *
 * A descriptor's `flag` is not taken on trust. The registry MCP server renders
 * it straight onto the spawned child's argv, and the child's parser matches a
 * built-in flag ahead of a declared parameter — so a descriptor naming a
 * built-in would put the caller's value on that flag instead. With `--actor`
 * that overrides the `ZUKE_ACTOR` the runner exported for the resolved caller,
 * and the run is recorded under an actor the descriptor chose. A registry's
 * backend is a service Zuke does not control, so that shape is refused here,
 * at the parse boundary every backend goes through.
 *
 * A flag that merely *differs* from what its `name` would derive is not
 * refused. A build may declare its own spelling with
 * {@link "../params.ts".Parameter.flag}, and the descriptor has to carry it or
 * a spawned run could not set that parameter at all. What stands in its place
 * is {@link assertDistinctParameters}, which stops one parameter shadowing another.
 */
function parseParameterInfo(value: unknown): CliParameterInfo {
  const object = asObject(value);
  if (object === null) {
    throw new Error("registry: surface parameter is not an object");
  }
  const flag = str(object, "flag");
  const boolean = bool(object, "boolean");
  // Pre-M12 descriptors carry no `name`; the flag is the best available key.
  const name = optionalStr(object, "name") ?? flag;
  // Shape before membership, because membership alone is not a check. The
  // child's parser splits `--flag=value` at the first `=` and matches the
  // prefix, so a descriptor flag of `actor=mallory` is absent from the
  // built-in list yet arrives as `--actor` — landing the caller's value on the
  // built-in and recording the run under an actor the descriptor chose. The
  // build side refuses the same shapes when a flag is declared; this is the
  // same rule at the boundary where the flag comes from a service instead.
  if (!VALID_FLAG_NAME.test(flag)) {
    throw new Error(
      `registry: descriptor parameter "${name}" declares the flag ` +
        `"--${flag}", which is not a valid flag name. A flag that the ` +
        `child's parser would read as something other than it says — one ` +
        `containing "=", a space or a leading dash — is refused.`,
    );
  }
  if (BUILTIN_FLAG_NAMES.includes(flag)) {
    throw new Error(
      `registry: descriptor parameter "${name}" renders as "--${flag}", ` +
        `which is a built-in Zuke CLI flag. A spawned run would apply the ` +
        `value to the built-in instead of to the parameter, so the ` +
        `descriptor is refused.`,
    );
  }
  const info: CliParameterInfo = {
    name,
    flag,
    description: str(object, "description"),
    required: bool(object, "required"),
    kind: paramKind(object, boolean),
    boolean,
    array: bool(object, "array"),
    options: strArray(object, "options"),
  };
  const def = optionalStr(object, "default");
  return def !== undefined ? { ...info, default: def } : info;
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
    parameters: assertDistinctParameters(
      arrayOf(object, "parameters", parseParameterInfo),
    ),
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
