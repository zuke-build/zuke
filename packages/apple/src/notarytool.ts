// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `NotarytoolTasks` — typed task functions for Apple's notary service through
 * `xcrun notarytool`: submit an archive, read a submission's status and log,
 * and list past submissions. Every subcommand that reports a result runs with
 * `--output-format json` and returns it parsed.
 *
 * ```ts
 * import { NotarytoolTasks } from "@zuke/apple";
 * const submission = await NotarytoolTasks.submit((s) =>
 *   s.file("dist/MyApp.zip")
 *     .key("AuthKey_ABC123.p8").keyId("ABC123").issuer(issuerUuid)
 *     .wait().timeout("30m")
 * );
 * // With .wait(), anything but "Accepted" throws a NotarizationError that
 * // lists the issues from the submission's log.
 * ```
 *
 * Under a deep dry run (`--dry-run`) the command is echoed, not run, so there
 * is no JSON to read and `submit`, `info`, `log` and `history` fail with a
 * `NotarytoolOutputError`; core exposes no way for a wrapper to tell a dry
 * run apart. Leave notarization targets out of a dry run.
 *
 * @module
 */

import type { Configure, PathLike } from "@zuke/core/tooling";
import { NotarizationError } from "./errors.ts";
import {
  type NotarytoolLog,
  type NotarytoolSubmission,
  parseHistory,
  parseLog,
  parseSubmission,
} from "./notarytool_result.ts";
import { NotarytoolSettings } from "./notarytool_settings.ts";
import { operand } from "./operand.ts";

/** `--output-format json`, which every result-reporting subcommand pins. */
const JSON_OUTPUT = ["--output-format", "json"];

/** Refuse a submission id that is missing or would be read as a flag. */
function submissionArg(subcommand: string, id: string | undefined): string {
  if (id === undefined || id === "") {
    throw new Error(
      `notarytool ${subcommand}: no submission id — add .submissionId(id).`,
    );
  }
  if (id.startsWith("-")) {
    throw new Error(
      `notarytool ${subcommand}: the submission id "${id}" starts with "-", ` +
        "so notarytool would read it as an option. Submission ids are UUIDs.",
    );
  }
  return id;
}

/** Settings for `xcrun notarytool submit`. */
export class NotarytoolSubmitSettings extends NotarytoolSettings {
  #file?: string;
  #wait = false;
  #timeout?: string;

  /** `submit`. */
  protected override subcommand(): string {
    return "submit";
  }

  /** The archive to notarize — a `.zip`, `.pkg` or `.dmg` (positional). Required. */
  file(path: PathLike): this {
    this.#file = operand(path);
    return this;
  }

  /**
   * Wait for Apple to finish processing (`--wait`). With it the result
   * carries the final status, and `NotarytoolTasks.submit` throws a
   * `NotarizationError` for anything but `Accepted`.
   */
  wait(): this {
    this.#wait = true;
    return this;
  }

  /** How long `--wait` waits, e.g. `30m` or `1h` (`--timeout`). Needs {@link wait}. */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Whether {@link wait} was set. */
  get waits(): boolean {
    return this.#wait;
  }

  /**
   * Settings for `notarytool log <id>` that reuse this submission's
   * credentials, binary, environment and working directory.
   */
  logFor(id: string): NotarytoolLogSettings {
    return this.carryInto(new NotarytoolLogSettings().submissionId(id));
  }

  /**
   * Run the submission and read its JSON result — what
   * `NotarytoolTasks.submit` calls before judging the status.
   *
   * The exit code is judged after the JSON is read: notarytool can exit
   * non-zero for a waited submission Apple did not accept, and that result —
   * which `NotarytoolTasks.submit` turns into a `NotarizationError` with the
   * log — is the most useful thing to report. Any other non-zero exit raises
   * the `CommandError`, even when it printed a result with an id (an upload
   * that failed after the id was issued, say); `.noThrow()` returns the
   * result instead. A failed run with no readable result raises it even under
   * `.noThrow()`, since there is then nothing to return.
   */
  async submit_(): Promise<NotarytoolSubmission> {
    const throws = this.throwsOnError;
    const output = await this.noThrow().run();
    let submission: NotarytoolSubmission;
    try {
      submission = parseSubmission(output.stdout, "submit");
    } catch (error) {
      if (output.code === 0) throw error;
      throw this.failureOf(output);
    }
    const rejected = this.#wait && submission.status !== "Accepted";
    if (throws && output.code !== 0 && !rejected) {
      throw this.failureOf(output);
    }
    return submission;
  }

  /** Assemble the submit arguments. */
  protected override subcommandArgs(): string[] {
    if (this.#file === undefined) {
      throw new Error("notarytool submit: no archive — add .file(path).");
    }
    if (this.#timeout !== undefined && !this.#wait) {
      throw new Error(
        "notarytool submit: .timeout() bounds --wait, so it needs .wait() too.",
      );
    }
    const argv = [this.#file];
    if (this.#wait) argv.push("--wait");
    if (this.#timeout !== undefined) argv.push("--timeout", this.#timeout);
    argv.push(...JSON_OUTPUT);
    return argv;
  }
}

/** Settings for `xcrun notarytool info <id>`. */
export class NotarytoolInfoSettings extends NotarytoolSettings {
  #id?: string;

  /** `info`. */
  protected override subcommand(): string {
    return "info";
  }

  /** The submission to describe (positional). Required. */
  submissionId(id: string): this {
    this.#id = id;
    return this;
  }

  /** Assemble the info arguments. */
  protected override subcommandArgs(): string[] {
    return [submissionArg("info", this.#id), ...JSON_OUTPUT];
  }
}

/** Settings for `xcrun notarytool log <id>`. */
export class NotarytoolLogSettings extends NotarytoolSettings {
  #id?: string;

  /** `log`. */
  protected override subcommand(): string {
    return "log";
  }

  /** The submission whose log to fetch (positional). Required. */
  submissionId(id: string): this {
    this.#id = id;
    return this;
  }

  /**
   * Assemble the log arguments. The log is itself JSON, printed to stdout
   * when no output path is given, so no output format is pinned.
   */
  protected override subcommandArgs(): string[] {
    return [submissionArg("log", this.#id)];
  }
}

/** Settings for `xcrun notarytool history`. */
export class NotarytoolHistorySettings extends NotarytoolSettings {
  /** `history`. */
  protected override subcommand(): string {
    return "history";
  }

  /** Assemble the history arguments. */
  protected override subcommandArgs(): string[] {
    return [...JSON_OUTPUT];
  }
}

/** The shape of {@link NotarytoolTasks}. */
export interface NotarytoolTasksApi {
  /**
   * Upload an archive with `notarytool submit` and return the parsed result.
   * With `.wait()`, a final status other than `Accepted` fetches the
   * submission's log and throws a {@link NotarizationError} listing its
   * issues — unless `.noThrow()` was set, when the result is returned for the
   * caller to inspect.
   */
  submit(
    configure: Configure<NotarytoolSubmitSettings>,
  ): Promise<NotarytoolSubmission>;
  /** Read a submission's status with `notarytool info`. */
  info(
    configure: Configure<NotarytoolInfoSettings>,
  ): Promise<NotarytoolSubmission>;
  /** Fetch and parse a submission's notarization log with `notarytool log`. */
  log(configure: Configure<NotarytoolLogSettings>): Promise<NotarytoolLog>;
  /** List the team's past submissions with `notarytool history`. */
  history(
    configure: Configure<NotarytoolHistorySettings>,
  ): Promise<NotarytoolSubmission[]>;
}

/**
 * Fetch the log for a submission that was not accepted, or `undefined` when it
 * cannot be had — the error raised then is about the submission, not the log.
 */
async function logOf(
  settings: NotarytoolSubmitSettings,
  id: string,
): Promise<NotarytoolLog | undefined> {
  try {
    return parseLog((await settings.logFor(id).quiet().run()).stdout);
  } catch {
    return undefined;
  }
}

/** Typed task functions for `xcrun notarytool`. */
export const NotarytoolTasks: NotarytoolTasksApi = {
  async submit(
    configure: Configure<NotarytoolSubmitSettings>,
  ): Promise<NotarytoolSubmission> {
    const settings = configure(new NotarytoolSubmitSettings());
    // Read before submit_() sets noThrow to judge the exit itself.
    const throws = settings.throwsOnError;
    const submission = await settings.submit_();
    if (throws && settings.waits && submission.status !== "Accepted") {
      throw new NotarizationError(
        submission,
        await logOf(settings, submission.id),
      );
    }
    return submission;
  },
  async info(
    configure: Configure<NotarytoolInfoSettings>,
  ): Promise<NotarytoolSubmission> {
    const output = await configure(new NotarytoolInfoSettings()).run();
    return parseSubmission(output.stdout, "info");
  },
  async log(
    configure: Configure<NotarytoolLogSettings>,
  ): Promise<NotarytoolLog> {
    const output = await configure(new NotarytoolLogSettings()).run();
    return parseLog(output.stdout);
  },
  async history(
    configure: Configure<NotarytoolHistorySettings>,
  ): Promise<NotarytoolSubmission[]> {
    const output = await configure(new NotarytoolHistorySettings()).run();
    return parseHistory(output.stdout);
  },
};
