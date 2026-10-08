// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  GcloudMonitoringDashboardsListSettings,
  GcloudMonitoringPoliciesDescribeSettings,
  GcloudMonitoringPoliciesListSettings,
  GcloudMonitoringUptimeListConfigsSettings,
} from "../mod.ts";

// Run through Google Cloud SDK 588.0.0: all four commands are GA there, and
// each argv below parses.

Deno.test("monitoring policies list: every list flag, one token each", () => {
  assertEquals(
    new GcloudMonitoringPoliciesListSettings().filter("display_name:api")
      .limit(2).pageSize(5).sortBy("display_name", "~name").uri()
      .project("p").argv(),
    [
      "gcloud",
      "monitoring",
      "policies",
      "list",
      "--filter=display_name:api",
      "--limit=2",
      "--page-size=5",
      "--sort-by=display_name,~name",
      "--uri",
      "--project",
      "p",
    ],
  );
});

Deno.test("monitoring dashboards list and uptime list-configs", () => {
  assertEquals(new GcloudMonitoringDashboardsListSettings().argv(), [
    "gcloud",
    "monitoring",
    "dashboards",
    "list",
  ]);
  assertEquals(
    new GcloudMonitoringUptimeListConfigsSettings().filter("-x").argv(),
    ["gcloud", "monitoring", "uptime", "list-configs", "--filter=-x"],
  );
});

Deno.test("monitoring lists refuse a count gcloud would", () => {
  assertThrows(
    () => new GcloudMonitoringDashboardsListSettings().limit(1.5).argv(),
    Error,
    "GcloudTasks.monitoringDashboardsList: .limit(1.5) is not a count",
  );
  assertThrows(
    () => new GcloudMonitoringUptimeListConfigsSettings().pageSize(0).argv(),
    Error,
    "GcloudTasks.monitoringUptimeListConfigs: .pageSize(0) is not a count",
  );
  assertThrows(
    () => new GcloudMonitoringPoliciesListSettings().sortBy("a,b").argv(),
    Error,
    "joins its values with commas",
  );
});

Deno.test("monitoring policies describe: the policy is a guarded operand", () => {
  assertEquals(
    new GcloudMonitoringPoliciesDescribeSettings()
      .policy("projects/p/alertPolicies/1").argv(),
    [
      "gcloud",
      "monitoring",
      "policies",
      "describe",
      "projects/p/alertPolicies/1",
    ],
  );
  assertThrows(
    () => new GcloudMonitoringPoliciesDescribeSettings().argv(),
    Error,
    "no policy named",
  );
  assertThrows(
    () =>
      new GcloudMonitoringPoliciesDescribeSettings()
        .policy("--project=other").argv(),
    Error,
    "starts with '-'",
  );
});
