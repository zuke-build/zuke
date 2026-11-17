// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Seeing through the batch file a package manager writes for a tool.
 *
 * Every tool in `node_modules/.bin` is, on Windows, a `.cmd` file that does
 * one thing: start Node on the tool's script and pass the arguments on. Run
 * through `cmd.exe`, it works, and `process_batch.ts` makes that safe. But
 * the shim adds nothing, and it costs two things. The arguments pass through
 * a batch file's own handling of them, which no caller controls. And the
 * process Zuke started is `cmd.exe`, so a cancel or a timeout stops the
 * shim and leaves the tool running.
 *
 * So where a batch file is such a shim, the script it names is started
 * directly: no `cmd.exe` runs, no line is built, and what is killed is the
 * tool.
 *
 * A file is such a shim only when the whole of it is one of the texts the
 * package managers write, with nothing but the script's path free. A file
 * that does anything more, sets a variable, changes directory, passes Node
 * an option, runs something after, or only looks similar, is not, and runs
 * as the batch file it is.
 *
 * @module
 */

/** Where a template has the script's path. */
const SCRIPT = "\0";

/**
 * The whole text of a shim that starts Node on a script and nothing else, as
 * each generator writes it, with {@link SCRIPT} where the path is.
 */
const TEMPLATES = [
  // npm, from version 7.
  [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\' +
    SCRIPT + '" %*',
  ],
  // pnpm.
  [
    "@SETLOCAL",
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\' + SCRIPT + '" %*',
    ") ELSE (",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\' + SCRIPT + '" %*',
    ")",
  ],
  // Yarn 1, and early pnpm.
  [
    '@IF EXIST "%~dp0\\node.exe" (',
    '  "%~dp0\\node.exe"  "%~dp0\\' + SCRIPT + '" %*',
    ") ELSE (",
    "  @SETLOCAL",
    "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
    '  node  "%~dp0\\' + SCRIPT + '" %*',
    ")",
  ],
].map((lines) => {
  const [first, ...rest] = lines.join("\n").split(SCRIPT).map((literal) =>
    literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  // The path is captured once, and has to be the same wherever it recurs.
  return new RegExp(`^${first}([^"%\\n]+)${rest.join("\\1")}$`);
});

/** A file or directory by its full path, on a drive or a network share. */
export const FULL_PATH = /^([A-Za-z]:[\\/]|\\\\)/;

/**
 * The script a shim starts with Node, relative to the shim's own directory,
 * or `null` when `text` is not, in whole, a shim that only does that.
 */
export function shimScript(text: string): string | null {
  const whole = text.replaceAll("\r\n", "\n").replace(/\n+$/, "");
  for (const template of TEMPLATES) {
    const match = template.exec(whole);
    if (match !== null) return match[1];
  }
  return null;
}

/** The path of `name` in the directory of the Windows path `file`. */
export function besideFile(file: string, name: string): string {
  const end = Math.max(file.lastIndexOf("\\"), file.lastIndexOf("/")) + 1;
  return file.slice(0, end) + name;
}

/**
 * The script the shim at `file` starts with Node, by its path, or `null`
 * when `file` is not such a shim or the script is not there.
 *
 * Only a shim named by its full path is seen through: a relative one would
 * be read from this process's directory and run from the child's. `readText`
 * gives a file's text, or `null`; `isFile` says whether a path is a file.
 */
export function shimTarget(
  file: string,
  readText: (path: string) => string | null,
  isFile: (path: string) => boolean,
): string | null {
  if (!FULL_PATH.test(file)) return null;
  const text = readText(file);
  if (text === null) return null;
  const script = shimScript(text);
  if (script === null) return null;
  const target = besideFile(file, script);
  return isFile(target) ? target : null;
}
