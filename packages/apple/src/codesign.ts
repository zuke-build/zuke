// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `CodesignTasks` — typed task functions for Apple's `codesign`, in the
 * settings-lambda style of the other Zuke tool wrappers: sign, verify and
 * display a code signature.
 *
 * ```ts
 * import { CodesignTasks } from "@zuke/apple";
 * await CodesignTasks.sign((s) =>
 *   s.identity("Developer ID Application: Example (TEAMID)")
 *     .options("runtime").timestamp().force().file("dist/MyApp.app")
 * );
 * await CodesignTasks.verify((s) => s.strict().deep().file("dist/MyApp.app"));
 * ```
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { operand } from "./operand.ts";
import {
  type CodesignDisplay,
  parseCodesignDisplay,
} from "./codesign_display.ts";

/**
 * The shared shape of every `codesign` operation: the files it acts on and how
 * verbose it is. Each operation subclass names its mode flag and its own
 * options.
 */
export abstract class CodesignSettings extends ToolSettings {
  #files: string[] = [];
  #verbose?: number | true;

  /** The default executable name (`codesign`). */
  protected override defaultTool(): string {
    return "codesign";
  }

  /** Resolve from `PATH` — `codesign` ships with macOS in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** The operation's mode flag, e.g. `--sign` or `--verify`. */
  protected abstract operation(): string;

  /** The operation's own options, placed after the mode flag. */
  protected abstract operationArgs(): string[];

  /**
   * The code to act on (positional) — an app bundle, framework, binary or
   * disk image; repeatable. A relative path starting with `-` is passed as
   * `./-…` so `codesign` cannot read it as an option.
   */
  file(...paths: PathLike[]): this {
    this.#files.push(...paths.map(operand));
    return this;
  }

  /**
   * More output (`--verbose`, or `--verbose=<level>` with a level). `display`
   * shows more of the signature at each level; `4` lists everything.
   */
  verbose(level?: number): this {
    this.#verbose = level ?? true;
    return this;
  }

  /** Assemble the `codesign` argv: mode, options, verbosity, then files. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0) {
      throw new Error(
        `codesign ${this.operation()}: no code to act on — add .file(path).`,
      );
    }
    const argv = [this.operation(), ...this.operationArgs()];
    if (this.#verbose === true) argv.push("--verbose");
    else if (this.#verbose !== undefined) {
      argv.push(`--verbose=${this.#verbose}`);
    }
    argv.push(...this.#files);
    return argv;
  }
}

/** Settings for `codesign --sign`. */
export class CodesignSignSettings extends CodesignSettings {
  #identity?: string;
  #force = false;
  #deep = false;
  #options: string[] = [];
  #timestamp?: string | true;
  #entitlements?: string;
  #keychain?: string;
  #identifier?: string;

  /** `--sign`. */
  protected override operation(): string {
    return "--sign";
  }

  /**
   * The signing identity (`--sign <identity>`): a certificate's common name,
   * a substring of it, or its SHA-1 hash. `-` signs ad hoc. Required.
   */
  identity(value: string): this {
    this.#identity = value;
    return this;
  }

  /** Replace an existing signature (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Sign nested code as well (`--deep`). Apple discourages it for signing. */
  deep(): this {
    this.#deep = true;
    return this;
  }

  /**
   * Signature option flags (`--options`, comma-joined); repeatable.
   * `runtime` enables the hardened runtime notarization requires.
   */
  options(...flags: string[]): this {
    this.#options.push(...flags);
    return this;
  }

  /**
   * Request a secure timestamp (`--timestamp`), from `url` when given
   * (`--timestamp=<url>`). Notarization requires one.
   */
  timestamp(url?: string): this {
    this.#timestamp = url ?? true;
    return this;
  }

  /** The entitlements plist to embed (`--entitlements`). */
  entitlements(path: PathLike): this {
    this.#entitlements = String(path);
    return this;
  }

  /** Look the identity up in this keychain only (`--keychain`). */
  keychain(path: PathLike): this {
    this.#keychain = String(path);
    return this;
  }

  /** The code's identifier (`--identifier`), overriding the bundle id. */
  identifier(value: string): this {
    this.#identifier = value;
    return this;
  }

  /** Assemble the signing options. */
  protected override operationArgs(): string[] {
    if (this.#identity === undefined) {
      throw new Error(
        "CodesignTasks.sign: no signing identity — add .identity(name), or " +
          '.identity("-") to sign ad hoc.',
      );
    }
    const argv = [this.#identity];
    if (this.#force) argv.push("--force");
    if (this.#deep) argv.push("--deep");
    if (this.#options.length > 0) {
      argv.push("--options", this.#options.join(","));
    }
    if (this.#timestamp === true) argv.push("--timestamp");
    else if (this.#timestamp !== undefined) {
      argv.push(`--timestamp=${this.#timestamp}`);
    }
    if (this.#entitlements !== undefined) {
      argv.push("--entitlements", this.#entitlements);
    }
    if (this.#keychain !== undefined) argv.push("--keychain", this.#keychain);
    if (this.#identifier !== undefined) {
      argv.push("--identifier", this.#identifier);
    }
    return argv;
  }
}

/** Settings for `codesign --verify`. */
export class CodesignVerifySettings extends CodesignSettings {
  #strict = false;
  #deep = false;

  /** `--verify`. */
  protected override operation(): string {
    return "--verify";
  }

  /** Apply the strict validation rules notarization uses (`--strict`). */
  strict(): this {
    this.#strict = true;
    return this;
  }

  /** Verify nested code as well (`--deep`). */
  deep(): this {
    this.#deep = true;
    return this;
  }

  /** Assemble the verification options. */
  protected override operationArgs(): string[] {
    const argv: string[] = [];
    if (this.#strict) argv.push("--strict");
    if (this.#deep) argv.push("--deep");
    return argv;
  }
}

/** Settings for `codesign --display`. */
export class CodesignDisplaySettings extends CodesignSettings {
  /** `--display`. */
  protected override operation(): string {
    return "--display";
  }

  /** `--display` takes no options of its own beyond verbosity. */
  protected override operationArgs(): string[] {
    return [];
  }
}

/** The shape of {@link CodesignTasks}. */
export interface CodesignTasksApi {
  /** Sign code with `codesign --sign`. */
  sign(configure: Configure<CodesignSignSettings>): Promise<CommandOutput>;
  /** Check a signature with `codesign --verify`; a bad one fails the run. */
  verify(configure: Configure<CodesignVerifySettings>): Promise<CommandOutput>;
  /**
   * Describe a signature with `codesign --display`. `codesign` prints the
   * description on **stderr**, so it is returned parsed, with the raw text and
   * the command output alongside.
   */
  display(
    configure: Configure<CodesignDisplaySettings>,
  ): Promise<CodesignDisplay>;
}

/** Typed task functions for Apple's `codesign`. */
export const CodesignTasks: CodesignTasksApi = {
  sign(configure: Configure<CodesignSignSettings>): Promise<CommandOutput> {
    return runSettings(new CodesignSignSettings(), configure);
  },
  verify(
    configure: Configure<CodesignVerifySettings>,
  ): Promise<CommandOutput> {
    return runSettings(new CodesignVerifySettings(), configure);
  },
  display(
    configure: Configure<CodesignDisplaySettings>,
  ): Promise<CodesignDisplay> {
    return runSettings(new CodesignDisplaySettings(), configure)
      .then(parseCodesignDisplay);
  },
};
