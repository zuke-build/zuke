// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Formula names: which ones are accepted, and the Ruby class name Homebrew
 * expects each to define.
 *
 * One module because the two decide each other. A formula file is loaded by
 * name and must define exactly the class Homebrew derives from that name, so a
 * name whose derived class is not a valid Ruby constant cannot be installed at
 * all — and the name is also the file name written into a tap
 * (`Formula/<name>.rb`), where a `/` or `..` would write somewhere else.
 *
 * @module
 */

/**
 * What a formula name may be: a lowercase letter, then lowercase letters,
 * digits and Homebrew's separators (`-`, `_`, `.`, `+`, `@`).
 *
 * Narrower than everything Homebrew tolerates on purpose. A leading digit
 * derives a class name that is not a Ruby constant, an uppercase letter is
 * folded away by the derivation, and a path separator would make the name a
 * path. None of them describes a formula someone should publish.
 */
const NAME = /^[a-z][a-z0-9+_.@-]*$/;

/** A valid Ruby constant made of ASCII letters and digits. */
const CONSTANT = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The Ruby class name Homebrew expects `name` to define — a port of
 * `Formulary.class_s`: capitalise (which lower-cases the rest), drop each
 * `-`, `_` or `.` and upper-case the letter or digit after it, turn `+`
 * into `x`, then turn the first `@` after a character and before a digit into
 * `AT`. So `foo-bar` is `FooBar`, `foo@2` is `FooAT2`, `python@3.12` is
 * `PythonAT312` and `gtk+` is `Gtkx`.
 */
function classS(name: string): string {
  const capitalised = name.charAt(0).toUpperCase() +
    name.slice(1).toLowerCase();
  return capitalised
    .replace(/[-_.][a-zA-Z0-9]/g, (matched) => matched.slice(-1).toUpperCase())
    .replaceAll("+", "x")
    .replace(/(.)@(\d)/, "$1AT$2");
}

/**
 * Validate a formula name and return the Ruby class name it must define.
 *
 * @throws {Error} naming the offending value when the name is not a lowercase
 *   formula name, or when Homebrew's derivation of it is not a Ruby constant
 *   (`foo--bar`, `foo@bar`, `foo-`).
 */
export function formulaClassName(name: string): string {
  if (!NAME.test(name)) {
    throw new Error(
      `invalid formula name ${JSON.stringify(name)}: use a lowercase letter, ` +
        `then lowercase letters, digits, "-", "_", ".", "+" or "@" ` +
        `(e.g. "app" or "app@2"). The name is also the file name in the tap, ` +
        `so it can hold no "/".`,
    );
  }
  const className = classS(name);
  if (!CONSTANT.test(className)) {
    throw new Error(
      `invalid formula name ${JSON.stringify(name)}: Homebrew derives the ` +
        `class name ${
          JSON.stringify(className)
        } from it, which is not a Ruby ` +
        `constant. Separators must each be followed by a letter or digit, ` +
        `and "@" by a version number.`,
    );
  }
  return className;
}

/**
 * Refuse a formula source that does not define the class Homebrew loads for
 * `name` (validating the name as {@link formulaClassName} does).
 *
 * Checked before a formula is published or installed, because a mismatch is
 * otherwise discovered by the first `brew install`: Homebrew loads
 * `Formula/<name>.rb` and looks for exactly this class.
 *
 * @throws {Error} naming the class that is missing.
 */
export function assertDefinesFormula(source: string, name: string): void {
  const className = formulaClassName(name);
  if (!new RegExp(`^class ${className} < Formula$`, "m").test(source)) {
    throw new Error(
      `the formula source for ${JSON.stringify(name)} does not define ` +
        `\`class ${className} < Formula\`, which is the class Homebrew loads ` +
        `from Formula/${name}.rb.`,
    );
  }
}
