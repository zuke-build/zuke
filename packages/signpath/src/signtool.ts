// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `SigntoolTasks` — a typed wrapper for `signtool verify` from the Windows
 * SDK, to check the Authenticode signature SignPath put on a file.
 *
 * ```ts
 * import { SigntoolTasks } from "@zuke/signpath";
 * await SigntoolTasks.verify((s) =>
 *   s.authenticodePolicy().verbose().file("dist/signed/zuke.exe")
 * ); // signtool verify /pa /v dist/signed/zuke.exe
 * ```
 *
 * It lives in `@zuke/signpath` rather than a package of its own because it is
 * the other half of the same job: SignPath signs, `signtool verify` proves the
 * signature on the runner before the file is released. Only `verify` is
 * wrapped — signing itself happens in SignPath, whose keys never leave its HSM,
 * so `signtool sign` has no place in this flow.
 *
 * `signtool.exe` ships with the Windows SDK and is usually not on `PATH` (on a
 * GitHub-hosted Windows runner it lives under
 * `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`); point
 * `.toolPath(...)` at it, or add its directory to `PATH`.
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

/** The digest algorithms `/hash` accepts. */
export type SigntoolHashAlgorithm = "SHA1" | "SHA256";

/** Settings for `signtool verify`. */
export class SigntoolVerifySettings extends ToolSettings {
  #flags: string[] = [];
  #files: string[] = [];

  /** The default executable name (`signtool`). */
  protected override defaultTool(): string {
    return "signtool";
  }

  /** Resolve from `PATH` — `signtool` is a native Windows SDK binary. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /**
   * Verify against the default Authenticode policy (`/pa`) — what a signed
   * `.exe` or `.msi` needs. Without it `signtool` applies the Windows driver
   * policy and rejects ordinary code-signing certificates.
   */
  authenticodePolicy(): this {
    this.#flags.push("/pa");
    return this;
  }

  /** Verify against the kernel-mode driver signing policy (`/kp`). */
  kernelPolicy(): this {
    this.#flags.push("/kp");
    return this;
  }

  /** Verify against the policy with this GUID (`/pg`). */
  policy(guid: string): this {
    this.#flags.push("/pg", guid);
    return this;
  }

  /** Verify every signature of a file that carries several (`/all`). */
  allSignatures(): this {
    this.#flags.push("/all");
    return this;
  }

  /** Verify only the signature at this index, from 0 (`/ds`). */
  signatureIndex(index: number): this {
    this.#flags.push("/ds", String(index));
    return this;
  }

  /** Look the file up in a catalog only for this digest algorithm (`/hash`). */
  hash(algorithm: SigntoolHashAlgorithm): this {
    this.#flags.push("/hash", algorithm);
    return this;
  }

  /** Verify against this catalog file (`/c`). */
  catalog(path: PathLike): this {
    this.#flags.push("/c", String(path));
    return this;
  }

  /**
   * Require the signing certificate to chain to a root whose subject name
   * contains this text (`/r`).
   */
  rootSubjectName(name: string): this {
    this.#flags.push("/r", name);
    return this;
  }

  /** Warn when the signature is not timestamped (`/tw`). */
  timestampWarning(): this {
    this.#flags.push("/tw");
    return this;
  }

  /** Print the signature's description and URL (`/d`). */
  description(): this {
    this.#flags.push("/d");
    return this;
  }

  /** Print the signer, the chain and the timestamp (`/v`). */
  verbose(): this {
    this.#flags.push("/v");
    return this;
  }

  /** Print debugging information (`/debug`). */
  debug(): this {
    this.#flags.push("/debug");
    return this;
  }

  /**
   * The files to verify (positional), at least one. A relative path that
   * starts with `-` is passed as `./-…` so it cannot be read as an option; one
   * that starts with `/` is refused, since `signtool` would read it as an
   * option and on Windows it means the current drive's root — give a
   * drive-qualified or a relative path instead.
   */
  file(...paths: PathLike[]): this {
    for (const path of paths) {
      const text = String(path);
      if (text.startsWith("/")) {
        throw new Error(
          `signtool: "${text}" starts with "/", which signtool reads as an ` +
            `option — give a drive-qualified (C:\\…) or relative path.`,
        );
      }
      this.#files.push(text.startsWith("-") ? `./${text}` : text);
    }
    return this;
  }

  /** Assemble the argv: `verify`, the flags, then the files. */
  protected override buildArgs(): string[] {
    if (this.#files.length === 0) {
      throw new Error(
        "signtool verify: no file to verify — add .file(path).",
      );
    }
    return ["verify", ...this.#flags, ...this.#files];
  }
}

/** The shape of {@link SigntoolTasks}. */
export interface SigntoolTasksApi {
  /**
   * Check a file's Authenticode signature with `signtool verify`; a file that
   * is unsigned or fails the policy exits non-zero, which throws unless
   * `.noThrow()` is set.
   */
  verify(configure: Configure<SigntoolVerifySettings>): Promise<CommandOutput>;
}

/** Typed task functions for the Windows SDK's `signtool`. */
export const SigntoolTasks: SigntoolTasksApi = {
  verify(configure: Configure<SigntoolVerifySettings>): Promise<CommandOutput> {
    return runSettings(new SigntoolVerifySettings(), configure);
  },
};
