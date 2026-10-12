// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The base every `notarytool` subcommand's settings extend: the `xcrun
 * notarytool <subcommand>` prefix and the three ways to authenticate.
 *
 * - **App Store Connect API key** — `.key(p8Path).keyId(id).issuer(uuid)`
 *   (`--key`, `--key-id`, `--issuer`; the issuer is omitted for an individual
 *   key). The recommended route for CI.
 * - **Keychain profile** — `.keychainProfile(name)` (`--keychain-profile`),
 *   credentials stored earlier with `notarytool store-credentials`, optionally
 *   from a specific keychain with `.keychain(path)`.
 * - **Apple ID** — `.appleId(email).password(appSpecific).teamId(id)`. The
 *   password is a secret: it is registered with the run's redactor and masked
 *   out of any error the run raises, though — being an argv token — it is
 *   still visible in the process table while the command runs. Prefer the API
 *   key or a keychain profile.
 *
 * Exactly one route must be configured; mixing two, or giving none, is refused
 * before anything runs.
 *
 * @module
 */

import {
  type PathLike,
  type ToolResolution,
  ToolSettings,
} from "@zuke/core/tooling";
import { Command, CommandError, type CommandOutput } from "@zuke/core/shell";
import { maskSecrets, runMasked } from "./secrets.ts";

/** Something applied to a settings object, recorded so it can be replayed. */
type Carried = (settings: ToolSettings) => void;

/** The `notarytool` credential flags, as configured. */
interface Credentials {
  key?: string;
  keyId?: string;
  issuer?: string;
  keychainProfile?: string;
  keychain?: string;
  appleId?: string;
  password?: string;
  teamId?: string;
}

/**
 * The shared settings of every `xcrun notarytool` subcommand: the credentials,
 * and the masking of the app-specific password. A subclass names its
 * subcommand and builds its own arguments.
 */
export abstract class NotarytoolSettings extends ToolSettings {
  #credentials: Credentials = {};
  #secrets: string[] = [];
  #carried: Carried[] = [];

  /** The default executable name (`xcrun`), which dispatches to notarytool. */
  protected override defaultTool(): string {
    return "xcrun";
  }

  /** Resolve from `PATH` — `xcrun` ships with macOS in `/usr/bin`. */
  protected override defaultResolution(): ToolResolution {
    return "path";
  }

  /** The notarytool subcommand, e.g. `submit`. */
  protected abstract subcommand(): string;

  /** The subcommand's own arguments, placed before the credentials. */
  protected abstract subcommandArgs(): string[];

  /** The App Store Connect API private key file, `AuthKey_<id>.p8` (`--key`). */
  key(path: PathLike): this {
    this.#credentials.key = String(path);
    return this;
  }

  /** The API key's id (`--key-id`). */
  keyId(id: string): this {
    this.#credentials.keyId = id;
    return this;
  }

  /** The API key's issuer UUID (`--issuer`); omit it for an individual key. */
  issuer(uuid: string): this {
    this.#credentials.issuer = uuid;
    return this;
  }

  /**
   * Authenticate with credentials saved by `notarytool store-credentials`
   * (`--keychain-profile`).
   */
  keychainProfile(name: string): this {
    this.#credentials.keychainProfile = name;
    return this;
  }

  /** The keychain to read the {@link keychainProfile} from (`--keychain`). */
  keychain(path: PathLike): this {
    this.#credentials.keychain = String(path);
    return this;
  }

  /** The Apple ID to authenticate as (`--apple-id`). */
  appleId(email: string): this {
    this.#credentials.appleId = email;
    return this;
  }

  /**
   * The Apple ID's app-specific password (`--password`). Registered with the
   * run's redactor and masked out of any error this run raises.
   */
  password(value: string): this {
    this.#credentials.password = value;
    this.#secrets.push(value);
    this.markSecret(value);
    return this;
  }

  /** The developer team id the Apple ID signs for (`--team-id`). */
  teamId(id: string): this {
    this.#credentials.teamId = id;
    return this;
  }

  /** Override the binary, remembered so a follow-up command uses it too. */
  override toolPath(path: PathLike): this {
    this.#carried.push((s) => s.toolPath(path));
    return super.toolPath(path);
  }

  /** Merge environment variables, remembered for a follow-up command too. */
  override env(record: Record<string, string>): this {
    this.#carried.push((s) => s.env(record));
    return super.env(record);
  }

  /** Set the working directory, remembered for a follow-up command too. */
  override cwd(path: PathLike): this {
    this.#carried.push((s) => s.cwd(path));
    return super.cwd(path);
  }

  /**
   * Give `target` this command's credentials, binary, environment and working
   * directory — so a follow-up command (the log of a failed submission) talks
   * to the same account through the same `xcrun`.
   */
  protected carryInto<T extends NotarytoolSettings>(target: T): T {
    target.#credentials = { ...this.#credentials };
    target.#secrets = [...this.#secrets];
    for (const apply of this.#carried) apply(target);
    return target;
  }

  /**
   * Run the command, with the app-specific password masked out of any
   * `CommandError` or timeout it raises — inside a run and outside one.
   */
  override run(): Promise<CommandOutput> {
    return runMasked(() => super.run(), this.#secrets);
  }

  /**
   * The {@link CommandError} a failed `output` of this command amounts to,
   * with the app-specific password masked out — for a subclass that ran with
   * `noThrow` to read the output first and judges the exit itself.
   */
  protected failureOf(output: CommandOutput): CommandError {
    return new CommandError(
      maskSecrets(new Command(this.argv()).commandLine, this.#secrets),
      output.code,
      maskSecrets(output.stderr, this.#secrets),
    );
  }

  /** Assemble `notarytool <subcommand> <args> <credentials>`. */
  protected override buildArgs(): string[] {
    return [
      "notarytool",
      this.subcommand(),
      ...this.subcommandArgs(),
      ...credentialArgs(this.subcommand(), this.#credentials),
    ];
  }
}

/** The credential flags for `c`, refusing a mix of routes or none at all. */
function credentialArgs(subcommand: string, c: Credentials): string[] {
  const apiKey = c.key !== undefined || c.keyId !== undefined ||
    c.issuer !== undefined;
  const profile = c.keychainProfile !== undefined;
  const appleId = c.appleId !== undefined || c.password !== undefined ||
    c.teamId !== undefined;
  const routes = [apiKey, profile, appleId].filter(Boolean).length;
  const prefix = `notarytool ${subcommand}:`;
  if (routes !== 1) {
    throw new Error(
      `${prefix} ${routes === 0 ? "no credentials" : "mixed credentials"} — ` +
        "authenticate with exactly one of an API key " +
        "(.key(p8).keyId(id).issuer(uuid)), a keychain profile " +
        "(.keychainProfile(name)), or an Apple ID " +
        "(.appleId(email).password(pw).teamId(id)).",
    );
  }
  if (c.keychain !== undefined && !profile) {
    throw new Error(
      `${prefix} .keychain(path) names where a keychain profile is stored, ` +
        "so it needs .keychainProfile(name) as well.",
    );
  }
  if (apiKey) {
    if (c.key === undefined || c.keyId === undefined) {
      throw new Error(
        `${prefix} an API key needs both .key(p8Path) and .keyId(id).`,
      );
    }
    const argv = ["--key", c.key, "--key-id", c.keyId];
    if (c.issuer !== undefined) argv.push("--issuer", c.issuer);
    return argv;
  }
  if (c.keychainProfile !== undefined) {
    const argv = ["--keychain-profile", c.keychainProfile];
    if (c.keychain !== undefined) argv.push("--keychain", c.keychain);
    return argv;
  }
  if (
    c.appleId === undefined || c.password === undefined ||
    c.teamId === undefined
  ) {
    throw new Error(
      `${prefix} Apple ID authentication needs .appleId(email), ` +
        ".password(appSpecificPassword) and .teamId(id).",
    );
  }
  return [
    "--apple-id",
    c.appleId,
    "--password",
    c.password,
    "--team-id",
    c.teamId,
  ];
}
