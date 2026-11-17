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

/** The options `cmd.exe` is given before the line it runs. */
const PROMPT_OPTIONS = ["/e:ON", "/v:OFF", "/d", "/c"];

/** Punctuation that needs no quoting; every other ASCII symbol gets it. */
const PLAIN = /^[A-Za-z0-9#$*+\-./:?@\\_]$/;

/** A control character, which is quoted too. */
const CONTROL = /\p{Cc}/u;

/** What ends a line or a string for `cmd.exe`, and so can never be passed. */
const UNPASSABLE = /[\r\n\0]/;

/** A directory by its full path, on a drive or a network share. */
const FULL_DIRECTORY = /^([A-Za-z]:[\\/]|\\\\)/;

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
  for (const entry of (searchPath ?? "").split(";")) {
    const directory = `${entry.replace(/^"|"$/g, "").replace(/[\\/]+$/, "")}\\`;
    if (!FULL_DIRECTORY.test(directory)) continue;
    if (isFile(directory + script)) return directory + script;
  }
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

/**
 * What Node starts for `command` with `args`. A batch file on Windows is
 * started through `cmd.exe` on a line built by {@link batchCommandLine};
 * everything else is started as it is.
 *
 * `parent` is this process's environment, which names the system directory.
 * `child` is the one the command will run in, whose `PATH` a bare batch file
 * name is looked up on. `isFile` says whether a path is a file.
 *
 * @throws {Error} for a batch file that cannot be found or run safely.
 */
export function invocation(
  command: string,
  args: string[],
  windows: boolean,
  parent: Readonly<Record<string, string | undefined>>,
  child: Readonly<Record<string, string | undefined>>,
  isFile: (path: string) => boolean,
): Invocation {
  if (!windows || !isBatchFile(command)) {
    return { file: command, args, verbatim: false };
  }
  // Windows drops dots and spaces from the end of a name; cmd.exe, given the
  // name in quotes, does not, and would not find the file.
  const named = command.replace(/[. ]+$/, "");
  const script = resolvedBatchFile(named, variable(child, "PATH"), isFile);
  return {
    file: commandPrompt(parent),
    args: [...PROMPT_OPTIONS, batchCommandLine(script, args)],
    verbatim: true,
  };
}
