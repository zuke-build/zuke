// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that put a package into a registry, or change what is already
 * there: `npm publish`, `pack`, `version`, `unpublish`, `deprecate`, and
 * `dist-tag`.
 *
 * ```ts
 * import { NpmTasks } from "jsr:@zuke/npm";
 * await NpmTasks.pack((s) => s.packDestination("dist"));
 * await NpmTasks.publish((s) => s.access("public").provenance());
 * await NpmTasks.distTag((s) => s.add("app@1.2.3", "latest"));
 * ```
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import {
  type NpmAccess,
  NpmSettings,
  NpmWorkspaceSettings,
} from "./settings.ts";

/** Settings for `npm publish`. */
export class NpmPublishSettings extends NpmWorkspaceSettings {
  #tag?: string;
  #access?: NpmAccess;
  #dryRun = false;
  #otp?: string;
  #provenance = false;

  /** Publish under a dist-tag (`--tag=`). */
  tag(name: string): this {
    this.#tag = name;
    return this;
  }

  /** Set the package access level (`--access=`). */
  access(level: NpmAccess): this {
    this.#access = level;
    return this;
  }

  /** Report what would be published without uploading (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  /**
   * Publish with a provenance attestation (`--provenance`), which npm can
   * generate from a trusted CI run — the supply-chain signal a consumer can
   * verify against the workflow that built the tarball.
   */
  provenance(): this {
    this.#provenance = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "publish";

  /** Assemble the `npm publish` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["publish"];
    if (this.#tag !== undefined) argv.push(`--tag=${this.#tag}`);
    if (this.#access !== undefined) argv.push(`--access=${this.#access}`);
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#provenance) argv.push("--provenance");
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/** Settings for `npm pack`. */
export class NpmPackSettings extends NpmWorkspaceSettings {
  #specs: string[] = [];
  #destination?: string;
  #dryRun = false;

  /** Package specs to pack (positional); defaults to the current project. */
  packages(...specs: string[]): this {
    this.#specs.push(...specs);
    return this;
  }

  /** Where to write the tarball (`--pack-destination=<dir>`). */
  packDestination(dir: PathLike): this {
    this.#destination = String(dir);
    return this;
  }

  /** Report what would be packed without writing a tarball (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "pack";

  /** Assemble the `npm pack` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["pack"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#destination !== undefined) {
      argv.push(`--pack-destination=${this.#destination}`);
    }
    argv.push(...this.workspaceArgs(), ...this.#specs);
    return argv;
  }
}

/** Settings for `npm version`. */
export class NpmVersionSettings extends NpmWorkspaceSettings {
  #bump?: string;
  #message?: string;
  #noGitTagVersion = false;
  #preid?: string;
  #allowSameVersion = false;

  /** The bump: `patch` | `minor` | `major` or an explicit semver (required). */
  bump(value: string): this {
    this.#bump = value;
    return this;
  }

  /** Commit message; `%s` expands to the new version (`--message`). */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Do not create a git commit and tag (`--no-git-tag-version`). */
  noGitTagVersion(): this {
    this.#noGitTagVersion = true;
    return this;
  }

  /** The prerelease identifier for a `pre*` bump (`--preid=<id>`), e.g. `rc`. */
  preid(id: string): this {
    this.#preid = id;
    return this;
  }

  /** Accept a bump to the version already set (`--allow-same-version`). */
  allowSameVersion(): this {
    this.#allowSameVersion = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "version";

  /** Assemble the `npm version` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#bump === undefined) {
      throw new Error("NpmTasks.version: .bump() is required.");
    }
    const argv = ["version", this.#bump];
    if (this.#message !== undefined) argv.push("--message", this.#message);
    if (this.#noGitTagVersion) argv.push("--no-git-tag-version");
    if (this.#preid !== undefined) argv.push(`--preid=${this.#preid}`);
    if (this.#allowSameVersion) argv.push("--allow-same-version");
    argv.push(...this.workspaceArgs());
    return argv;
  }
}

/** Settings for `npm unpublish`. */
export class NpmUnpublishSettings extends NpmWorkspaceSettings {
  #spec?: string;
  #force = false;
  #dryRun = false;

  /** The package spec to remove, e.g. `app@1.2.3` (positional). */
  spec(value: string): this {
    this.#spec = value;
    return this;
  }

  /**
   * Confirm an unpublish npm would otherwise refuse (`--force`) — removing a
   * whole package, or a version outside the 72-hour window.
   */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Report what would be removed without removing it (`--dry-run`). */
  dryRun(): this {
    this.#dryRun = true;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "unpublish";

  /** Assemble the `npm unpublish` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["unpublish"];
    if (this.#dryRun) argv.push("--dry-run");
    if (this.#force) argv.push("--force");
    argv.push(...this.workspaceArgs());
    if (this.#spec !== undefined) argv.push(this.#spec);
    return argv;
  }
}

/** Settings for `npm deprecate`. */
export class NpmDeprecateSettings extends NpmSettings {
  #spec?: string;
  #message?: string;
  #otp?: string;

  /** The package spec to deprecate, e.g. `app@<2` (required). */
  spec(value: string): this {
    this.#spec = value;
    return this;
  }

  /**
   * The warning installers will see (required). An empty message is how npm
   * *un*-deprecates a version, so it must be given deliberately rather than
   * by omission.
   */
  message(text: string): this {
    this.#message = text;
    return this;
  }

  /** Provide a one-time password (`--otp=`). */
  otp(code: string): this {
    this.#otp = code;
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "deprecate";

  /** Assemble the `npm deprecate` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#spec === undefined || this.#message === undefined) {
      throw new Error(
        "NpmTasks.deprecate: .spec(...) and .message(...) are both required — " +
          'pass an empty message to undo a deprecation, e.g. .message("").',
      );
    }
    const argv = ["deprecate"];
    if (this.#otp !== undefined) argv.push(`--otp=${this.#otp}`);
    argv.push(this.#spec, this.#message);
    return argv;
  }
}

/** Which `npm dist-tag` subcommand a {@link NpmDistTagSettings} runs. */
type DistTagMode = "add" | "rm" | "ls";

/**
 * Settings for `npm dist-tag`. Pick the subcommand with {@link add},
 * {@link rm}, or {@link ls}.
 */
export class NpmDistTagSettings extends NpmWorkspaceSettings {
  #mode: DistTagMode = "ls";
  #args: string[] = [];

  /**
   * Point a tag at a published version (`dist-tag add <pkg@version> [<tag>]`).
   * The spec must carry the version; a tag cannot point at a range. With no
   * tag npm uses `latest`, as it does on the command line.
   */
  add(spec: string, tag?: string): this {
    this.#mode = "add";
    this.#args = tag === undefined ? [spec] : [spec, tag];
    return this;
  }

  /** Remove a tag (`dist-tag rm <pkg> <tag>`). */
  rm(spec: string, tag: string): this {
    this.#mode = "rm";
    this.#args = [spec, tag];
    return this;
  }

  /** List a package's tags (`dist-tag ls [<pkg>]`), the default. */
  ls(spec?: string): this {
    this.#mode = "ls";
    this.#args = spec === undefined ? [] : [spec];
    return this;
  }

  /** The `NpmTasks` method this backs. */
  protected override readonly taskName = "distTag";

  /** Assemble the `npm dist-tag` argv. */
  protected override subcommandArgs(): string[] {
    return ["dist-tag", this.#mode, ...this.workspaceArgs(), ...this.#args];
  }
}
