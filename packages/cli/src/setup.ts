/**
 * The scaffolding engine behind `zuke setup`. It writes a starter `zuke.ts`,
 * the `./zuke` bootstrap launchers, and a `deno.json` task into a target
 * directory.
 *
 * All filesystem and console effects go through an injectable {@link SetupHost}
 * so the logic stays pure and unit-testable; {@link defaultHost} is the real
 * `Deno`-backed implementation used in production.
 */

/** Narrow an unknown value to a plain JSON object (record). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The starter `zuke.ts`, with the build class named `name`. */
export function starterBuild(name: string): string {
  return `import { Build, run, target } from "jsr:@zuke/core";

/** Your project's build. Run a target with \`./zuke <target>\`. */
class ${name} extends Build {
  hello = target()
    .description("A sample target — replace me with real work")
    .executes(() => {
      console.log("Hello from Zuke!");
    });

  // Convention: \`default\` runs when no target is named.
  default = target()
    .description("Default target")
    .dependsOn(this.hello)
    .executes(() => {});
}

await run(${name});
`;
}

/**
 * The starter `zuke.json` config. Its presence at the repository root is what
 * `@zuke/core`'s `repoRoot()` walks up to find; the recorded `name` is the
 * build class for reference.
 */
export function starterConfig(name: string): string {
  return `${JSON.stringify({ name }, null, 2)}\n`;
}

/* cspell:disable */

/** The bash bootstrap launcher (`./zuke`). Installs Deno on first use. */
export function launcherBash(): string {
  return `#!/usr/bin/env bash
# Zuke launcher — installs Deno if missing, then runs zuke.ts.
set -euo pipefail
dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$dir"
if command -v deno >/dev/null 2>&1; then
  deno run -A zuke.ts "$@"
else
  echo "zuke: Deno not found — installing to ~/.deno ..." >&2
  curl -fsSL https://deno.land/install.sh | sh >/dev/null
  "$HOME/.deno/bin/deno" run -A zuke.ts "$@"
fi
`;
}

/** The PowerShell bootstrap launcher (`.\\zuke.ps1`). */
export function launcherPwsh(): string {
  return `#!/usr/bin/env pwsh
# Zuke launcher — installs Deno if missing, then runs zuke.ts.
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
$found = Get-Command deno -ErrorAction SilentlyContinue
if ($found) {
  $deno = $found.Source
} else {
  Write-Host "zuke: Deno not found - installing ..."
  Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
  $deno = Join-Path $HOME ".deno\\bin\\deno.exe"
}
& $deno run -A (Join-Path $dir "zuke.ts") @args
exit $LASTEXITCODE
`;
}

/* cspell:enable */

/** The task names `setup` writes into `deno.json`, with their commands. */
const DEFAULT_TASKS: ReadonlyArray<readonly [string, string]> = [
  ["zuke", "deno run -A zuke.ts"],
  ["fmt", "deno fmt"],
  ["lint", "deno lint"],
  ["test", "deno test -A"],
];

/**
 * Merge the default Zuke tasks into a `deno.json` document, preserving the
 * existing content. `existing` is the file text, or `null` to start fresh.
 */
export function mergeDenoJson(existing: string | null): string {
  const root: Record<string, unknown> = {};
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing);
    if (isRecord(parsed)) Object.assign(root, parsed);
  }
  const tasks: Record<string, unknown> = isRecord(root.tasks)
    ? { ...root.tasks }
    : {};
  for (const [task, command] of DEFAULT_TASKS) {
    if (!(task in tasks)) tasks[task] = command;
  }
  root.tasks = tasks;
  return `${JSON.stringify(root, null, 2)}\n`;
}

/** Whether a `deno.json` text already declares the `zuke` task. */
export type DenoJsonState = "present" | "absent" | "unparseable";

/** Classify a `deno.json` text by whether it already has the `zuke` task. */
export function zukeTaskState(text: string): DenoJsonState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unparseable";
  }
  if (isRecord(parsed) && isRecord(parsed.tasks) && "zuke" in parsed.tasks) {
    return "present";
  }
  return "absent";
}

/** Injected side effects, so {@link runSetup} is unit-testable. */
export interface SetupHost {
  /** Whether a path exists. */
  exists(path: string): Promise<boolean>;
  /** Whether a path exists and is a directory (a reserved-name collision). */
  isDirectory(path: string): Promise<boolean>;
  /** Read a file as UTF-8 text. */
  readText(path: string): Promise<string>;
  /** Write UTF-8 text to a file, creating or truncating it. */
  writeText(path: string, content: string): Promise<void>;
  /** Set a file's permission bits (may be unsupported on some platforms). */
  chmod(path: string, mode: number): Promise<void>;
  /** Emit a line of progress output. */
  log(message: string): void;
}

/** The real, `Deno`-backed {@link SetupHost}. */
export const defaultHost: SetupHost = {
  async exists(path: string): Promise<boolean> {
    try {
      await Deno.lstat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
  async isDirectory(path: string): Promise<boolean> {
    try {
      return (await Deno.lstat(path)).isDirectory;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  },
  readText(path: string): Promise<string> {
    return Deno.readTextFile(path);
  },
  writeText(path: string, content: string): Promise<void> {
    return Deno.writeTextFile(path, content);
  },
  chmod(path: string, mode: number): Promise<void> {
    return Deno.chmod(path, mode);
  },
  log(message: string): void {
    console.log(message);
  },
};

/** Options controlling {@link runSetup}. */
export interface SetupOptions {
  /** Directory to scaffold into (e.g. `"."`). */
  dir: string;
  /** Overwrite existing files instead of skipping them. */
  force: boolean;
  /** Build class name for the starter `zuke.ts`. */
  name: string;
  /**
   * The base name for the launcher scripts (`<name>` and `<name>.ps1`).
   * Defaults to `"zuke"`; override it when a `zuke/` directory already occupies
   * that name in the target directory.
   */
  launcherName?: string;
  /**
   * The `zuke.ts` contents to write. Defaults to {@link starterBuild}; `zuke
   * import` passes a build generated from an existing project's tasks instead.
   */
  buildContent?: string;
}

/** What happened to one scaffolded file. */
export type FileStatus = "created" | "overwritten" | "skipped";

/** The outcome for a single file. */
export interface FileResult {
  /** The file's name, relative to the setup directory. */
  path: string;
  /** What `setup` did with it. */
  status: FileStatus;
}

/** The result of a {@link runSetup} run. */
export interface SetupResult {
  /** One entry per file `setup` considered. */
  files: FileResult[];
}

/** Join a directory and file name without pulling in path utilities. */
export function joinPath(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

/** One file the scaffolder can write. */
interface ScaffoldFile {
  name: string;
  content: string;
  mode?: number;
  /** Whether this file is a launcher (its name comes from `launcherName`). */
  launcher?: boolean;
}

/** The default launcher base name. */
export const DEFAULT_LAUNCHER = "zuke";

/** Scaffold file names a launcher must not shadow (the build file and config). */
const RESERVED_NON_LAUNCHER = new Set([
  "zuke.ts",
  "zuke.json",
  "deno.json",
  ".gitignore",
]);

/**
 * Validate a `--launcher-name`: a single path segment (so the launcher can't be
 * written outside the target directory) that doesn't shadow another file setup
 * writes. Throws a friendly error otherwise.
 */
function assertLauncherName(name: string): void {
  // Reject path separators and a colon (a Windows drive/ADS separator), so the
  // launcher can only be a plain file in the target directory.
  if (name === "" || /[\\/:]/.test(name) || name === "." || name === "..") {
    throw new Error(
      `zuke setup: invalid --launcher-name "${name}" — it must be a plain file ` +
        `name (no path separators or ":").`,
    );
  }
  // Compare case-insensitively: a case-insensitive filesystem (macOS, Windows)
  // would let `Zuke.ts` shadow the `zuke.ts` setup writes.
  if (RESERVED_NON_LAUNCHER.has(name.toLowerCase())) {
    throw new Error(
      `zuke setup: --launcher-name "${name}" would overwrite a file setup ` +
        `writes (the build file or config) — choose a different name.`,
    );
  }
}

/**
 * Scaffold Zuke into `options.dir`: a starter `zuke.ts`, the launcher scripts,
 * and a `deno.json` task block. Existing files are skipped unless
 * `options.force` is set; `deno.json` is always merged (never clobbered). Fails
 * up front if a target name is occupied by a directory (see
 * {@link SetupOptions.launcherName}).
 */
export async function runSetup(
  options: SetupOptions,
  host: SetupHost = defaultHost,
): Promise<SetupResult> {
  const files: FileResult[] = [];
  const launcher = options.launcherName ?? DEFAULT_LAUNCHER;
  assertLauncherName(launcher);

  const scaffold: readonly ScaffoldFile[] = [
    {
      name: "zuke.ts",
      content: options.buildContent ?? starterBuild(options.name),
    },
    { name: launcher, content: launcherBash(), mode: 0o755, launcher: true },
    { name: `${launcher}.ps1`, content: launcherPwsh(), launcher: true },
    { name: "zuke.json", content: starterConfig(options.name) },
  ];

  // Fail before writing anything if a target name is occupied by a directory —
  // a scaffolded file can't be written over a directory, and silently skipping
  // it (the old behaviour) produced a launcher-less setup. Covers every name
  // setup writes, including the separately-written deno.json and .gitignore.
  const collisionTargets: ReadonlyArray<{ name: string; launcher: boolean }> = [
    ...scaffold.map((s) => ({ name: s.name, launcher: s.launcher === true })),
    { name: "deno.json", launcher: false },
    { name: ".gitignore", launcher: false },
  ];
  for (const item of collisionTargets) {
    const path = joinPath(options.dir, item.name);
    if (await host.isDirectory(path)) {
      throw new Error(
        `zuke setup: cannot write "${item.name}" — a directory exists at ` +
          `${path}. ` +
          (item.launcher
            ? `Pass --launcher-name <name> to write the launcher under a ` +
              `different name`
            : `Move or rename that directory (${item.name} is reserved by ` +
              `Zuke)`) +
          `, then re-run setup.`,
      );
    }
  }

  for (const item of scaffold) {
    const path = joinPath(options.dir, item.name);
    const existed = await host.exists(path);
    if (existed && !options.force) {
      host.log(`  skip     ${item.name}  (already exists)`);
      files.push({ path: item.name, status: "skipped" });
      continue;
    }
    await host.writeText(path, item.content);
    if (item.mode !== undefined) {
      try {
        await host.chmod(path, item.mode);
      } catch {
        // chmod is a no-op / unsupported on some platforms (e.g. Windows).
      }
    }
    const status: FileStatus = existed ? "overwritten" : "created";
    host.log(`  ${existed ? "update" : "create"}   ${item.name}`);
    files.push({ path: item.name, status });
  }

  files.push(await setupDenoJson(options.dir, host));
  files.push(await setupGitignore(options.dir, host));
  return { files };
}

/** The line `setup` ensures is present in `.gitignore` for generated output. */
const GITIGNORE_ENTRY = ".zuke/";

/** Create or update `.gitignore` so the generated `.zuke/` folder is ignored. */
async function setupGitignore(
  dir: string,
  host: SetupHost,
): Promise<FileResult> {
  const name = ".gitignore";
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, `${GITIGNORE_ENTRY}\n`);
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const before = await host.readText(path);
  if (before.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) {
    host.log(`  skip     ${name}  (${GITIGNORE_ENTRY} already ignored)`);
    return { path: name, status: "skipped" };
  }
  const separator = before === "" || before.endsWith("\n") ? "" : "\n";
  await host.writeText(path, `${before}${separator}${GITIGNORE_ENTRY}\n`);
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}

/** Create or merge `deno.json`, returning what happened to it. */
async function setupDenoJson(
  dir: string,
  host: SetupHost,
): Promise<FileResult> {
  const name = "deno.json";
  const path = joinPath(dir, name);
  if (!(await host.exists(path))) {
    await host.writeText(path, mergeDenoJson(null));
    host.log(`  create   ${name}`);
    return { path: name, status: "created" };
  }

  const before = await host.readText(path);
  const state = zukeTaskState(before);
  if (state === "present") {
    host.log(`  skip     ${name}  (zuke task already present)`);
    return { path: name, status: "skipped" };
  }
  if (state === "unparseable") {
    host.log(`  skip     ${name}  (unparseable, edit by hand)`);
    return { path: name, status: "skipped" };
  }
  await host.writeText(path, mergeDenoJson(before));
  host.log(`  update   ${name}`);
  return { path: name, status: "overwritten" };
}
