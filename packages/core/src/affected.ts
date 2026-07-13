/**
 * Git-aware execution: restrict a run to the targets *affected* by the files
 * that changed since a base git revision. Pairs with the incremental
 * {@link "./cache.ts" | cache} — `--affected` prunes the plan to the targets a
 * change can reach, and the cache skips unchanged work within what remains.
 *
 * A target is **affected** when a changed file falls inside one of its declared
 * {@link TargetBuilder.inputs}, or when any of its dependencies is affected.
 * Affectedness propagates forward along `dependsOn` (a dependency's change
 * dirties its dependents) and `triggers` (a triggering target pulls its
 * triggered ones along). A target that declares **no** inputs cannot be proven
 * unaffected, so it is conservatively treated as always affected — declare
 * `inputs` on the targets you want `--affected` to be able to skip.
 *
 * The set of changed files comes from git through an injectable seam
 * ({@link ChangedFilesFn}), so the affected computation itself stays a pure,
 * unit-testable function ({@link affectedTargets}).
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";

/**
 * Lists the files changed since `base` (a git revision), each path relative to
 * the repository root. The seam behind {@link ExecuteOptions.affected}; defaults
 * to {@link gitChangedFiles} and is overridable so the affected plan can be
 * tested without a real git repository.
 */
export type ChangedFilesFn = (base: string) => Promise<string[]>;

/** Configure {@link ExecuteOptions.affected}: the base revision and diff seam. */
export interface AffectedOptions {
  /** The git revision to diff against. Defaults to `HEAD` (uncommitted changes). */
  base?: string;
  /** How to list changed files. Defaults to {@link gitChangedFiles}. */
  changedFiles?: ChangedFilesFn;
}

/** Normalise a path for comparison: `\`→`/`, drop a leading `./` and any trailing `/`. */
function normalize(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Whether `changed` (a normalised repo-relative path) falls inside the declared
 * input `input`: an exact match, a file under an input directory, or any path
 * when the input is the repository root (`.`).
 */
function inputCovers(input: string, changed: string): boolean {
  const base = normalize(input);
  if (base === "" || base === ".") return true;
  return changed === base || changed.startsWith(`${base}/`);
}

/** Whether any changed file falls inside one of the target's declared inputs. */
function inputsChanged(t: TargetBuilder, changed: readonly string[]): boolean {
  return t.inputs_.some((input) => changed.some((c) => inputCovers(input, c)));
}

/**
 * Compute the set of targets in `order` affected by the given `changed` files.
 *
 * `order` must be a valid execution order (dependencies before dependents, as
 * produced by {@link plan}/{@link planGraph}) so each target's dependencies are
 * already decided when it is visited. A target is affected when its own inputs
 * cover a changed file, when it declares no inputs (unprovable — treated as
 * affected), when a dependency is affected, or when an affected target triggers
 * it.
 */
export function affectedTargets(
  order: readonly TargetBuilder[],
  changed: readonly string[],
): Set<TargetBuilder> {
  const normalized = changed.map(normalize).filter((c) => c !== "");
  const affected = new Set<TargetBuilder>();
  const triggered = new Set<TargetBuilder>();
  for (const t of order) {
    const self = t.inputs_.length === 0 || inputsChanged(t, normalized);
    const viaDep = t.dependsOn_.some((d) => affected.has(d));
    if (self || viaDep || triggered.has(t)) {
      affected.add(t);
      for (const tr of t.triggers_) triggered.add(tr);
    }
  }
  return affected;
}

/** Split command output into non-empty, trimmed lines. */
function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * Run `bin` (default `git`) with `args`, returning its stdout. Throws a friendly
 * error if the binary cannot be spawned or exits non-zero. Kept generic (the
 * binary is a parameter) so the subprocess path is testable with a stand-in
 * executable.
 */
export async function runGitProcess(
  args: string[],
  bin = "git",
): Promise<string> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command(bin, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `could not run \`${bin}\`: ${detail}. Is git installed and on your PATH?`,
    );
  }
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `\`${bin} ${args.join(" ")}\` failed${stderr ? `: ${stderr}` : ""}. ` +
        `Is this a git repository, and does the base revision exist?`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

/**
 * List the files changed since `base` (default `HEAD`) via git: tracked changes
 * versus `base` plus untracked files not covered by `.gitignore`. `run` invokes
 * git and returns stdout (defaults to a real `git` subprocess); override it to
 * test without a repository.
 */
export async function gitChangedFiles(
  base = "HEAD",
  run: (args: string[]) => Promise<string> = runGitProcess,
): Promise<string[]> {
  // The base is passed to git as an argument, not through a shell, so there is
  // no shell-injection surface — but a value beginning with "-" would be read
  // as a git *option* (e.g. `--output=…` writes the diff to a file). A real
  // revision never starts with "-", so reject one that does.
  if (base.startsWith("-")) {
    throw new Error(
      `invalid git base revision "${base}": a revision must not start with "-" ` +
        `(git would read it as an option, not a commit).`,
    );
  }
  const diff = await run(["diff", "--name-only", base, "--"]);
  const untracked = await run(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...lines(diff), ...lines(untracked)])];
}
