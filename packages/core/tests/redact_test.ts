// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { REDACTED, Redactor } from "../src/redact.ts";
import { emitActionsMasks } from "../src/execute_output.ts";

Deno.test("Redactor masks a registered secret anywhere in a line", () => {
  const r = new Redactor();
  r.add("s3cr3t");
  assertEquals(
    r.redact("token=s3cr3t sent to s3cr3t-host"),
    `token=${REDACTED} sent to ${REDACTED}-host`,
  );
});

Deno.test("Redactor ignores empty strings and de-duplicates", () => {
  const r = new Redactor();
  r.add("");
  r.add("abc");
  r.add("abc");
  assertEquals(r.size, 1);
  // An empty secret must not turn every position into the placeholder.
  assertEquals(r.redact("nothing here"), "nothing here");
});

Deno.test("Redactor leaves lines without a secret untouched", () => {
  const r = new Redactor();
  r.add("hunter2");
  assertEquals(r.redact("plain output"), "plain output");
});

Deno.test("Redactor masks the longest overlapping secret whole", () => {
  const r = new Redactor();
  // Registered short-first, but a value containing another must still be
  // masked as one unit, not leave the outer part exposed.
  r.add("abc");
  r.add("abcdef");
  assertEquals(r.redact("value abcdef here"), `value ${REDACTED} here`);
});

Deno.test("Redactor treats regex-significant secrets literally", () => {
  const r = new Redactor();
  r.add("a.c*");
  assertEquals(r.redact("literal a.c* only"), `literal ${REDACTED} only`);
  // A line that would match the pattern as a regex, but does not contain it
  // literally, is left untouched.
  assertEquals(r.redact("nothing to mask"), "nothing to mask");
});

// A multi-line secret is the case a whole-value pattern cannot cover: redaction
// rewrites one line at a time, so the registered string matches no line of
// itself and every line after the first would print in the clear. The real-world
// shape is a private key reached through a secret parameter from a file source.
//
// The fixture deliberately does not look like one. All the behaviour depends on
// is that the value spans lines and that each line clears the length floor;
// markers and base64 would add nothing but a problem, since a realistic fixture
// matches gitleaks' private-key and generic-api-key rules — and that scan walks
// git history, so it fails every open pull request until the offending commit is
// rewritten, not merely reverted.
const MULTI_LINE = [
  "first-fragment-of-a-not-real-value",
  "second-fragment-of-a-not-real-value",
  "third-fragment-of-a-not-real-value",
].join("\n");

Deno.test("Redactor masks every line of a multi-line secret", () => {
  const r = new Redactor();
  r.add(MULTI_LINE);
  // Each line, alone on a line of output, is masked — including the ones after
  // the first, which an exact whole-value match would have missed entirely.
  for (const line of MULTI_LINE.split("\n")) {
    assertEquals(r.redact(line), REDACTED, `line not masked: ${line}`);
  }
  // And embedded in surrounding text, which is how it would actually surface.
  assertEquals(
    r.redact("body: second-fragment-of-a-not-real-value done"),
    `body: ${REDACTED} done`,
  );
});

Deno.test("Redactor still masks a multi-line secret that arrives intact", () => {
  const r = new Redactor();
  r.add(MULTI_LINE);
  assertEquals(r.redact(MULTI_LINE), REDACTED);
});

Deno.test("Redactor ignores indentation when masking a secret's line", () => {
  // Lines are trimmed before registering, so the pattern matches the content
  // whatever wraps it — a YAML block scalar indents every line of an inlined
  // key. Trimming only ever widens the match: the registered pattern is a
  // substring of the indented form, so both the indented and the bare
  // occurrence are found.
  const r = new Redactor();
  r.add("alpha\n    indented-fragment-of-a-not-real-value\nomega");
  assertEquals(
    r.redact("      indented-fragment-of-a-not-real-value"),
    `      ${REDACTED}`,
  );
  assertEquals(r.redact("indented-fragment-of-a-not-real-value"), REDACTED);
});

Deno.test("Redactor does not register a trivially short line as its own pattern", () => {
  // A two-character line would mask every `ok` in the log. The whole value is
  // still registered, so nothing is lost for output that contains it intact.
  const r = new Redactor();
  r.add("ok\nno");
  assertEquals(r.size, 1);
  assertEquals(r.redact("ok status: no problems"), "ok status: no problems");
});

// The other half of the multi-line problem, on the CI host's side. A runner
// reads `::add-mask::` to the end of the line, so emitting a multi-line value
// as one directive masks only its first line — and prints every line after it
// as ordinary log output. The call meant to protect the secret becomes the leak.
Deno.test("emitActionsMasks emits one single-line directive per secret line", () => {
  const lines: string[] = [];
  emitActionsMasks([MULTI_LINE], {
    info: (l) => void lines.push(l),
    error: () => {},
  });
  assertEquals(lines.length > 0, true);
  for (const line of lines) {
    assertStringIncludes(line, "::add-mask::");
    // No directive may span lines, or its tail is printed in the clear.
    assertEquals(line.includes("\n"), false, `multi-line directive: ${line}`);
  }
  // Every qualifying line of the key is covered, not just the first.
  const masked = lines.map((l) => l.slice("::add-mask::".length));
  for (const line of MULTI_LINE.split("\n")) {
    assertEquals(masked.includes(line), true, `line not masked: ${line}`);
  }
});

Deno.test("emitActionsMasks still emits a single-line secret unchanged", () => {
  const lines: string[] = [];
  emitActionsMasks(["hunter2"], {
    info: (l) => void lines.push(l),
    error: () => {},
  });
  assertEquals(lines, ["::add-mask::hunter2"]);
});
