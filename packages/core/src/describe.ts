/**
 * A machine-readable description of a build's CLI surface — its reserved
 * commands, option flags, targets, and parameters — for tooling and agents.
 * This backs `zuke --list --json`, and {@link describeCli} is exported so a
 * caller can introspect a build programmatically without parsing help text.
 *
 * @module
 */

import { type Build, discoverTargets } from "./build.ts";
import { type AnyParameter, discoverParameters, flagName } from "./params.ts";
import type { TargetBuilder } from "./target.ts";
import {
  BUILTIN_FLAGS,
  DEFAULT_TARGET,
  RESERVED_COMMANDS,
} from "./cli_spec.ts";

/** A reserved command (`graph`, `generate-ci`, `completions`). */
export interface CliCommandInfo {
  /** The command word. */
  readonly name: string;
  /** One-line summary. */
  readonly description: string;
}

/** A built-in option flag. */
export interface CliFlagInfo {
  /** The flag, with leading dashes. */
  readonly name: string;
  /** One-line summary. */
  readonly description: string;
}

/** A target declared on the build. */
export interface CliTargetInfo {
  /** The target's name (its field name on the build). */
  readonly name: string;
  /** The target's description, or `""` when none was set. */
  readonly description: string;
  /** The names of its direct dependencies, in declaration order. */
  readonly dependsOn: string[];
  /** Whether this is the conventional `default` target. */
  readonly default: boolean;
  /** Whether the target is hidden from `--list` (still runnable by name). */
  readonly unlisted: boolean;
}

/** A parameter declared on the build. */
export interface CliParameterInfo {
  /** The CLI flag (without leading dashes), e.g. `environment`. */
  readonly flag: string;
  /** The parameter's description, or `""` when none was set. */
  readonly description: string;
  /** Whether a value is required. */
  readonly required: boolean;
  /** Whether the flag is a value-less boolean. */
  readonly boolean: boolean;
  /** Whether repeated flags accumulate into a list. */
  readonly array: boolean;
  /** The allowed values, when the parameter is constrained to a set. */
  readonly options: string[];
}

/** A build's full CLI surface, suitable for JSON serialization. */
export interface CliDescription {
  /** The reserved positional commands. */
  readonly commands: CliCommandInfo[];
  /** The built-in option flags. */
  readonly flags: CliFlagInfo[];
  /** The build's targets, in declaration order. */
  readonly targets: CliTargetInfo[];
  /** The build's declared parameters, in declaration order. */
  readonly parameters: CliParameterInfo[];
}

/** Describe one target. */
function targetInfo(name: string, t: TargetBuilder): CliTargetInfo {
  return {
    name,
    description: t.description_ ?? "",
    dependsOn: t.dependsOn_.map((d) => d.name_ ?? "?"),
    default: name === DEFAULT_TARGET,
    unlisted: t.unlisted_,
  };
}

/** Describe one parameter. */
function parameterInfo(name: string, p: AnyParameter): CliParameterInfo {
  return {
    flag: flagName(name),
    description: p.description_ ?? "",
    required: p.required_,
    boolean: p.kind_ === "boolean",
    array: p.array_,
    // A secret parameter's declared option values could themselves be sensitive
    // (e.g. `.secret().options(...)` listing real keys), so they are never
    // surfaced — matching how a run record omits secret values entirely.
    options: p.secret_ ? [] : [...(p.options_ ?? [])],
  };
}

/**
 * Build a {@link CliDescription} from already-discovered targets and parameters.
 * Used by the CLI's `--json` output, which has the maps in hand.
 */
export function describeBuildSurface(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
): CliDescription {
  return {
    commands: RESERVED_COMMANDS.map((c) => ({
      name: c.name,
      description: c.description,
    })),
    flags: BUILTIN_FLAGS.map((f) => ({
      name: f.name,
      description: f.description,
    })),
    targets: [...targets].map(([name, t]) => targetInfo(name, t)),
    parameters: [...params].map(([name, p]) => parameterInfo(name, p)),
  };
}

/**
 * Describe a build's full CLI surface — reserved commands, option flags, targets
 * (with descriptions and dependencies), and declared parameters — as a plain
 * object ready for JSON. This is the same data `zuke --list --json` prints, made
 * available to tooling and agents that introspect a build in code.
 *
 * ```ts
 * import { describeCli } from "jsr:@zuke/core";
 * const surface = describeCli(new MyBuild());
 * console.log(surface.targets.map((t) => t.name));
 * ```
 */
export function describeCli(build: Build): CliDescription {
  return describeBuildSurface(
    discoverTargets(build),
    discoverParameters(build),
  );
}
