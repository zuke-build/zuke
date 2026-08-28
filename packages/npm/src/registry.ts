// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that talk to a registry about a package rather than about the
 * project: `npm view`, `ping`, `whoami`, `access`, `owner`, and `token`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.view((s) => s.spec("react").field("dist-tags.latest"));
 * await NpmTasks.access((s) => s.setStatus("public"));
 * const who = await NpmTasks.whoamiName(); // undefined when logged out
 * ```
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { NpmSettings, NpmWorkspaceSettings } from "./settings.ts";

/** Settings for `npm view`. */
export class NpmViewSettings extends NpmWorkspaceSettings {
  #spec?: string;
  #fields: string[] = [];

  /** The package spec to read, e.g. `react@18` (positional). */
  spec(value: string): this {
    this.#spec = value;
    return this;
  }

  /**
   * A field of the registry metadata to print, e.g. `version` or
   * `dist-tags.latest` (positional); repeatable. With none, npm prints the
   * whole record.
   */
  field(...names: string[]): this {
    this.#fields.push(...names);
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "view";

  /** Assemble the `npm view` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#spec === undefined && this.#fields.length > 0) {
      throw new Error(
        "NpmTasks.view: a field follows the package spec — call .spec(...), " +
          "or npm reads the first field as the package name.",
      );
    }
    const argv = ["view", ...this.workspaceArgs()];
    if (this.#spec !== undefined) argv.push(this.#spec);
    argv.push(...this.#fields);
    return argv;
  }
}

/** Settings for `npm ping`. */
export class NpmPingSettings extends NpmSettings {
  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "ping";

  /** Assemble the `npm ping` argv. */
  protected override subcommandArgs(): string[] {
    return ["ping"];
  }
}

/** Settings for `npm whoami`. */
export class NpmWhoamiSettings extends NpmSettings {
  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "whoami";

  /** Assemble the `npm whoami` argv. */
  protected override subcommandArgs(): string[] {
    return ["whoami"];
  }
}

/**
 * Read the authenticated user's name, or `undefined` when the registry does
 * not recognise this machine. Backs {@link "./npm.ts".NpmTasks.whoamiName}.
 *
 * Being logged out is an answer, not a failure — a release target asks so it
 * can report the missing credential itself, rather than dying on npm's exit
 * code partway through.
 */
export async function readWhoami(
  configure?: Configure<NpmWhoamiSettings>,
): Promise<string | undefined> {
  const settings = new NpmWhoamiSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.noThrow().run();
  if (output.code !== 0) return undefined;
  const name = output.stdout.trim();
  return name === "" ? undefined : name;
}

/** Settings for `npm access`. */
export class NpmAccessSettings extends NpmSettings {
  #args: string[] = ["get", "status"];
  #otp?: string;

  /** List the packages a user, scope, or team can reach (`access list packages`). */
  listPackages(owner?: string, pkg?: string): this {
    this.#args = ["list", "packages"];
    if (owner !== undefined) this.#args.push(owner);
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** List a package's collaborators (`access list collaborators`). */
  listCollaborators(pkg?: string, user?: string): this {
    this.#args = ["list", "collaborators"];
    if (pkg !== undefined) this.#args.push(pkg);
    if (user !== undefined) this.#args.push(user);
    return this;
  }

  /** Read whether a package is public or private (`access get status`), the default. */
  getStatus(pkg?: string): this {
    this.#args = ["get", "status"];
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** Set a package public or private (`access set status=<level>`). */
  setStatus(level: "public" | "private", pkg?: string): this {
    this.#args = ["set", `status=${level}`];
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** Require two-factor auth for publishing (`access set mfa=<mode>`). */
  setMfa(mode: "none" | "publish" | "automation", pkg?: string): this {
    this.#args = ["set", `mfa=${mode}`];
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** Give a team access (`access grant <permission> <scope:team>`). */
  grant(
    permission: "read-only" | "read-write",
    team: string,
    pkg?: string,
  ): this {
    this.#args = ["grant", permission, team];
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** Take a team's access away (`access revoke <scope:team>`). */
  revoke(team: string, pkg?: string): this {
    this.#args = ["revoke", team];
    if (pkg !== undefined) this.#args.push(pkg);
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "access";

  /** Assemble the `npm access` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["access", ...this.#args];
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    return argv;
  }
}

/** Settings for `npm owner`. */
export class NpmOwnerSettings extends NpmWorkspaceSettings {
  #args: string[] = [];
  #otp?: string;

  /** Add a maintainer (`owner add <user> <pkg>`). */
  add(user: string, pkg: string): this {
    this.#args = ["add", user, pkg];
    return this;
  }

  /** Remove a maintainer (`owner rm <user> <pkg>`). */
  rm(user: string, pkg: string): this {
    this.#args = ["rm", user, pkg];
    return this;
  }

  /** List a package's maintainers (`owner ls <pkg>`). */
  ls(pkg: string): this {
    this.#args = ["ls", pkg];
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "owner";

  /** Assemble the `npm owner` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#args.length === 0) {
      throw new Error(
        "NpmTasks.owner: no subcommand — call .add(user, pkg), " +
          ".rm(user, pkg), or .ls(pkg).",
      );
    }
    const argv = ["owner", ...this.#args];
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/** Which `npm token` subcommand a {@link NpmTokenSettings} runs. */
type TokenMode = "list" | "create" | "revoke";

/**
 * Settings for `npm token`. Pick the subcommand with {@link list},
 * {@link create}, or {@link revoke}.
 */
export class NpmTokenSettings extends NpmSettings {
  #mode: TokenMode = "list";
  #target?: string;
  #readOnly = false;
  #cidr: string[] = [];
  #otp?: string;

  /** List this account's tokens (`token list`), the default. */
  list(): this {
    this.#mode = "list";
    return this;
  }

  /** Create a token (`token create`). */
  create(): this {
    this.#mode = "create";
    return this;
  }

  /** Revoke a token by id or value (`token revoke <id|token>`). */
  revoke(idOrToken: string): this {
    this.#mode = "revoke";
    this.#target = idOrToken;
    return this;
  }

  /** Create a token that cannot publish (`--read-only`). */
  readOnly(): this {
    this.#readOnly = true;
    return this;
  }

  /** Restrict a created token to these ranges (`--cidr=<range>`); repeatable. */
  cidr(...ranges: string[]): this {
    this.#cidr.push(...ranges);
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "token";

  /** Assemble the `npm token` argv. */
  protected override subcommandArgs(): string[] {
    if ((this.#readOnly || this.#cidr.length > 0) && this.#mode !== "create") {
      throw new Error(
        `NpmTasks.token: .readOnly()/.cidr(...) describe a token being made, ` +
          `which \`token ${this.#mode}\` does not do — drop them, or call ` +
          `.create().`,
      );
    }
    const argv = ["token", this.#mode];
    if (this.#target !== undefined) argv.push(this.#target);
    if (this.#readOnly) argv.push("--read-only");
    for (const range of this.#cidr) argv.push(`--cidr=${range}`);
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    return argv;
  }
}
