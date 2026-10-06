// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Which Compose project a canary rollout reaches: the global flags the
 * `d.compose(...)` lambda gives every command (`-f`, `-p`, `--profile`,
 * `--project-directory`, `--env-file`), resolved once per call, checked
 * against the ones `stage` recorded, and applied to each command only as
 * exactly those flags.
 *
 * Internal to the package: not exported from `mod.ts`. The services a
 * rollout acts on come from its record, but those names mean something only
 * inside a project — a resumed or cancelling process whose lambda names
 * another project would otherwise move the same-named services there.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { CALLER, type Rollout } from "./canary_plan.ts";
import { DockerComposeSettings } from "./settings.ts";

/**
 * The subcommand a {@link TrailingArgsProbe} renders: anything the global
 * lambda appends lands after it. Unique to this process, so no token the
 * lambda appends — `.args("<subcommand>")` included — can pass for it.
 */
const PROBE_TAIL = `<subcommand-${crypto.randomUUID()}>`;

/**
 * The token the Compose v2 plugin form renders before the global flags
 * (`docker compose -p shop …`). Every global flag begins with `-`, so it is
 * never mistaken for one.
 */
const PLUGIN_SUBCOMMAND = "compose";

/**
 * A command with only {@link PROBE_TAIL} for a subcommand, which the global
 * lambda is applied to so trailing `.args(...)` — which would follow the
 * service operand of every real command — can be told from global flags.
 */
class TrailingArgsProbe extends DockerComposeSettings {
  /** The placeholder subcommand. */
  protected override composeArgs(): string[] {
    return [PROBE_TAIL];
  }
}

/**
 * How many tokens a command's argv starts with before its subcommand when no
 * lambda has touched it — the binary and the plugin's `compose`.
 */
const BARE_PREFIX = new TrailingArgsProbe().argv().indexOf(PROBE_TAIL);

/**
 * The global flags `configure` gives a command — none without a lambda — or a
 * refusal when it appends trailing arguments. Only argv: what the lambda
 * passes with `.env(...)` may be a secret, and is neither read nor recorded.
 */
export function composeScope(
  configure: Configure<DockerComposeSettings> | undefined,
): string[] {
  if (configure === undefined) return [];
  const probe = configure(new TrailingArgsProbe()).argv();
  if (probe.at(-1) !== PROBE_TAIL) {
    throw new Error(
      `${CALLER}: d.compose(...) adds trailing arguments ` +
        `(${probe.slice(probe.indexOf(PROBE_TAIL) + 1).join(" ")}), which ` +
        "would follow the service every command names. Use the typed " +
        "global flags instead.",
    );
  }
  return globalFlags(probe.slice(0, -1));
}

/**
 * Apply `configure` to `command` and refuse, before it runs, unless the
 * command it leaves is the binary, the global flags `scope` and the
 * command's own subcommand and operands — nothing else. The lambda runs once
 * per command, so one that resolves differently between two runs of itself
 * (it reads a clock, or changes what it closes over) is caught here rather
 * than sending one command to another project.
 */
export function applyScope(
  configure: Configure<DockerComposeSettings> | undefined,
  scope: readonly string[],
  command: DockerComposeSettings,
): void {
  if (configure === undefined) return;
  const own = command.argv().slice(BARE_PREFIX);
  configure(command);
  const argv = command.argv();
  const head = argv.slice(0, argv.length - own.length);
  const flags = globalFlags(head);
  if (
    !sameArgv(argv.slice(head.length), own) || !sameArgv(flags, scope)
  ) {
    throw new Error(
      `${CALLER}: d.compose(...) gave this command ` +
        `${shown(argv.slice(1))} where this call resolved the global flags ` +
        `${shown(scope)}, so it does not run: the lambda must give the same ` +
        "flags every time it runs. Make it depend only on the build's " +
        "resolved parameters.",
    );
  }
}

/**
 * Refuse unless `now` — the global flags the lambda gives in this process —
 * are the ones the rollout recorded. Compared as written, in order: two
 * spellings of one project are refused too, since telling them apart would
 * mean resolving the project the way Compose does.
 */
export function checkScope(rollout: Rollout, now: readonly string[]): void {
  if (sameArgv(rollout.scope, now)) return;
  throw new Error(
    `${CALLER}: this rollout started on the Compose project selected by ` +
      `${shown(rollout.scope)}, but d.compose(...) now gives ` +
      `${shown(now)}, so this call changed nothing rather than move ` +
      `${rollout.stable} and ${rollout.canary} in a project the rollout ` +
      "never staged — the global flags are compared as written, in order. " +
      recovery(rollout),
  );
}

/**
 * Refuse unless `reported` — the project of each running container of the
 * two services, as `ps --format {{.Project}}` prints it with the recorded
 * flags — is exactly the project `stage` saw. Compose lists only the
 * containers of the project it resolves now, from the flags but also from
 * `COMPOSE_PROJECT_NAME`, a `.env` or `--env-file` and the working
 * directory, so this catches what the flags alone cannot. A live rollout
 * always runs some of them, since the total never dips, so none is refused
 * as well.
 */
export function checkProject(
  rollout: Rollout,
  reported: readonly string[],
): void {
  const projects = [...new Set(reported)];
  if (projects.length === 1 && projects[0] === rollout.projectName) return;
  const services = `${rollout.stable} and ${rollout.canary}`;
  const found = projects.length === 0
    ? `Compose now reports no running container of ${services} in the ` +
      "project it resolves — a live rollout always runs some, since the " +
      "total never dips —"
    : `with the same global flags Compose now reports ${services} in ` +
      `${projects.join(", ")}, so`;
  throw new Error(
    `${CALLER}: this rollout started in the Compose project ` +
      `${rollout.projectName}, but ${found} this call changed nothing ` +
      "rather than act on a project the rollout never staged. The project " +
      "Compose resolves can change without the flags: COMPOSE_PROJECT_NAME " +
      "or COMPOSE_FILE in the environment, a .env or --env-file that sets " +
      "them, the working directory, or a Docker context or DOCKER_HOST that " +
      `reaches another daemon. ${recovery(rollout)}`,
  );
}

/**
 * How to recover from a refusal that leaves the run cancelled: the one
 * course that works once the engine has settled it, with the stable image
 * ID the rollout recorded.
 */
function recovery(rollout: Rollout): string {
  return "The run is left cancelled with the rollout's services as they " +
    "are, so a resume or `zuke cancel` will not roll it back. To recover, " +
    "set the configuration and environment back to what the rollout " +
    "started with, check with `docker compose ps` that it reaches the " +
    "project that was staged (a rollback run by hand has no record to " +
    "check it against), then run the rollout's <field>.abort target by " +
    "hand (for example `zuke rollout.abort`) with " +
    `d.stable('${rollout.restore}') — the stable image ID the rollout ` +
    "recorded, which a tag that moved cannot change — or " +
    `d.stable('${rollout.stableImage}') if that tag still resolves to it.`;
}

/**
 * The global flags in `head` — a command's argv up to its subcommand — with
 * the binary and the plugin form's `compose` left out: they choose how
 * Compose is invoked, not which project it reaches.
 */
function globalFlags(head: readonly string[]): string[] {
  const rest = head.slice(1);
  return rest[0] === PLUGIN_SUBCOMMAND ? rest.slice(1) : rest;
}

/** Whether two argv lists are the same tokens in the same order. */
function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/** Global flags as an operator would type them, or a note that there are none. */
function shown(flags: readonly string[]): string {
  return flags.length === 0 ? "no global flags" : `\`${flags.join(" ")}\``;
}
