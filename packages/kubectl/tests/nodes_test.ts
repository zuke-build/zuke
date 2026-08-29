// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import {
  KubectlCordonSettings,
  KubectlDrainSettings,
  KubectlTaintSettings,
} from "../mod.ts";

Deno.test("cordon and uncordon are the same command with a different verb", () => {
  assertEquals(
    new KubectlCordonSettings().node("worker-1").argv().slice(1),
    ["cordon", "worker-1"],
  );
  assertEquals(
    new KubectlCordonSettings().node("worker-1").uncordon().argv().slice(1),
    ["uncordon", "worker-1"],
  );
  assertEquals(
    new KubectlCordonSettings().selector("role=spot").dryRun("server").argv()
      .slice(1),
    ["cordon", "-l", "role=spot", "--dry-run=server"],
  );
  // The refusal names the verb the caller actually asked for.
  assertThrows(
    () => new KubectlCordonSettings().argv(),
    Error,
    "KubectlTasks.cordon: name a node with .node(...)",
  );
  assertThrows(
    () => new KubectlCordonSettings().uncordon().argv(),
    Error,
    "KubectlTasks.uncordon: name a node with .node(...)",
  );
  // kubectl refuses a node name alongside a selector: "cannot specify both a
  // node name and a --selector option".
  assertThrows(
    () => new KubectlCordonSettings().node("w1").selector("role=spot").argv(),
    Error,
    "KubectlTasks.cordon: .node(...) names one node and .selector(...)",
  );
  assertThrows(
    () => new KubectlDrainSettings().node("w1").selector("role=spot").argv(),
    Error,
    "KubectlTasks.drain: .node(...) names one node and .selector(...)",
  );
});

Deno.test("drain renders every override it needs to proceed", () => {
  assertEquals(
    new KubectlDrainSettings()
      .node("worker-1")
      .force()
      .ignoreDaemonSets()
      .deleteEmptyDirData()
      .disableEviction()
      .gracePeriod(30)
      .timeout("5m")
      .podSelector("app!=critical")
      .skipWaitForDeleteTimeout(60)
      .argv()
      .slice(1),
    [
      "drain",
      "worker-1",
      "--force",
      "--ignore-daemonsets",
      "--delete-emptydir-data",
      "--disable-eviction",
      "--grace-period=30",
      "--timeout=5m",
      "--pod-selector=app!=critical",
      "--skip-wait-for-delete-timeout=60",
    ],
  );
  assertEquals(
    new KubectlDrainSettings().selector("role=spot").dryRun().argv().slice(1),
    ["drain", "-l", "role=spot", "--dry-run=client"],
  );
  assertThrows(
    () => new KubectlDrainSettings().argv(),
    Error,
    "KubectlTasks.drain: name a node with .node(...)",
  );
});

Deno.test("taint adds and removes in kubectl's own spelling", () => {
  assertEquals(
    new KubectlTaintSettings().node("worker-1").taint(
      "dedicated",
      "batch",
      "NoSchedule",
    ).overwrite().argv().slice(1),
    ["taint", "node", "worker-1", "dedicated=batch:NoSchedule", "--overwrite"],
  );
  // kubectl spells a removal with a trailing dash, with or without the effect.
  assertEquals(
    new KubectlTaintSettings().node("worker-1").removeTaint("dedicated").argv()
      .slice(1),
    ["taint", "node", "worker-1", "dedicated-"],
  );
  assertEquals(
    new KubectlTaintSettings().node("worker-1").removeTaint(
      "dedicated",
      "NoSchedule",
    ).argv().slice(1),
    ["taint", "node", "worker-1", "dedicated:NoSchedule-"],
  );
  assertEquals(
    new KubectlTaintSettings().all().taint("maintenance", "on", "NoExecute")
      .argv().slice(1),
    ["taint", "node", "--all", "maintenance=on:NoExecute"],
  );
  assertEquals(
    new KubectlTaintSettings().selector("role=spot").taint(
      "spot",
      "true",
      "PreferNoSchedule",
    ).dryRun("server").argv().slice(1),
    [
      "taint",
      "node",
      "spot=true:PreferNoSchedule",
      "-l",
      "role=spot",
      "--dry-run=server",
    ],
  );
});

Deno.test("taint insists on both a taint and something to taint", () => {
  assertThrows(
    () => new KubectlTaintSettings().node("worker-1").argv(),
    Error,
    "KubectlTasks.taint: .taint(...) or .removeTaint(...) is required",
  );
  assertThrows(
    () => new KubectlTaintSettings().taint("a", "b", "NoSchedule").argv(),
    Error,
    "KubectlTasks.taint: name a node with .node(...)",
  );
  assertThrows(
    () =>
      new KubectlTaintSettings().node("w1").all().taint("a", "b", "NoSchedule")
        .argv(),
    Error,
    "KubectlTasks.taint: .node(...) names nodes and .all() takes every one",
  );
});
