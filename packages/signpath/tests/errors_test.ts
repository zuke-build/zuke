// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  SignPathApiError,
  SignPathRequestError,
  SignPathSigningError,
  SignPathTimeoutError,
  SignPathValidationError,
} from "../mod.ts";
import { REQUEST, WEB_URL } from "./_fetch.ts";

Deno.test("errors: each names what failed and how to find it", () => {
  const api = new SignPathApiError("GET", "/v1/o/x", 401, undefined);
  assertEquals(api.message, "SignPath GET /v1/o/x failed: HTTP 401");
  assertEquals(api.name, "SignPathApiError");
  const request = new SignPathRequestError("POST", "/v1/o/x", "timed out");
  assertEquals(request.message, "SignPath POST /v1/o/x failed: timed out");
  assertEquals([request.name, request.method, request.path], [
    "SignPathRequestError",
    "POST",
    "/v1/o/x",
  ]);
  const signing = new SignPathSigningError(
    REQUEST,
    "Denied",
    undefined,
    WEB_URL,
  );
  assertEquals(
    signing.message,
    `SignPath signing request ${REQUEST} ended Denied instead of Completed — see ${WEB_URL}`,
  );
  assertEquals(signing.name, "SignPathSigningError");
  const timeout = new SignPathTimeoutError(REQUEST, "InProgress", 5, WEB_URL);
  assertEquals([timeout.name, timeout.status, timeout.webUrl], [
    "SignPathTimeoutError",
    "InProgress",
    WEB_URL,
  ]);
  const validation = new SignPathValidationError([
    { error: "a", howToFix: undefined },
  ]);
  assertEquals(validation.name, "SignPathValidationError");
  assertEquals(validation.message.endsWith("\n  - a"), true);
});
