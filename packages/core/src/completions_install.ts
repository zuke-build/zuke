/**
 * Installing shell completions: `zuke completions install <shell>` writes the
 * generated script to a file under the user's config directory and wires it
 * into the shell so it loads on the next start — no manual `source` step.
 *
 * For bash and zsh that means appending a `source` line to the rc file
 * (`~/.bashrc` / `~/.zshrc`); fish discovers files dropped in its completions
 * directory automatically, so no rc edit is needed there. The work is a pure
 * function of an injectable home directory and environment reader, so it is
 * unit-tested hermetically against a temporary directory.
 *
 * @module
 */

import { FileTasks } from "./file.ts";
import type { TargetBuilder } from "./target.ts";
import type { AnyParameter } from "./params.ts";
import { type CompletionShell, formatCompletions } from "./completions.ts";

/** Options for {@link installCompletions}; the defaults read the environment. */
export interface InstallOptions {
  /** Home directory override. Defaults to {@link FileTasks.homeDirectory}. */
  home?: string;
  /** Config-dir override. Defaults to `$XDG_CONFIG_HOME`, then `<home>/.config`. */
  configHome?: string;
  /** Environment reader for `$XDG_CONFIG_HOME`, injectable for tests. */
  env?: (name: string) => string | undefined;
}

/** What {@link installCompletions} wrote, for reporting back to the user. */
export interface InstallResult {
  /** The shell the script was installed for. */
  shell: CompletionShell;
  /** Absolute path of the written completion script. */
  scriptPath: string;
  /** The rc file a `source` line was added to, or `undefined` (fish auto-loads). */
  rcPath?: string;
  /** Whether the rc file already sourced the script (so it was left untouched). */
  alreadySourced: boolean;
}

/** Where a shell's completion script lives and which rc file loads it. */
interface ShellLayout {
  scriptPath: string;
  /** The rc file to source from, or `undefined` when the shell auto-loads. */
  rcPath?: string;
}

/** Read an environment variable, treating missing env access as unset. */
function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** The parent directory of a `/`-separated path. */
function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? path : path.slice(0, slash);
}

/** Resolve the file and rc-file locations for `shell` from the environment. */
function layoutFor(
  shell: CompletionShell,
  options: InstallOptions,
): ShellLayout {
  const env = options.env ?? readEnv;
  const home = options.home ?? FileTasks.homeDirectory();
  const xdg = options.configHome ?? env("XDG_CONFIG_HOME");
  const configHome = xdg !== undefined && xdg !== "" ? xdg : `${home}/.config`;
  switch (shell) {
    case "bash":
      return {
        scriptPath: `${configHome}/zuke/completions/zuke.bash`,
        rcPath: `${home}/.bashrc`,
      };
    case "zsh":
      return {
        scriptPath: `${configHome}/zuke/completions/zuke.zsh`,
        rcPath: `${home}/.zshrc`,
      };
    case "fish":
      // fish auto-loads any file in its completions directory; no rc edit.
      return { scriptPath: `${configHome}/fish/completions/zuke.fish` };
  }
}

/**
 * Append a `source` line for `scriptPath` to `rcPath` unless it is already
 * there. Returns whether the line was already present (so nothing changed).
 */
async function ensureSourced(
  rcPath: string,
  scriptPath: string,
): Promise<boolean> {
  const sourceLine = `source "${scriptPath}"`;
  const existing = (await FileTasks.exists(rcPath))
    ? await FileTasks.readText(rcPath)
    : "";
  if (existing.includes(sourceLine)) return true;
  let base = existing;
  if (base !== "" && !base.endsWith("\n")) base += "\n";
  const lead = base === "" ? "" : "\n";
  await FileTasks.writeText(
    rcPath,
    `${base}${lead}# zuke shell completion\n${sourceLine}\n`,
  );
  return false;
}

/**
 * Write the completion script for `shell` and wire it into the shell's startup
 * so it loads automatically. Returns an {@link InstallResult} describing what
 * was written and whether the rc file already sourced it.
 */
export async function installCompletions(
  shell: CompletionShell,
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const { scriptPath, rcPath } = layoutFor(shell, options);
  await FileTasks.createDirectory(parentDir(scriptPath));
  await FileTasks.writeText(
    scriptPath,
    formatCompletions(shell, targets, params),
  );
  const alreadySourced = rcPath === undefined
    ? false
    : await ensureSourced(rcPath, scriptPath);
  return { shell, scriptPath, rcPath, alreadySourced };
}
