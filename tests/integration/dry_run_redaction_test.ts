/**
 * Integration: a secret used as an argv token must not surface in a command
 * echo. Under `--dry-run` a `.dryRunnable()` target's body runs with `$` in echo
 * mode, so the resolved command line is printed — the one place a secret
 * parameter reaches Zuke's own output verbatim. Driven through the real CLI.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, REDACTED, target } from "../../packages/core/mod.ts";
import { $ } from "../../packages/core/src/shell.ts";
import { runCli } from "./_harness.ts";

// Deliberately unremarkable: the value has to be searchable in the captured
// output, but must not look like a real credential. A vendor-shaped, high-entropy
// fixture trips this repo's own gitleaks gate, and because that scan walks git
// history it then fails every open pull request, not just the one that added it.
const SECRET = "fake-not-a-real-token";

/**
 * Strip the `::add-mask::` directives from captured output.
 *
 * Under GitHub Actions the executor deliberately emits `::add-mask::` followed by
 * the *raw* secret through the un-redacted base reporter, so the runner censors
 * the value in its own logs — a redacted directive would mask nothing. That line
 * is the one sanctioned place the raw value appears, so it is removed here before
 * asserting the secret shows up nowhere else. Everything else stays in scope.
 */
function withoutMaskDirectives(output: string): string {
  return output
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("::add-mask::"))
    .join("\n");
}

class Deploy extends Build {
  token = parameter("Registry token").secret().required();
  push = target()
    .description("log in with the token")
    .dryRunnable()
    .executes(async () => {
      await $`docker login --username ci --password ${this.token.value}`;
    });
}

Deno.test("a dry-run command echo masks a secret argv token", async () => {
  const { code, out } = await runCli(Deploy, [
    "push",
    "--dry-run",
    "--token",
    SECRET,
  ]);
  assertEquals(code, 0);
  // The echo is there…
  assertStringIncludes(out, "docker login --username ci --password");
  // …with the secret masked, and the raw value nowhere in the output.
  assertStringIncludes(out, REDACTED);
  assertEquals(
    withoutMaskDirectives(out).includes(SECRET),
    false,
    `secret leaked:\n${out}`,
  );
});

Deno.test("a failing command's error message masks a secret argv token", async () => {
  // The command line also reaches output through CommandError, reported when the
  // target fails — the same argv, a different sink.
  class Fail extends Build {
    token = parameter("Registry token").secret().required();
    run = target().executes(async () => {
      await $`${Deno.execPath()} eval ${`Deno.exit(4)`} ${this.token.value}`
        .quiet();
    });
  }
  const { code, err } = await runCli(Fail, ["run", "--token", SECRET]);
  assertEquals(code, 1);
  assertStringIncludes(err, REDACTED);
  assertEquals(
    withoutMaskDirectives(err).includes(SECRET),
    false,
    `secret leaked:\n${err}`,
  );
});

// A multi-line secret is the case a whole-value match cannot cover. Redaction
// runs a line at a time, so a key registered only as one string matches no line
// of itself — masked on its header and printed in the clear from line two on.
// Shaped like a PEM (the `.secret().from(fileSecret(...))` pattern the docs
// invite) but deliberately not credential-like, for the gitleaks reason above.
const MULTILINE_SECRET = [
  "-----BEGIN FAKE TEST KEY-----",
  "line-one-not-a-real-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "line-two-not-a-real-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "-----END FAKE TEST KEY-----",
].join("\n");

Deno.test("every line of a multi-line secret is masked in a command echo", async () => {
  const { code, out } = await runCli(Deploy, [
    "push",
    "--dry-run",
    "--token",
    MULTILINE_SECRET,
  ]);
  assertEquals(code, 0);
  const body = withoutMaskDirectives(out);
  // No line of the key survives anywhere — the continuation lines are the ones
  // an exact whole-value match would have missed.
  for (const line of MULTILINE_SECRET.split("\n")) {
    assertEquals(
      body.includes(line),
      false,
      `secret line leaked: ${line}\n${out}`,
    );
  }
  assertStringIncludes(out, REDACTED);
});
