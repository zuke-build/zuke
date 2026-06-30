import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, parameter, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { discoverParameters } from "../src/params.ts";
import {
  COMPLETION_SHELLS,
  formatCompletions,
  isCompletionShell,
} from "../src/completions.ts";
import { BUILTIN_FLAGS, RESERVED_COMMANDS } from "../src/cli_spec.ts";

/**
 * A build exercising every completion concern: a listed target, a target with
 * no description, an `unlisted()` target (must stay hidden), a target whose
 * description needs escaping (a colon, single quotes, a newline), and declared
 * parameters (one with a quote, one with no description).
 */
class Sample extends Build {
  build = target().description("Compile the project").executes(() => {});
  bare = target().executes(() => {});
  deploy = target().description("Ship: to 'prod'\nnow").executes(() => {});
  hidden = target().description("internal").unlisted().executes(() => {});
  dryMode = parameter("Don't run, just plan").boolean();
  region = parameter().env("REGION");
}

const targets = discoverTargets(new Sample());
const params = discoverParameters(new Sample());

Deno.test("isCompletionShell accepts the supported shells only", () => {
  for (const shell of COMPLETION_SHELLS) {
    assertEquals(isCompletionShell(shell), true);
  }
  assertEquals(isCompletionShell("powershell"), false);
  assertEquals(isCompletionShell(""), false);
});

Deno.test("bash completion lists targets, commands, and flags", () => {
  const script = formatCompletions("bash", targets, params);
  assertStringIncludes(script, "complete -F _zuke_complete zuke");
  assertStringIncludes(script, "complete -F _zuke_complete ./zuke");
  assertStringIncludes(script, "compgen -W");
  // Targets (listed), reserved commands, built-in flags, and parameter flags.
  const expected = [
    "build",
    "bare",
    "deploy",
    "graph",
    "generate-ci",
    "completions",
    "--list",
    "--skip",
    "--dry-mode",
    "--region",
  ];
  for (const word of expected) assertStringIncludes(script, word);
  // The unlisted target is never offered.
  assertEquals(script.includes("hidden"), false);
});

Deno.test("zsh completion uses _describe groups and escapes specs", () => {
  const script = formatCompletions("zsh", targets, params);
  assertStringIncludes(script, "#compdef zuke ./zuke");
  assertStringIncludes(script, "_describe -t targets 'target' targets");
  assertStringIncludes(script, "_describe -t commands 'command' commands");
  assertStringIncludes(script, "_describe -t options 'option' options");
  assertStringIncludes(script, "compdef _zuke zuke ./zuke");
  // The colon in the description is escaped (it separates word from doc), the
  // single quotes are `'\''`-escaped, and the newline collapsed to a space.
  assertStringIncludes(script, "deploy:Ship\\: to '\\''prod'\\'' now");
  assertEquals(script.includes("hidden"), false);
});

Deno.test("fish completion emits per-word complete lines, escaped", () => {
  const script = formatCompletions("fish", targets, params);
  assertStringIncludes(script, "complete -c zuke -f");
  assertStringIncludes(
    script,
    "complete -c zuke -n __fish_use_subcommand -a deploy -d ",
  );
  assertStringIncludes(
    script,
    "complete -c zuke -n __fish_use_subcommand -a graph -d ",
  );
  // Flags drop their leading `--` for fish's `-l`.
  assertStringIncludes(script, "complete -c zuke -l list -d ");
  assertStringIncludes(script, "complete -c zuke -l dry-mode -d ");
  // Fish escapes single quotes with a backslash inside the quoted description.
  assertStringIncludes(script, "Ship: to \\'prod\\' now");
  assertEquals(script.includes("hidden"), false);
});

Deno.test("formatCompletions defaults to no parameters", () => {
  // Called without a params map, the built-in flags still appear.
  const script = formatCompletions("bash", targets);
  assertStringIncludes(script, "--list");
  assertEquals(script.includes("--dry-mode"), false);
});

Deno.test("every shared command and flag is completed (no drift)", () => {
  // Completion derives its command/flag set from cli_spec, so adding one there
  // surfaces it here automatically — nothing to keep in sync by hand.
  for (const shell of COMPLETION_SHELLS) {
    const script = formatCompletions(shell, targets, params);
    for (const c of RESERVED_COMMANDS) assertStringIncludes(script, c.name);
    // fish renders `--list` as `-l list`, so match on the dash-stripped name,
    // which is present in every shell's script.
    for (const f of BUILTIN_FLAGS) {
      assertStringIncludes(script, f.name.replace(/^--/, ""));
    }
  }
});
