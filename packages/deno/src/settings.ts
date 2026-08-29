// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The bases every `deno` subcommand settings class is built on: the tool
 * resolution shared by all of them, and the `--allow-*` permission flags
 * shared by the subcommands that execute user code.
 */

import { ToolSettings } from "@zuke/core/tooling";

/** A Deno permission domain, as used by `--allow-*` flags. */
export type DenoPermission =
  | "read"
  | "write"
  | "net"
  | "env"
  | "run"
  | "sys"
  | "ffi"
  | "import";

/** Base for all `deno` subcommand settings: binary is the running deno. */
export abstract class DenoSettings extends ToolSettings {
  /** Default the tool binary to the running `deno` executable. */
  protected override defaultTool(): string {
    return Deno.execPath();
  }
}

/** Base for subcommands that accept `--allow-*` permission flags. */
export abstract class DenoPermissionSettings extends DenoSettings {
  #permissions: string[] = [];
  #frozen = false;

  /** Grant all permissions (`--allow-all`). */
  allowAll(): this {
    this.#permissions.push("--allow-all");
    return this;
  }

  /** Grant one permission, optionally scoped to values (`--allow-read=a,b`). */
  allow(permission: DenoPermission, ...values: string[]): this {
    this.#permissions.push(
      values.length > 0
        ? `--allow-${permission}=${values.join(",")}`
        : `--allow-${permission}`,
    );
    return this;
  }

  /**
   * Error out if the lockfile is out of date instead of silently updating it
   * (`--frozen`). Use it whenever the module graph must match the committed
   * `deno.lock` exactly — running an `npm:` tool in CI, say, so its transitive
   * tree stays pinned to the audited integrity hashes rather than being
   * resolved afresh. Named `frozen` — not `frozenLockfile` — to mirror the real
   * Deno CLI flag exactly. This is a deliberate divergence from
   * `PnpmSettings.frozenLockfile()` in `@zuke/pnpm`, which follows pnpm's own
   * flag name instead: guideline 7 (mirror the real CLI) takes priority over
   * cross-package naming symmetry.
   */
  frozen(): this {
    this.#frozen = true;
    return this;
  }

  /** The accumulated permission flags, in declaration order. */
  protected get permissionArgs(): string[] {
    return [...this.#permissions];
  }

  /** The `--frozen` flag, if set; read by subclasses assembling their argv. */
  protected get frozenArgs(): string[] {
    return this.#frozen ? ["--frozen"] : [];
  }
}
