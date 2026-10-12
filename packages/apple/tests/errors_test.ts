// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  CommandError,
  CommandOutput,
  CommandTimeoutError,
} from "@zuke/core/shell";
import { KeychainCleanupError, NotarizationError } from "../src/errors.ts";
import type { NotarytoolIssue } from "../src/notarytool_result.ts";
import { maskSecrets, runMasked } from "../src/secrets.ts";
import { printable } from "../src/text.ts";
import { operand } from "../src/operand.ts";
import { rejection } from "./_fake_tool.ts";

Deno.test("a notarization error without a log says how to read it", () => {
  const error = new NotarizationError({ id: "abc" }, undefined);
  assertEquals(
    error.message,
    'Notarization of submission abc finished with status "unknown".\n' +
      "  The notarization log could not be fetched; run " +
      "NotarytoolTasks.log with this submission id to read it.",
  );
  assertEquals(error.name, "NotarizationError");
});

Deno.test("a notarization error lists at most twenty issues, defaulting missing fields", () => {
  const issues: NotarytoolIssue[] = Array.from({ length: 22 }, () => ({}));
  const error = new NotarizationError(
    { id: "abc", status: "Invalid", message: "Processing complete" },
    { issues, text: "" },
  );
  const lines = error.message.split("\n");
  assertEquals(
    lines[0],
    'Notarization of submission abc finished with status "Invalid": ' +
      "Processing complete",
  );
  assertEquals(lines[1], "  - issue: (no message)");
  assertEquals(lines.length, 22);
  assertEquals(lines[21], "  … and 2 more issue(s) in the log.");
});

Deno.test("a hostile log cannot inject lines or escapes into the message", () => {
  const error = new NotarizationError(
    { id: "abc\n[ok] forged", status: "Invalid\u001b[2J" },
    {
      statusSummary: "summary\r\nPASS",
      issues: [{
        severity: "error",
        path: "a\nb",
        architecture: "arm64\u0007",
        message: "x".repeat(600),
      }],
      text: "",
    },
  );
  assertEquals(error.message.includes("\u001b"), false);
  assertEquals(error.message.includes("\u0007"), false);
  assertEquals(error.message.split("\n").length, 3);
  assertStringIncludes(error.message, "abc [ok] forged");
  assertStringIncludes(error.message, "summary PASS");
  assertStringIncludes(
    error.message,
    `error: a b (arm64): ${"x".repeat(500)}…`,
  );
});

Deno.test("printable collapses control characters and trims", () => {
  assertEquals(printable("  a\u0000\u0001b\u009bc  "), "a b c");
  assertEquals(printable("x".repeat(500)), "x".repeat(500));
  // Regression: bidi overrides could reorder what the terminal shows.
  assertEquals(printable("a\u202eb\u2066c\u200fd"), "a b c d");
  // Regression (finding 7): line and paragraph separators and the Arabic
  // letter mark were let through.
  assertEquals(printable("a\u2028b\u2029c\u061cd"), "a b c d");
});

Deno.test("operand only rewrites what getopt would read as an option", () => {
  assertEquals(operand("-x"), "./-x");
  assertEquals(operand("a-x"), "a-x");
  assertEquals(operand("/abs/-x"), "/abs/-x");
});

Deno.test("a keychain cleanup error lists each failed step", () => {
  const error = new KeychainCleanupError([
    { step: "delete the keychain", message: "busy" },
  ]);
  assertEquals(
    error.message,
    "Cleaning up the temporary keychain failed:\n  - delete the keychain: busy",
  );
  assertEquals(error.name, "KeychainCleanupError");
  assertEquals("cause" in error, false);
});

Deno.test("maskSecrets replaces every secret, ignoring empty ones", () => {
  assertEquals(
    maskSecrets("a pw b pw", ["pw", ""]),
    "a [redacted] b [redacted]",
  );
});

Deno.test("runMasked masks a CommandError and a timeout, and passes others through", async () => {
  const failed = await rejection(
    () =>
      runMasked(
        () => Promise.reject(new CommandError("x -p pw", 1, "bad pw")),
        ["pw"],
      ),
    CommandError,
  );
  assertEquals(failed.command, "x -p [redacted]");
  assertEquals(failed.stderr, "bad [redacted]");
  assertEquals(failed.code, 1);

  const timedOut = await rejection(
    () =>
      runMasked(
        () => Promise.reject(new CommandTimeoutError("x -p pw", 5)),
        ["pw"],
      ),
    CommandTimeoutError,
  );
  assertEquals(timedOut.command, "x -p [redacted]");
  assertEquals(timedOut.timeoutMs, 5);

  const other = new TypeError("other");
  const passed = await rejection(
    () => runMasked(() => Promise.reject(other), ["pw"]),
    TypeError,
  );
  assertEquals(passed === other, true);

  const output = new CommandOutput(0, "ok", "");
  assertEquals(await runMasked(() => Promise.resolve(output), []), output);
  await assertRejects(() => Promise.reject(new Error("sanity")), Error);
});
