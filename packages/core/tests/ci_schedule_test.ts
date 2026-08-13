// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the timezone-aware cron compiler: UTC-passthrough, fixed-offset
 * and DST shifting, the friendly-error boundaries, and the generated guard shell.
 */

import { assertEquals, assertStringIncludes, assertThrows } from "./_assert.ts";
import {
  anyScheduleNeedsGuard,
  guardShell,
  scheduleNeedsGuard,
  utcCronsFor,
} from "../src/ci_schedule.ts";

Deno.test("utcCronsFor passes a UTC cron through, normalising whitespace", () => {
  assertEquals(utcCronsFor({ cron: "30  9 * * *" }), ["30 9 * * *"]);
  assertEquals(utcCronsFor({ cron: "0 6 * * *", tz: "UTC" }), ["0 6 * * *"]);
});

Deno.test("utcCronsFor shifts a fixed-offset zone to one UTC cron", () => {
  // Etc/GMT-2 is UTC+2 (POSIX sign inversion), no DST — one cron, no guard.
  assertEquals(utcCronsFor({ cron: "0 6 * * *", tz: "Etc/GMT-2" }), [
    "0 4 * * *",
  ]);
  assertEquals(
    scheduleNeedsGuard({ cron: "0 6 * * *", tz: "Etc/GMT-2" }),
    false,
  );
});

Deno.test("utcCronsFor expands ranges and shifts", () => {
  assertEquals(
    utcCronsFor({ cron: "0 8-9 * * *", tz: "Etc/GMT-2" }),
    ["0 6,7 * * *"],
  );
});

Deno.test("utcCronsFor emits two crons for a DST zone, preserving the day field", () => {
  // Europe/Sofia is +2 (winter) / +3 (summer); 9/13/15 local, Mon-Thu.
  const crons = utcCronsFor({ cron: "30 9,13,15 * * 1-4", tz: "Europe/Sofia" });
  assertEquals(crons.length, 2);
  assertEquals(crons.includes("30 7,11,13 * * 1,2,3,4"), true); // +2
  assertEquals(crons.includes("30 6,10,12 * * 1,2,3,4"), true); // +3
  assertEquals(
    scheduleNeedsGuard({ cron: "30 9 * * *", tz: "Europe/Sofia" }),
    true,
  );
});

Deno.test("utcCronsFor expands an open-ended step but not a bare number", () => {
  // `9/4` is every 4 hours from 9 (9,13,17,21), then shifted -2 for Etc/GMT-2.
  assertEquals(
    utcCronsFor({ cron: "0 9/4 * * *", tz: "Etc/GMT-2" }),
    ["0 7,11,15,19 * * *"],
  );
  // A bare `9` stays a single value.
  assertEquals(utcCronsFor({ cron: "0 9 * * *", tz: "Etc/GMT-2" }), [
    "0 7 * * *",
  ]);
});

Deno.test("utcCronsFor catches a sub-seasonal offset window (whole-year sampling)", () => {
  // Africa/Casablanca is +1 most of the year but drops to +0 during Ramadan —
  // a window neither a January nor a July sample would see.
  const crons = utcCronsFor({ cron: "0 12 * * *", tz: "Africa/Casablanca" });
  assertEquals(crons.length, 2);
  assertEquals(crons.includes("0 11 * * *"), true); // +1
  assertEquals(crons.includes("0 12 * * *"), true); // +0 (Ramadan)
  assertEquals(
    scheduleNeedsGuard({ cron: "0 12 * * *", tz: "Africa/Casablanca" }),
    true,
  );
});

Deno.test("guardShell rejects a timezone that is not a real IANA zone", () => {
  // A tz is interpolated into `TZ='<tz>'`; a non-IANA string (e.g. a shell-
  // injection attempt) is rejected rather than emitted into the guard script.
  assertThrows(
    () => guardShell([{ cron: "30 9 * * *", tz: "Europe/Sofia'; rm -rf / #" }]),
    Error,
    "unknown timezone",
  );
});

Deno.test("guardShell ORs day-of-month and day-of-week when both are set", () => {
  // Cron fires if EITHER the 1st-of-month OR a Monday matches, so the guard must
  // OR the two day tests (not AND them).
  const shell = guardShell([{ cron: "0 12 1 * 1", tz: "Europe/Sofia" }]);
  assertStringIncludes(shell, "|| ");
  assertStringIncludes(shell, "{ ");
});

Deno.test("utcCronsFor is deterministic across calls", () => {
  const a = utcCronsFor({ cron: "30 9 * * 1-4", tz: "Europe/Sofia" });
  const b = utcCronsFor({ cron: "30 9 * * 1-4", tz: "Europe/Sofia" });
  assertEquals(a, b);
});

Deno.test("utcCronsFor rejects the unsupported cases with a friendly error", () => {
  // A non-whole-hour zone.
  assertThrows(
    () => utcCronsFor({ cron: "30 9 * * *", tz: "Asia/Kolkata" }),
    Error,
    "non-whole-hour",
  );
  // A day-constrained schedule that crosses midnight once shifted to UTC.
  assertThrows(
    () => utcCronsFor({ cron: "30 1 * * 1", tz: "Europe/Sofia" }),
    Error,
    "day boundary",
  );
  // Malformed / out-of-range / unknown-zone inputs.
  assertThrows(() => utcCronsFor({ cron: "9 * * *" }), Error, "5 cron fields");
  assertThrows(
    () => utcCronsFor({ cron: "70 9 * * *" }),
    Error,
    "out of range",
  );
  assertThrows(
    () => utcCronsFor({ cron: "30 9 * * *", tz: "Mars/Olympus" }),
    Error,
    "unknown timezone",
  );
});

Deno.test("utcCronsFor expands a */step field over the whole range", () => {
  // `*/15` strides the full minute range, then the hour shifts for the zone.
  assertEquals(
    utcCronsFor({ cron: "*/15 9 * * *", tz: "Etc/GMT-2" }),
    ["0,15,30,45 7 * * *"],
  );
});

Deno.test("utcCronsFor rejects malformed step syntax with a friendly error", () => {
  // More than one slash in a field.
  assertThrows(
    () => utcCronsFor({ cron: "1/2/3 0 * * *" }),
    Error,
    "invalid cron field",
  );
  // A zero stride and a non-numeric stride are both named as bad steps.
  assertThrows(
    () => utcCronsFor({ cron: "*/0 0 * * *" }),
    Error,
    "invalid step in cron field",
  );
  assertThrows(
    () => utcCronsFor({ cron: "5/x 0 * * *" }),
    Error,
    "invalid step in cron field",
  );
});

Deno.test("utcCronsFor shifts an every-hour schedule without touching the days", () => {
  // With hour `*` the shift is a no-op: every hour maps to every hour, so the
  // day fields survive verbatim and no "crosses a day boundary" error can fire
  // even though day-of-month, month, and day-of-week are all constrained.
  assertEquals(
    utcCronsFor({ cron: "30 * 1,15 6 1", tz: "Etc/GMT-2" }),
    ["30 * 1,15 6 1"],
  );
});

Deno.test("guardShell renders a wildcard field as an always-true test", () => {
  // A `*` minute matches every wall-clock minute, so its membership test must
  // collapse to `true` rather than an empty case list that never matches.
  const shell = guardShell([{ cron: "* 9 * * *", tz: "Europe/Sofia" }]);
  assertStringIncludes(shell, "if true && ");
  assertStringIncludes(shell, 'case " 9 " in *" $hh "*)');
});

Deno.test("guardShell tests the month when the schedule restricts it", () => {
  const shell = guardShell([{ cron: "0 12 * 6 *", tz: "Europe/Sofia" }]);
  assertStringIncludes(shell, "TZ='Europe/Sofia' date +%m");
  assertStringIncludes(shell, 'case " 6 " in *" $mo "*)');
});

Deno.test("anyScheduleNeedsGuard is true only when a DST zone is present", () => {
  assertEquals(
    anyScheduleNeedsGuard([{ cron: "0 6 * * *" }, {
      cron: "0 6 * * *",
      tz: "Etc/GMT-2",
    }]),
    false,
  );
  assertEquals(
    anyScheduleNeedsGuard([{ cron: "0 6 * * *" }, {
      cron: "0 6 * * *",
      tz: "Europe/Sofia",
    }]),
    true,
  );
});

Deno.test("guardShell gates on the schedule event and checks the local wall-clock", () => {
  const shell = guardShell([{ cron: "30 9,13 * * 1-4", tz: "Europe/Sofia" }]);
  // Non-schedule events proceed unconditionally.
  assertStringIncludes(
    shell,
    'if [ "$GITHUB_EVENT_NAME" != "schedule" ]; then',
  );
  assertStringIncludes(shell, 'echo "run=true"');
  // The check reads the wall-clock in the entry's zone.
  assertStringIncludes(shell, "TZ='Europe/Sofia' date +%M");
  assertStringIncludes(shell, "TZ='Europe/Sofia' date +%H");
  // Minute, hour, and day-of-week membership are tested (Sunday %u=7 → cron 0).
  assertStringIncludes(shell, 'case " 30 " in *" $mm "*)');
  assertStringIncludes(shell, 'case " 9 13 " in *" $hh "*)');
  assertStringIncludes(shell, '[ "$dw" = 7 ] && dw=0');
  assertStringIncludes(shell, 'case " 1 2 3 4 " in *" $dw "*)');
  assertStringIncludes(shell, 'echo "run=$run"');
});
