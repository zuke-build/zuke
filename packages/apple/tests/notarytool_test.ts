// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError } from "@zuke/core/shell";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import {
  NotarytoolHistorySettings,
  NotarytoolInfoSettings,
  NotarytoolLogSettings,
  NotarytoolSubmitSettings,
  NotarytoolTasks,
} from "../src/notarytool.ts";
import { NotarizationError, NotarytoolOutputError } from "../src/errors.ts";
import { fakeNotarytool, rejection } from "./_fake_tool.ts";

const ID = "2efe2717-52ef-43a5-96dc-0797e4ca1041";
const KEY = ["--key", "AuthKey_ABC.p8", "--key-id", "ABC"];

/** A submit settings object with an API key, for argv tests. */
function submit(): NotarytoolSubmitSettings {
  return new NotarytoolSubmitSettings().key("AuthKey_ABC.p8").keyId("ABC");
}

Deno.test("notarytool submit: archive, wait, timeout, json, then the API key", () => {
  assertEquals(
    submit().issuer("ISSUER").file("dist/a.zip").wait().timeout("30m").argv(),
    [
      "xcrun",
      "notarytool",
      "submit",
      "dist/a.zip",
      "--wait",
      "--timeout",
      "30m",
      "--output-format",
      "json",
      ...KEY,
      "--issuer",
      "ISSUER",
    ],
  );
});

Deno.test("notarytool submit: the json output format is always pinned", () => {
  assertEquals(submit().file("a.zip").argv().slice(1), [
    "notarytool",
    "submit",
    "a.zip",
    "--output-format",
    "json",
    ...KEY,
  ]);
});

Deno.test("notarytool submit: an archive named like a flag stays an operand", () => {
  assertEquals(submit().file("--wait").argv()[3], "./--wait");
});

Deno.test("notarytool submit: no archive, or a timeout without wait, is refused", () => {
  assertThrows(() => submit().argv(), Error, "no archive");
  assertThrows(
    () => submit().file("a.zip").timeout("1h").argv(),
    Error,
    "needs .wait()",
  );
});

Deno.test("notarytool: a keychain profile authenticates, optionally from a keychain", () => {
  assertEquals(
    new NotarytoolHistorySettings().keychainProfile("ci").argv().slice(1),
    [
      "notarytool",
      "history",
      "--output-format",
      "json",
      "--keychain-profile",
      "ci",
    ],
  );
  assertEquals(
    new NotarytoolHistorySettings().keychainProfile("ci").keychain("k.db")
      .argv().slice(5),
    ["--keychain-profile", "ci", "--keychain", "k.db"],
  );
});

Deno.test("notarytool: an Apple ID needs its password and team", () => {
  assertEquals(
    new NotarytoolHistorySettings().appleId("me@example.com").password("pw")
      .teamId("TEAM").argv().slice(5),
    ["--apple-id", "me@example.com", "--password", "pw", "--team-id", "TEAM"],
  );
  assertThrows(
    () => new NotarytoolHistorySettings().appleId("me@example.com").argv(),
    Error,
    "Apple ID authentication needs",
  );
});

Deno.test("notarytool: credentials must be exactly one route", () => {
  assertThrows(
    () => new NotarytoolHistorySettings().argv(),
    Error,
    "no credentials",
  );
  assertThrows(
    () =>
      new NotarytoolHistorySettings().keyId("A").keychainProfile("p").argv(),
    Error,
    "mixed credentials",
  );
  assertThrows(
    () => new NotarytoolHistorySettings().issuer("I").argv(),
    Error,
    "needs both .key(p8Path) and .keyId(id)",
  );
  assertThrows(
    () => new NotarytoolHistorySettings().key("k.p8").keychain("k.db").argv(),
    Error,
    "needs .keychainProfile(name)",
  );
});

Deno.test("notarytool info and log: the submission id is required and cannot be a flag", () => {
  assertEquals(
    new NotarytoolInfoSettings().keychainProfile("p").submissionId(ID).argv()
      .slice(1),
    [
      "notarytool",
      "info",
      ID,
      "--output-format",
      "json",
      "--keychain-profile",
      "p",
    ],
  );
  assertEquals(
    new NotarytoolLogSettings().keychainProfile("p").submissionId(ID).argv()
      .slice(1),
    ["notarytool", "log", ID, "--keychain-profile", "p"],
  );
  assertThrows(
    () => new NotarytoolInfoSettings().keychainProfile("p").argv(),
    Error,
    "no submission id",
  );
  assertThrows(
    () =>
      new NotarytoolLogSettings().keychainProfile("p").submissionId("")
        .argv(),
    Error,
    "no submission id",
  );
  assertThrows(
    () =>
      new NotarytoolLogSettings().keychainProfile("p")
        .submissionId("--keychain-profile").argv(),
    Error,
    'starts with "-"',
  );
});

Deno.test("logFor carries the credentials, binary, env and cwd", () => {
  const log = submit().issuer("I").toolPath("/opt/xcrun").cwd("/w")
    .env({ DEVELOPER_DIR: "/x" }).file("a.zip").logFor(ID);
  assertEquals(log.argv(), [
    "/opt/xcrun",
    "notarytool",
    "log",
    ID,
    ...KEY,
    "--issuer",
    "I",
  ]);
});

Deno.test("submit waits only when asked", () => {
  assertEquals(submit().waits, false);
  assertEquals(submit().wait().waits, true);
});

Deno.test("NotarytoolTasks reach execution", async () => {
  await assertRejects(
    () =>
      NotarytoolTasks.submit((s) =>
        missingTool(s).keychainProfile("p").file("a")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      NotarytoolTasks.info((s) =>
        missingTool(s).keychainProfile("p").submissionId(ID)
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      NotarytoolTasks.log((s) =>
        missingTool(s).keychainProfile("p").submissionId(ID)
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () => NotarytoolTasks.history((s) => missingTool(s).keychainProfile("p")),
    ToolNotFoundError,
  );
});

Deno.test("notarytool wrappers resolve xcrun from PATH", async () => {
  const makers = [
    () => submit().file("a.zip"),
    () => new NotarytoolInfoSettings().keychainProfile("p").submissionId(ID),
    () => new NotarytoolLogSettings().keychainProfile("p").submissionId(ID),
    () => new NotarytoolHistorySettings().keychainProfile("p"),
  ];
  for (const make of makers) {
    await assertWrapperConformance(make, "xcrun", { resolution: "path" });
  }
});

/** Run `fn` against a fake notarytool in a temp dir, then remove it. */
async function withFake(
  responses: Parameters<typeof fakeNotarytool>[0],
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fakeNotarytool(responses);
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const ACCEPTED = JSON.stringify({
  id: ID,
  status: "Accepted",
  message: "Processing complete",
});
const INVALID = JSON.stringify({
  id: ID,
  status: "Invalid",
  message: "Processing complete",
});
const LOG = JSON.stringify({
  jobId: ID,
  status: "Invalid",
  statusSummary: "Archive contains critical validation errors",
  issues: [{
    severity: "error",
    path: "a.zip/a.app/Contents/MacOS/a",
    message: "The binary is not signed with a valid Developer ID certificate.",
    architecture: "arm64",
  }],
});

Deno.test("submit with wait returns an accepted submission", async () => {
  await withFake(
    { submit: { stdout: ACCEPTED, needs: ["--wait"] } },
    async (dir) => {
      const result = await NotarytoolTasks.submit((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
          .keychainProfile("p").wait()
      );
      assertEquals(result, {
        id: ID,
        status: "Accepted",
        message: "Processing complete",
      });
    },
  );
});

Deno.test("submit without wait returns the upload, which has no status", async () => {
  const uploaded = JSON.stringify({
    id: ID,
    path: "/w/a.zip",
    message: "Successfully uploaded file",
  });
  await withFake({ submit: { stdout: uploaded } }, async (dir) => {
    const result = await NotarytoolTasks.submit((s) =>
      s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
        .keychainProfile("p")
    );
    assertEquals(result.status, undefined);
    assertEquals(result.message, "Successfully uploaded file");
  });
});

Deno.test("a rejected submission fetches its log with the same credentials and throws", async () => {
  await withFake({
    // notarytool exits non-zero for an invalid submission; the JSON still wins.
    submit: { stdout: INVALID, code: 1 },
    log: { stdout: LOG, needs: [ID, ...KEY] },
  }, async (dir) => {
    const error = await rejection(
      () =>
        NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
            .key("AuthKey_ABC.p8").keyId("ABC").wait()
        ),
      NotarizationError,
    );
    assertEquals(error.submission.status, "Invalid");
    assertEquals(error.log?.issues.length, 1);
    assertStringIncludes(error.message, 'status "Invalid"');
    assertStringIncludes(
      error.message,
      "Archive contains critical validation errors",
    );
    assertStringIncludes(
      error.message,
      "error: a.zip/a.app/Contents/MacOS/a (arm64): The binary is not signed",
    );
  });
});

Deno.test("a rejected submission still throws when its log cannot be fetched", async () => {
  await withFake({
    submit: { stdout: INVALID },
    log: { stderr: "boom", code: 1 },
  }, async (dir) => {
    const error = await rejection(
      () =>
        NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
            .keychainProfile("p").wait()
        ),
      NotarizationError,
    );
    assertEquals(error.log, undefined);
    assertStringIncludes(error.message, "could not be fetched");
  });
});

Deno.test("noThrow returns a rejected submission for the caller to inspect", async () => {
  await withFake({ submit: { stdout: INVALID, code: 1 } }, async (dir) => {
    const result = await NotarytoolTasks.submit((s) =>
      s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
        .keychainProfile("p").wait().noThrow()
    );
    assertEquals(result.status, "Invalid");
  });
});

Deno.test("submit output that is not a result is refused, with the raw text on the error", async () => {
  await withFake(
    { submit: { stdout: "Error: something odd" } },
    async (dir) => {
      const error = await rejection(
        () =>
          NotarytoolTasks.submit((s) =>
            s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
              .keychainProfile("p")
          ),
        NotarytoolOutputError,
      );
      assertEquals(error.stdout.trim(), "Error: something odd");
    },
  );
});

Deno.test("a failed submit with no result is a CommandError with the password masked", async () => {
  const password = "app-specific-password-one";
  await withFake({
    submit: { stderr: `HTTP 401 for password ${password}`, code: 2 },
  }, async (dir) => {
    const error = await rejection(
      () =>
        NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
            .appleId("me@example.com").password(password).teamId("TEAM")
        ),
      CommandError,
    );
    assertEquals(error.code, 2);
    assertEquals(error.message.includes(password), false);
    assertStringIncludes(error.message, "--password [redacted]");
    assertStringIncludes(error.stderr, "[redacted]");
  });
});

Deno.test("a failed info run is a CommandError with the password masked", async () => {
  const password = "app-specific-password-two";
  await withFake({ info: { code: 1 } }, async (dir) => {
    const error = await rejection(
      () =>
        NotarytoolTasks.info((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).quiet().submissionId(ID)
            .appleId("me@example.com").password(password).teamId("TEAM")
        ),
      CommandError,
    );
    assertEquals(error.message.includes(password), false);
  });
});

Deno.test("info, log and history parse their JSON", async () => {
  const info = JSON.stringify({
    id: ID,
    status: "In Progress",
    name: "a.zip",
    createdDate: "2026-10-12T10:00:00.000Z",
    message: "Successfully received submission info",
  });
  const history = JSON.stringify({
    message: "Successfully received submission history.",
    history: [{ id: ID, status: "Accepted", name: "a.zip" }],
  });
  await withFake({
    info: { stdout: info, needs: [ID] },
    log: { stdout: LOG },
    history: { stdout: history },
  }, async (dir) => {
    const read = await NotarytoolTasks.info((s) =>
      s.toolPath(Deno.execPath()).cwd(dir).quiet().keychainProfile("p")
        .submissionId(ID)
    );
    assertEquals(read.status, "In Progress");
    assertEquals(read.name, "a.zip");
    const log = await NotarytoolTasks.log((s) =>
      s.toolPath(Deno.execPath()).cwd(dir).quiet().keychainProfile("p")
        .submissionId(ID)
    );
    assertEquals(
      log.statusSummary,
      "Archive contains critical validation errors",
    );
    const past = await NotarytoolTasks.history((s) =>
      s.toolPath(Deno.execPath()).cwd(dir).quiet().keychainProfile("p")
    );
    assertEquals(past, [{ id: ID, status: "Accepted", name: "a.zip" }]);
  });
});

Deno.test("with wait, every status but exactly Accepted is a NotarizationError", async () => {
  // Regression (finding 2): the check must fail closed — a status it does not
  // know, a missing one, or a differently cased "accepted" is not acceptance.
  const results = [
    { id: ID, status: "Rejected", message: "done" },
    { id: ID, status: "In Progress", message: "timed out waiting" },
    { id: ID, message: "no status at all" },
    { id: ID, status: "accepted", message: "lower case" },
  ];
  for (const result of results) {
    await withFake({
      submit: { stdout: JSON.stringify(result) },
      log: { code: 1 },
    }, async (dir) => {
      const error = await rejection(
        () =>
          NotarytoolTasks.submit((s) =>
            s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
              .keychainProfile("p").wait()
          ),
        NotarizationError,
      );
      assertEquals(error.submission.message, result.message);
    });
  }
});

Deno.test("a non-zero exit fails the submit even when it printed a result", async () => {
  // Regression (finding 3): an upload that failed after its id was issued, and
  // an accepted result from a run that still failed, used to pass.
  const failedUpload = JSON.stringify({
    id: ID,
    message: "Error: upload failed",
  });
  await withFake(
    { submit: { stdout: failedUpload, code: 69 } },
    async (dir) => {
      const error = await rejection(
        () =>
          NotarytoolTasks.submit((s) =>
            s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
              .keychainProfile("p")
          ),
        CommandError,
      );
      assertEquals(error.code, 69);
      // Under noThrow the result is handed back for the caller to judge.
      const result = await NotarytoolTasks.submit((s) =>
        s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
          .keychainProfile("p").noThrow()
      );
      assertEquals(result.message, "Error: upload failed");
    },
  );
  await withFake({ submit: { stdout: ACCEPTED, code: 1 } }, async (dir) => {
    const error = await rejection(
      () =>
        NotarytoolTasks.submit((s) =>
          s.toolPath(Deno.execPath()).cwd(dir).quiet().file("a.zip")
            .keychainProfile("p").wait()
        ),
      CommandError,
    );
    assertEquals(error.code, 1);
  });
});
