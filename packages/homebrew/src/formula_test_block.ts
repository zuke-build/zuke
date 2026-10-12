// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link FormulaTestSettings} — the formula's `test do … end` block, kept to
 * the one shape a prebuilt binary needs: run an installed command, and
 * optionally check what it printed.
 *
 * @module
 */

import { rubyString } from "./ruby.ts";

/** A shell word that needs no quoting. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote `word` for the POSIX shell `shell_output` runs its command through: a
 * plain word as it is, anything else in single quotes, with each embedded `'`
 * written as `'\''`. Nothing a single-quoted word holds is special to the
 * shell, so an argument can never become a second command.
 */
function shellWord(word: string): string {
  return PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** What a formula test checks the command printed: the version, or a text. */
export type FormulaTestExpectation = { kind: "version" } | {
  kind: "output";
  text: string;
};

/**
 * Settings for the formula's `test do` block.
 *
 * ```ts
 * s.test((t) => t.command("--version").expectVersion())
 * // test do
 * //   assert_match version.to_s, shell_output("#{bin}/app --version")
 * // end
 * ```
 *
 * Without an expectation the command only has to succeed, and is run with
 * `system` and an argv — no shell at all.
 */
export class FormulaTestSettings {
  /** The installed binary to run. Set by {@link binary}. */
  binary_?: string;
  /** The arguments to run it with. Set by {@link command}. */
  args_: string[] = [];
  /** What the output must contain. Set by {@link expectVersion}/{@link expectOutput}. */
  expectation_?: FormulaTestExpectation;

  /**
   * Which installed binary to run. Defaults to the first one the formula
   * installs; it must be one of them.
   */
  binary(name: string): this {
    this.binary_ = name;
    return this;
  }

  /** The arguments to run the binary with, e.g. `"--version"`. */
  command(...args: string[]): this {
    this.args_.push(...args);
    return this;
  }

  /** Require the output to contain the formula's version. */
  expectVersion(): this {
    this.expectation_ = { kind: "version" };
    return this;
  }

  /** Require the output to contain `text`. */
  expectOutput(text: string): this {
    this.expectation_ = { kind: "output", text };
    return this;
  }

  /**
   * The block's lines (unindented, without `test do`/`end`), for a formula
   * that installs `installed`.
   *
   * @throws {Error} when {@link binary} names a binary the formula does not
   *   install.
   */
  render_(installed: readonly string[]): string[] {
    const binary = this.binary_ ?? installed[0];
    if (!installed.includes(binary)) {
      throw new Error(
        `formula test .binary(${JSON.stringify(binary)}) is not one of the ` +
          `binaries the formula installs (${installed.join(", ")}).`,
      );
    }
    const expectation = this.expectation_;
    if (expectation === undefined) {
      return [
        [`system bin/${rubyString(binary)}`, ...this.args_.map(rubyString)]
          .join(", "),
      ];
    }
    const line = [binary, ...this.args_].map(shellWord).join(" ");
    // `#{bin}` is the one interpolation, written here rather than passed
    // through the escaper — which would, correctly, neutralise it.
    const command = `"#{bin}/${rubyString(line).slice(1)}`;
    const expected = expectation.kind === "version"
      ? "version.to_s"
      : rubyString(expectation.text);
    return [`assert_match ${expected}, shell_output(${command})`];
  }
}
