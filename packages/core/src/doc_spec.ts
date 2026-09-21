// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Resolving a `zuke doc` argument to a `deno doc` specifier.
 *
 * This lives in its own module because two entry points ask the same
 * question. `zuke doc core` reaches the installed `@zuke/cli`; `./zuke doc
 * core` reaches the build's own reserved `doc` command in `cli.ts`. They had
 * separate answers, and the answers disagreed: the CLI expanded a bare name to
 * `jsr:@zuke/<name>`, while the build treated anything that was not a URL or
 * an absolute path as a path and joined it to the working directory. So the
 * shorthand the CLI's help advertises — `zuke doc core`, "API of @zuke/core" —
 * resolved to a file that does not exist when the same words were typed at the
 * launcher, and `deno doc` reported a missing module.
 *
 * One rule, in one place, is what keeps those two invocations the same
 * command. The rule has to sort three kinds of argument apart without asking
 * the filesystem, since the specifier is resolved before anything is fetched:
 *
 * 1. A specifier that already says what it is — a URL scheme, an absolute
 *    path — is passed through untouched.
 * 2. A path is joined to `cwd`, because the caller means a file relative to
 *    where they are standing, and `deno doc` runs from an isolated empty
 *    directory where that would resolve to nothing.
 * 3. A package name becomes a `jsr:` specifier, with the `@zuke` scope filled
 *    in for a bare word, which is the shorthand that makes `zuke doc deno`
 *    worth typing.
 *
 * Telling a path from a package name is the whole difficulty, and the
 * distinguishing marks are: a leading `.`, a `/` (except after a leading `@`,
 * which makes it a scope rather than a directory), and a module file
 * extension. `mod.ts` is a file in the working directory, not a package called
 * `@zuke/mod.ts`.
 *
 * @module
 */

import { absolutePath } from "./path.ts";

/**
 * A URL scheme needs two or more characters before its colon, so a lone
 * Windows drive letter (`C:`) is not mistaken for one. `jsr:`, `npm:`,
 * `https:` and `file:` all qualify.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** A Windows drive-absolute path (`C:\x`, `C:/x`), after {@link URL_SCHEME}. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:/;

/**
 * The source extensions that mark an argument as a file rather than a package
 * name. A package name may contain a dot (`@scope/my.pkg`), so the extension
 * has to be recognised rather than any dot being taken as one.
 */
const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/i;

/**
 * Resolve a `zuke doc` argument to the specifier `deno doc` is given.
 *
 * `cwd` is the caller's working directory, taken as an argument rather than
 * read here: `deno doc` is run from an isolated empty directory, so a relative
 * path has to be made absolute while the caller's directory is still known,
 * and passing it keeps this function pure and testable without one.
 *
 * Bare names gain the `@zuke` scope (`core` becomes `jsr:@zuke/core`) and a
 * scoped name gains only the scheme (`@scope/pkg` becomes `jsr:@scope/pkg`).
 * Anything that looks like a path — leading `.`, an embedded `/`, or a module
 * file extension — is joined to `cwd` instead, and a specifier that already
 * carries a URL scheme or is absolute is returned untouched.
 *
 * A joined path comes back **normalised**, through {@link absolutePath}: the
 * `.` and `..` segments are resolved rather than carried into the specifier,
 * so `deno doc` is handed a canonical path and an error that echoes it names
 * a path the reader recognises. `cwd` must itself be absolute, which is what
 * makes that possible; {@link absolutePath} throws if it is not.
 */
export function resolveDocSpec(spec: string, cwd: string): string {
  // Already unambiguous: a scheme or an absolute path names its own target.
  if (URL_SCHEME.test(spec)) return spec;
  if (spec.startsWith("/") || spec.startsWith("\\")) return spec;
  if (DRIVE_ABSOLUTE.test(spec)) return spec;
  // Explicitly relative — the one form that can only be a path.
  if (spec.startsWith(".")) return absolutePath(cwd, spec).path;
  // A leading `@` makes the following slash a scope separator, not a
  // directory, so this check has to come before the slash check below.
  if (spec.startsWith("@")) return `jsr:${spec}`;
  if (spec.includes("/") || spec.includes("\\")) {
    return absolutePath(cwd, spec).path;
  }
  if (MODULE_EXTENSION.test(spec)) return absolutePath(cwd, spec).path;
  return `jsr:@zuke/${spec}`;
}
