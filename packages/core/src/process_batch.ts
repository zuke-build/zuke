// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Running a Windows batch file (`.cmd`, `.bat`) from Node without letting
 * its arguments become commands.
 *
 * A batch file is not a program: `cmd.exe` runs it, and reads the whole
 * command line itself, where `&`, `|`, `^`, `%NAME%` and a quote in the right
 * place mean something. An argument that reaches that line unprepared is
 * code. This is the "BatBadBut" disclosure of 2024. Node's answer was to
 * refuse to start a batch file at all, and the two ways around the refusal it
 * documents, a shell and a `cmd /c` prefix, escape nothing.
 *
 * So the line is built here, by the recipe from the disclosure, which is also
 * what Rust does and therefore what Deno has always done for Zuke:
 *
 * - `cmd.exe` is started by its full path under the system directory, never
 *   found by name.
 * - It gets `/e:ON /v:OFF /d /c`: command extensions on, which the percent
 *   handling below needs; delayed expansion off, so `!NAME!` is text; no
 *   AutoRun commands.
 * - Every argument that is not plainly safe is quoted. A quote inside it is
 *   doubled, and backslashes before a quote are doubled.
 * - Every `%` becomes `%%cd:~,%`: the middle is an empty slice of a variable
 *   that always exists, so it expands to nothing and leaves one `%` that
 *   starts no variable.
 * - A batch file named without a directory is found on `PATH` and written
 *   by its full path. Left bare, `cmd.exe` would look in the working
 *   directory first, where a checkout can plant one.
 * - A bare name with no extension, such as `npm`, is first looked up on the
 *   child's `PATH` through its `PATHEXT`, as Deno looks it up, since Node's
 *   own search tries only `.com` and `.exe`. When the first match is a batch
 *   file (`npm.cmd`), it is run as one, by the rules above; a program found
 *   first is left to Node.
 *
 * What cannot be made safe is refused: a line break or a NUL in an argument,
 * a script path holding a quote or ending in a backslash, and a system
 * directory that is not a full path on a drive.
 *
 * What no caller can do anything about: a batch file that mishandles its own
 * arguments after receiving them correctly, by turning delayed expansion on,
 * expanding them a second time through `call`, or stripping their quotes.
 *
 * @module
 */

import { besideFile, FULL_PATH, shimTarget } from "./process_shim.ts";

/** The options `cmd.exe` is given before the line it runs. */
const PROMPT_OPTIONS = ["/e:ON", "/v:OFF", "/d", "/c"];

/** Punctuation that needs no quoting; every other ASCII symbol gets it. */
const PLAIN = /^[A-Za-z0-9#$*+\-./:?@\\_]$/;

/** A control character, which is quoted too. */
const CONTROL = /\p{Cc}/u;

/** What ends a line or a string for `cmd.exe`, and so can never be passed. */
const UNPASSABLE = /[\r\n\0]/;

/**
 * The names `cmd.exe` tries for the command `node`, in its order. Only the
 * second is Node itself: the others are wrappers a version manager puts
 * first on `PATH`, which have to be run as what they are.
 */
const NODE_NAMES = ["node.com", "node.exe", "node.bat", "node.cmd"];

/** The extensions Windows tries for a bare name when `PATHEXT` is not set. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * The batch file a bare `command` names on Windows, found on the full paths
 * of `searchPath` with each of `pathext`'s extensions in order, as Deno finds
 * it, or `command` itself. Node searches `PATH` for `.com` and `.exe` only, so
 * without this `npm`, which is `npm.cmd`, would not be found. A program the
 * search finds first is left to Node, which finds it the same way.
 */
function namedBatchFile(
  command: string,
  searchPath: string | undefined,
  pathext: string | undefined,
  isFile: (path: string) => boolean,
): string {
  if (/[\\/]/.test(command) || /\.[^.]*$/.test(command)) return command;
  const names = (pathext ?? DEFAULT_PATHEXT).split(";")
    .filter((extension) => extension !== "")
    .map((extension) => `${command}${extension.toLowerCase()}`);
  const found = onSearchPath(names, searchPath, isFile);
  return found !== null && isBatchFile(found) ? found : command;
}

/** What Node is asked to start: a program, its arguments, and how they are passed. */
export interface Invocation {
  /** The program to start. */
  file: string;
  /** Its arguments. */
  args: string[];
  /**
   * Whether the arguments are already the text of the command line, to be
   * passed as they are, where Node would otherwise quote each one.
   */
  verbatim: boolean;
}

/**
 * Whether `command` names a Windows batch file. Windows drops dots and spaces
 * from the end of a name, so `tool.cmd.` is one too.
 */
export function isBatchFile(command: string): boolean {
  return /\.(cmd|bat)[. ]*$/i.test(command);
}

/**
 * `name` without the dots and spaces Windows drops from its end. A loop, not
 * a regular expression, whose backtracking a long run of them would make slow.
 */
function withoutTrailingDots(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === " ")) end--;
  return name.slice(0, end);
}

/** The value of the variable `name` in `env`, whatever the case of its name. */
function variable(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return Object.entries(env).find(([known]) => known.toUpperCase() === name)
    ?.[1];
}

/** The error for something that cannot be passed to a batch file safely. */
function refused(what: string): Error {
  return new Error(
    `Refusing to run a batch file with ${what}: cmd.exe cannot be given it ` +
      "safely.",
  );
}

/**
 * The first file there is with one of `names`, looking through the full
 * paths on `searchPath` in order and trying the names in order in each, or
 * `null`. An entry that is not a full path is passed over: the working
 * directory is never searched.
 */
function onSearchPath(
  names: string[],
  searchPath: string | undefined,
  isFile: (path: string) => boolean,
): string | null {
  for (const entry of (searchPath ?? "").split(";")) {
    const directory = `${entry.replace(/^"|"$/g, "").replace(/[\\/]+$/, "")}\\`;
    if (!FULL_PATH.test(directory)) continue;
    const found = names.find((name) => isFile(directory + name));
    if (found !== undefined) return directory + found;
  }
  return null;
}

/**
 * The batch file `script` by a path `cmd.exe` will not search for. One given
 * with a directory is used as it is. A bare name is looked up in the full
 * paths on `searchPath`, in order, and nowhere else.
 *
 * @throws {Error} with the code `ENOENT` for a bare name that is on none.
 */
export function resolvedBatchFile(
  script: string,
  searchPath: string | undefined,
  isFile: (path: string) => boolean,
): string {
  if (/[\\/]/.test(script)) return script;
  const found = onSearchPath([script], searchPath, isFile);
  if (found !== null) return found;
  throw Object.assign(new Error(`${script} was not found on PATH`), {
    code: "ENOENT",
  });
}

/** Whether `argument` must be quoted for `cmd.exe` to take it as one argument. */
function needsQuotes(argument: string): boolean {
  // An empty one would vanish, and a trailing backslash would escape a quote
  // the batch file puts after it.
  if (argument === "" || argument.endsWith("\\")) return true;
  for (const character of argument) {
    const ascii = character.charCodeAt(0) < 128;
    if ((ascii && !PLAIN.test(character)) || CONTROL.test(character)) {
      return true;
    }
  }
  return false;
}

/** `argument` as it is written on the line `cmd.exe` reads. */
function batchArgument(argument: string): string {
  if (UNPASSABLE.test(argument)) {
    throw refused("a line break or a NUL in an argument");
  }
  const quote = needsQuotes(argument);
  let written = "";
  let backslashes = 0;
  for (const unit of argument) {
    if (unit === "\\") {
      backslashes++;
    } else {
      // Backslashes before a quote are doubled, and the quote is doubled.
      if (unit === '"') written += "\\".repeat(backslashes) + '"';
      else if (unit === "%") written += "%%cd:~,";
      backslashes = 0;
    }
    written += unit;
  }
  // Backslashes before the closing quote are doubled too.
  return quote ? `"${written}${"\\".repeat(backslashes)}"` : written;
}

/**
 * The line `cmd.exe /c` is given to run the batch file `script` with `args`,
 * each reaching the batch file as one argument and none of it read as a
 * command.
 *
 * @throws {Error} when the script path or an argument cannot be made safe.
 */
export function batchCommandLine(script: string, args: string[]): string {
  if (
    script.includes('"') || script.endsWith("\\") || UNPASSABLE.test(script)
  ) {
    throw refused(`the path ${JSON.stringify(script)}`);
  }
  // The whole line is wrapped in one more pair of quotes, which `/c` strips.
  return `"${[`"${script}"`, ...args.map(batchArgument)].join(" ")}"`;
}

/**
 * `cmd.exe` by its full path, from the system directory `env` names.
 *
 * @throws {Error} when `env` names no system directory, or one that is not a
 * full path on a drive: `cmd.exe` is never found by name, or relative to
 * anything.
 */
export function commandPrompt(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const root = variable(env, "SYSTEMROOT");
  if (root === undefined || !/^[A-Za-z]:\\[^"%]*$/.test(root)) {
    throw new Error(
      "Refusing to run a batch file: the SystemRoot variable does not name " +
        "a directory by its full path, so cmd.exe cannot be named by its own.",
    );
  }
  return `${root.replace(/\\+$/, "")}\\System32\\cmd.exe`;
}

/** What {@link invocation} asks of the machine it runs on. */
export interface BatchHost {
  /** Whether `path` is a file. */
  isFile(path: string): boolean;
  /** The text of the file at `path`, or `null` when it is not a small file. */
  readText(path: string): string | null;
}

/**
 * What Node starts for `command` with `args`.
 * - On Windows a bare name is found on the child's `PATH` through its
 *   `PATHEXT`, as Deno finds it, so a batch file such as `npm.cmd` is run as
 *   one.
 *
 * - Anything that is not a batch file on Windows is started as it is.
 * - A batch file that is only a package manager's shim for a Node script is
 *   seen through: Node is started on the script, and no `cmd.exe` runs. See
 *   `process_shim.ts`. The Node is the one the shim would start: one beside
 *   the shim, else the first `node` on the full paths of the child's `PATH`.
 *   Where that is a wrapper and not `node.exe`, the shim is not seen through.
 *   The working directory is not searched, though `cmd.exe` would search it.
 * - Any other batch file, and a shim with no such Node, is started through
 *   `cmd.exe` on a line built by {@link batchCommandLine}.
 *
 * `parent` is this process's environment, which names the system directory.
 * `child` is the one the command will run in, whose `PATH` is searched.
 *
 * @throws {Error} for a batch file that cannot be found or run safely.
 */
export function invocation(
  command: string,
  args: string[],
  windows: boolean,
  parent: Readonly<Record<string, string | undefined>>,
  child: Readonly<Record<string, string | undefined>>,
  host: BatchHost,
): Invocation {
  if (!windows) return { file: command, args, verbatim: false };
  const searchPath = variable(child, "PATH");
  const resolved = namedBatchFile(
    command,
    searchPath,
    variable(child, "PATHEXT"),
    host.isFile,
  );
  if (!isBatchFile(resolved)) return { file: command, args, verbatim: false };
  // Windows drops dots and spaces from the end of a name; cmd.exe, given the
  // name in quotes, does not, and would not find the file.
  const named = withoutTrailingDots(resolved);
  const script = resolvedBatchFile(named, searchPath, host.isFile);
  const target = shimTarget(script, host.readText, host.isFile);
  if (target !== null) {
    // What the shim would start: a Node beside it, else whatever `node`
    // first means on PATH. If that is not Node itself, the shim is run.
    const beside = besideFile(script, "node.exe");
    const node = host.isFile(beside)
      ? beside
      : onSearchPath(NODE_NAMES, searchPath, host.isFile);
    if (node !== null && /\\node\.exe$/i.test(node)) {
      return { file: node, args: [target, ...args], verbatim: false };
    }
  }
  return {
    file: commandPrompt(parent),
    args: [...PROMPT_OPTIONS, batchCommandLine(script, args)],
    verbatim: true,
  };
}
