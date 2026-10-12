// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { NotarytoolOutputError } from "../src/errors.ts";
import {
  parseHistory,
  parseLog,
  parseSubmission,
} from "../src/notarytool_result.ts";

const ID = "2efe2717-52ef-43a5-96dc-0797e4ca1041";

Deno.test("parseSubmission reads an accepted result", () => {
  assertEquals(
    parseSubmission(
      JSON.stringify({
        id: ID,
        status: "Accepted",
        message: "Processing complete",
        name: "a.zip",
        createdDate: "2026-10-12T10:00:00.000Z",
      }),
      "submit",
    ),
    {
      id: ID,
      status: "Accepted",
      message: "Processing complete",
      name: "a.zip",
      createdDate: "2026-10-12T10:00:00.000Z",
    },
  );
});

Deno.test("parseSubmission finds the JSON after progress lines", () => {
  const out = "Conducting pre-submission checks...\n" +
    "Submission ID received\n" +
    JSON.stringify({ id: ID, status: "Invalid", message: "done" });
  assertEquals(parseSubmission(out, "submit").status, "Invalid");
});

Deno.test("parseSubmission reads wrong-typed fields as absent", () => {
  assertEquals(
    parseSubmission(
      JSON.stringify({ id: ID, status: 4000, message: null, name: ["x"] }),
      "info",
    ),
    { id: ID },
  );
});

Deno.test("parseSubmission refuses output with no JSON object, keeping the raw text", () => {
  for (const out of ["", "Error: HTTP 401", "[1,2]", "null", '"text"']) {
    const error = assertThrows(
      () => parseSubmission(out, "submit"),
      NotarytoolOutputError,
      "notarytool submit printed no JSON result",
    );
    assertEquals(error.message.includes("HTTP 401"), false);
  }
});

Deno.test("parseSubmission refuses a result without an id", () => {
  for (const out of ['{"status":"Accepted"}', '{"id":""}', '{"id":7}']) {
    assertThrows(
      () => parseSubmission(out, "info"),
      NotarytoolOutputError,
      "notarytool info printed JSON without a submission id",
    );
  }
});

Deno.test("parseHistory keeps the entries with an id", () => {
  assertEquals(
    parseHistory(JSON.stringify({
      history: [
        { id: "a", status: "Accepted" },
        "not an object",
        { status: "no id" },
        null,
        { id: "b", name: "b.zip" },
      ],
    })),
    [{ id: "a", status: "Accepted" }, { id: "b", name: "b.zip" }],
  );
  assertEquals(parseHistory('{"history":"nope"}'), []);
  assertThrows(() => parseHistory("nope"), NotarytoolOutputError, "history");
});

Deno.test("parseLog reads the summary and every issue object", () => {
  const text = JSON.stringify({
    jobId: ID,
    status: "Invalid",
    statusSummary: "Archive contains critical validation errors",
    issues: [
      {
        severity: "error",
        message: "The binary is not signed.",
        path: "a.zip/a",
        architecture: "x86_64",
        docUrl: "https://developer.apple.com/x",
        code: null,
      },
      "junk",
      {},
    ],
  });
  const log = parseLog(text);
  assertEquals(log.jobId, ID);
  assertEquals(log.status, "Invalid");
  assertEquals(log.text, text);
  assertEquals(log.issues, [
    {
      severity: "error",
      message: "The binary is not signed.",
      path: "a.zip/a",
      architecture: "x86_64",
      docUrl: "https://developer.apple.com/x",
    },
    {},
  ]);
  assertEquals(parseLog("{}").issues, []);
  assertStringIncludes(
    assertThrows(() => parseLog(""), NotarytoolOutputError).message,
    "notarytool log",
  );
});
