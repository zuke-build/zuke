/**
 * Shell-completion script generation for the `completions` command.
 *
 * `zuke completions print <bash|zsh|fish>` prints a completion script for the
 * chosen shell that completes the build's target names, the reserved commands
 * (`graph`, `generate-ci`, `completions`), the built-in option flags, and any
 * declared build parameters. The script is a static snapshot of the build it
 * was generated from, so regenerate it (and re-source it) when targets change —
 * the same model as `deno completions`.
 *
 * The reserved commands and built-in flags it completes come from the shared
 * `cli_spec.ts` registry, so the parser, the help, and completion never drift.
 * Only the rendering helpers are internal; {@link formatCompletions} and the
 * shell-name guard are consumed by the CLI in `cli.ts`.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";
import { type AnyParameter, flagName } from "./params.ts";
import { BUILTIN_FLAGS, RESERVED_COMMANDS } from "./cli_spec.ts";

/** The shells for which a completion script can be emitted. */
export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;

/** A shell name that {@link formatCompletions} understands. */
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Narrow an arbitrary string to a supported {@link CompletionShell}. */
export function isCompletionShell(value: string): value is CompletionShell {
  return COMPLETION_SHELLS.some((shell) => shell === value);
}

/** A completion candidate: the literal word and a one-line description. */
interface Candidate {
  readonly name: string;
  readonly description: string;
}

/** Collapse runs of whitespace to single spaces so a description fits one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The listed targets as completion candidates (unlisted ones stay hidden). */
function targetCandidates(targets: Map<string, TargetBuilder>): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, t] of targets) {
    if (t.unlisted_) continue;
    out.push({ name, description: oneLine(t.description_ ?? "") });
  }
  return out;
}

/** The declared parameters as `--flag` completion candidates. */
function paramCandidates(params: Map<string, AnyParameter>): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, p] of params) {
    out.push({
      name: `--${flagName(name)}`,
      description: oneLine(p.description_ ?? ""),
    });
  }
  return out;
}

/** All flag candidates: the built-ins plus any declared parameters. */
function flagCandidates(params: Map<string, AnyParameter>): Candidate[] {
  return [...BUILTIN_FLAGS, ...paramCandidates(params)];
}

/** Quote a string for a single-quoted zsh/bash word, escaping embedded quotes. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** A zsh `_describe` spec entry: `word:description`, with both parts escaped. */
function zshSpec(c: Candidate): string {
  // `:` separates the word from its description in a spec, so escape it there.
  return shQuote(`${c.name}:${c.description.replaceAll(":", "\\:")}`);
}

/** Quote a string for a single-quoted fish word (only `\` and `'` are special). */
function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Render the bash completion script: a flat word list via `compgen -W`. */
function bashScript(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
): string {
  const words = [
    ...targetCandidates(targets),
    ...RESERVED_COMMANDS,
    ...flagCandidates(params),
  ].map((c) => c.name).join(" ");
  return [
    "# zuke shell completion (bash).",
    "# Enable for the current shell:  source <(zuke completions bash)",
    "_zuke_complete() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    `  local words="${words}"`,
    '  COMPREPLY=( $(compgen -W "${words}" -- "${cur}") )',
    "}",
    "complete -F _zuke_complete zuke",
    "complete -F _zuke_complete ./zuke",
    "",
  ].join("\n");
}

/** Render one zsh `_describe` group from a list of candidates. */
function zshGroup(varName: string, tag: string, items: Candidate[]): string[] {
  const lines = [`  local -a ${varName}`, `  ${varName}=(`];
  for (const c of items) lines.push(`    ${zshSpec(c)}`);
  lines.push("  )", `  _describe -t ${varName} '${tag}' ${varName}`);
  return lines;
}

/** Render the zsh completion script using `_describe` groups. */
function zshScript(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
): string {
  return [
    "#compdef zuke ./zuke",
    "# zuke shell completion (zsh).",
    "# Enable for the current shell:  source <(zuke completions zsh)",
    "_zuke() {",
    ...zshGroup("targets", "target", targetCandidates(targets)),
    ...zshGroup("commands", "command", [...RESERVED_COMMANDS]),
    ...zshGroup("options", "option", flagCandidates(params)),
    "}",
    // Loaded from $fpath, the `#compdef` line registers it; sourced directly
    // the function runs first, so register it explicitly here instead.
    'if [ "${funcstack[1]}" = _zuke ]; then',
    '  _zuke "$@"',
    "else",
    "  compdef _zuke zuke ./zuke",
    "fi",
    "",
  ].join("\n");
}

/** Render the fish completion script: one `complete -c zuke` line per word. */
function fishScript(
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter>,
): string {
  const lines = [
    "# zuke shell completion (fish).",
    "# Enable for the current shell:  zuke completions fish | source",
    // Disable file completion; a build takes target names and flags, not paths.
    "complete -c zuke -f",
  ];
  // Targets and commands are first-argument subcommands.
  for (const c of [...targetCandidates(targets), ...RESERVED_COMMANDS]) {
    const doc = fishQuote(c.description);
    lines.push(
      `complete -c zuke -n __fish_use_subcommand -a ${c.name} -d ${doc}`,
    );
  }
  // Flags are available at any position; strip the leading `--` for `-l`.
  for (const c of flagCandidates(params)) {
    const flag = c.name.replace(/^--/, "");
    const doc = fishQuote(c.description);
    lines.push(`complete -c zuke -l ${flag} -d ${doc}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Produce a completion script for `shell` that completes the build's targets,
 * reserved commands, and option flags (including declared parameters).
 */
export function formatCompletions(
  shell: CompletionShell,
  targets: Map<string, TargetBuilder>,
  params: Map<string, AnyParameter> = new Map(),
): string {
  switch (shell) {
    case "bash":
      return bashScript(targets, params);
    case "zsh":
      return zshScript(targets, params);
    case "fish":
      return fishScript(targets, params);
  }
}
