// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the gate: the fluent rule builder, its human description, and the
 * trip decision.
 *
 * @module
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import { describeGate, GateSettings, gateTrips } from "../src/gate.ts";
import type { Assessment } from "../src/types.ts";

/** An assessment with a fixed score/severity and no findings. */
function assessed(score: number, severity: Assessment["severity"]): Assessment {
  return { score, severity, summary: "", findings: [] };
}

Deno.test("GateSettings collects rules in order", () => {
  const rules = new GateSettings().scoreAbove(8).severityAtLeast("high")
    .rules_();
  assertEquals(rules, [
    { kind: "score", value: 8 },
    { kind: "severity", value: "high" },
  ]);
});

Deno.test("describeGate names every rule, and no rules as none", () => {
  assertEquals(describeGate([]), "none");
  assertEquals(describeGate([{ kind: "score", value: 8 }]), "score>8");
  assertEquals(
    describeGate([
      { kind: "score", value: 8 },
      { kind: "severity", value: "high" },
    ]),
    "score>8, severity≥high",
  );
});

Deno.test("gateTrips fires on score strictly above and severity at least", () => {
  const rules = new GateSettings().scoreAbove(8).severityAtLeast("high")
    .rules_();
  // Score at the threshold does not trip — strictly above does.
  assertEquals(gateTrips(assessed(8, "low"), rules).tripped, false);
  assertEquals(gateTrips(assessed(9, "low"), rules), {
    tripped: true,
    reason: "risk score 9 exceeds 8",
  });
  // Severity at (and above) the threshold trips with the severity reason.
  assertEquals(gateTrips(assessed(0, "high"), rules), {
    tripped: true,
    reason: 'severity "high" is at least "high"',
  });
  assertEquals(gateTrips(assessed(0, "critical"), rules).tripped, true);
  assertEquals(gateTrips(assessed(0, "medium"), rules).tripped, false);
  // No rules: nothing can trip.
  assertEquals(gateTrips(assessed(10, "critical"), []), {
    tripped: false,
    reason: "",
  });
});
