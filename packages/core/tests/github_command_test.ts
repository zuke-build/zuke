// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the GitHub Actions escapes.
 *
 * The runner acts on two syntaxes in a step's output, so anything a build does
 * not control — a subprocess's stderr, a fan-out item key, an actor from the
 * shared state store — could otherwise forge or suppress the runner's own
 * commands.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import {
  escapeData,
  escapeProperty,
  neutralizeWorkflowCommands,
} from "../src/github_command.ts";

Deno.test("escapeData encodes the line terminators that end a command", () => {
  assertEquals(escapeData("plain"), "plain");
  assertEquals(escapeData("a\nb"), "a%0Ab");
  assertEquals(escapeData("a\r\nb"), "a%0D%0Ab");
  // `%` first, so a literal `%0A` in the input cannot spoof the encoding.
  assertEquals(escapeData("already %0A encoded"), "already %250A encoded");
  // The attack it exists for: a command on a line of its own.
  assertEquals(
    escapeData("boom\n::stop-commands::TOKEN"),
    "boom%0A::stop-commands::TOKEN",
  );
});

Deno.test("escapeProperty also encodes the property separators", () => {
  assertEquals(escapeProperty("a:b,c"), "a%3Ab%2Cc");
  assertEquals(escapeProperty("a\nb"), "a%0Ab");
});

Deno.test("neutralize leaves ordinary output byte-identical", () => {
  // The point of not using escapeData here: a compiler dump keeps its lines,
  // its blank lines and its indentation, so it stays readable in the log.
  for (
    const text of [
      "plain output",
      "  indented, ordinary",
      "error at foo::bar",
      "multi\nline\n\n  dump",
      "",
      "100% done",
    ]
  ) {
    assertEquals(neutralizeWorkflowCommands(text), text);
  }
});

Deno.test("neutralize disarms a command at the start of a line", () => {
  assertEquals(
    neutralizeWorkflowCommands("::stop-commands::TOKEN"),
    "%3A%3Astop-commands::TOKEN",
  );
  // The runner trims leading whitespace before testing for `::`, so an indent
  // is not a mitigation — and the indent itself is preserved.
  assertEquals(
    neutralizeWorkflowCommands("  ::error::forged"),
    "  %3A%3Aerror::forged",
  );
  assertEquals(
    neutralizeWorkflowCommands("\t::error::forged"),
    "\t%3A%3Aerror::forged",
  );
  // An embedded newline is how a value smuggles a command onto its own line.
  assertEquals(
    neutralizeWorkflowCommands("boom\n::stop-commands::TOKEN"),
    "boom\n%3A%3Astop-commands::TOKEN",
  );
});

Deno.test("neutralize disarms the legacy form anywhere in a line", () => {
  // `##[command]` is recognised anywhere, not only at the start.
  assertEquals(
    neutralizeWorkflowCommands("log ##[command]hidden"),
    "log %23%23[command]hidden",
  );
  assertEquals(
    neutralizeWorkflowCommands("x ##[a] y ##[b]"),
    "x %23%23[a] y %23%23[b]",
  );
});
