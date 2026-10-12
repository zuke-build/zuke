// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { SignPathDownloadSettings, SignPathSubmitSettings } from "../mod.ts";

Deno.test("limits: a NaN, negative or zero bound is refused, not silently disabled", () => {
  // Regression (adversarial review): a NaN size cap let any download through.
  const settings = new SignPathDownloadSettings();
  assertThrows(() => settings.maxDownloadBytes(NaN), Error, "maxDownloadBytes");
  assertThrows(() => settings.maxDownloadBytes(0), Error, "at least 1");
  assertThrows(() => settings.retries(-1), Error, "retries");
  assertThrows(() => settings.retries(1.5), Error, "retries");
  assertThrows(() => settings.requestTimeout(0), Error, "requestTimeout");
  assertThrows(() => settings.downloadTimeout("0s"), Error, "downloadTimeout");
  const submit = new SignPathSubmitSettings();
  assertThrows(() => submit.pollInterval(0), Error, "pollInterval");
  assertThrows(() => submit.pollInterval("500ms"), Error, "at least 1000");
  assertEquals(submit.timeout(0).timeout_, 0);
  assertEquals(settings.retries(0).retries_, 0);
  assertEquals(settings.maxDownloadBytes(1).maxDownloadBytes_, 1);
});
