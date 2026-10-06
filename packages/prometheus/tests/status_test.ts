// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** Unit: targets, rules, alerts, build information and the health probes. */

import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import {
  PrometheusApiError,
  PrometheusRequestError,
  PrometheusTasks,
} from "../mod.ts";
import { BASE, fakeFetch, success } from "./_fetch.ts";

/** An active target as the API reference's example shows it. */
const ACTIVE = {
  discoveredLabels: { __address__: "127.0.0.1:9090", job: "prometheus" },
  labels: { instance: "127.0.0.1:9090", job: "prometheus" },
  scrapePool: "prometheus",
  scrapeUrl: "http://127.0.0.1:9090/metrics",
  globalUrl: "http://example-prometheus:9090/metrics",
  lastError: "",
  lastScrape: "2017-01-17T15:07:44.723715405+01:00",
  lastScrapeDuration: 0.050688943,
  health: "up",
  scrapeInterval: "1m",
  scrapeTimeout: "10s",
};

Deno.test("targets GETs with its state filter and answers typed targets", async () => {
  const fetcher = fakeFetch(() =>
    success({
      activeTargets: [ACTIVE],
      droppedTargets: [{
        discoveredLabels: { job: "node" },
        scrapePool: "node",
      }],
    })
  );
  const response = await PrometheusTasks.targets((s) =>
    s.url(BASE).fetch(fetcher).state("active")
  );
  assertEquals(fetcher.sent[0].method, "GET");
  assertEquals(fetcher.sent[0].url.href, `${BASE}/api/v1/targets?state=active`);
  assertEquals(response.data.activeTargets, [ACTIVE]);
  assertEquals(response.data.droppedTargets[0].scrapePool, "node");
  assertEquals(response.data.droppedTargets[0].discoveredLabels, {
    job: "node",
  });
});

Deno.test("targets tolerates the optional fields and lists being absent", async () => {
  const fetcher = fakeFetch(() =>
    success({
      activeTargets: [{
        labels: {},
        scrapePool: "p",
        scrapeUrl: "u",
        health: "unknown",
      }],
    })
  );
  const response = await PrometheusTasks.targets((s) =>
    s.url(BASE).fetch(fetcher)
  );
  assertEquals(fetcher.sent[0].url.search, "");
  const [target] = response.data.activeTargets;
  assertEquals(target.discoveredLabels, {});
  assertEquals(target.globalUrl, undefined);
  assertEquals(target.lastScrapeDuration, undefined);
  assertEquals(response.data.droppedTargets, []);
  await assertRejects(
    () =>
      PrometheusTasks.targets((s) =>
        s.url(BASE).fetch(
          fakeFetch(() =>
            success({ activeTargets: [{ ...ACTIVE, lastScrapeDuration: "1" }] })
          ),
        )
      ),
    PrometheusRequestError,
    "lastScrapeDuration that is not a number",
  );
  await assertRejects(
    () =>
      PrometheusTasks.targets((s) =>
        s.url(BASE).fetch(
          fakeFetch(() =>
            success({ activeTargets: [{ ...ACTIVE, globalUrl: 1 }] })
          ),
        )
      ),
    PrometheusRequestError,
    "globalUrl that is not a string",
  );
});

/** The API reference's rules example. */
const RULES = {
  groups: [{
    rules: [{
      alerts: [{
        activeAt: "2018-07-04T20:27:12.60602144+02:00",
        annotations: { summary: "High request latency" },
        labels: { alertname: "HighRequestLatency", severity: "page" },
        state: "firing",
        value: "1e+00",
      }],
      annotations: { summary: "High request latency" },
      duration: 600,
      health: "ok",
      labels: { severity: "page" },
      name: "HighRequestLatency",
      query: 'job:request_latency_seconds:mean5m{job="myjob"} > 0.5',
      type: "alerting",
    }, {
      health: "ok",
      name: "job:http_inprogress_requests:sum",
      query: "sum by (job) (http_inprogress_requests)",
      type: "recording",
    }],
    file: "/rules.yaml",
    interval: 60,
    limit: 0,
    name: "example",
  }],
};

Deno.test("rules GETs every filter it was given and answers typed rules", async () => {
  const fetcher = fakeFetch(() =>
    success({ ...RULES, groupNextToken: "next-page" })
  );
  const response = await PrometheusTasks.rules((s) =>
    s.url(BASE).fetch(fetcher).type("alert").ruleName("A", "B")
      .ruleGroup("g").file("/rules.yaml").match('{severity="page"}')
      .excludeAlerts().groupLimit(10).groupNextToken("prev-page")
  );
  assertEquals([...fetcher.sent[0].url.searchParams], [
    ["type", "alert"],
    ["rule_name[]", "A"],
    ["rule_name[]", "B"],
    ["rule_group[]", "g"],
    ["file[]", "/rules.yaml"],
    ["match[]", '{severity="page"}'],
    ["exclude_alerts", "true"],
    ["group_limit", "10"],
    ["group_next_token", "prev-page"],
  ]);
  assertEquals(response.data.groupNextToken, "next-page");
  const [group] = response.data.groups;
  assertEquals([group.name, group.file, group.interval, group.limit], [
    "example",
    "/rules.yaml",
    60,
    0,
  ]);
  const [alerting, recording] = group.rules;
  if (alerting.type !== "alerting") throw new Error("expected alerting");
  assertEquals(alerting.duration, 600);
  assertEquals(alerting.alerts?.[0].value, 1);
  assertEquals(alerting.alerts?.[0].labels.alertname, "HighRequestLatency");
  assertEquals(recording.type, "recording");
  assertEquals(recording.labels, {});
});

Deno.test("rules sends nothing it was not given, and refuses odd rules", async () => {
  const fetcher = fakeFetch(() =>
    success({
      groups: [{
        ...RULES.groups[0],
        rules: [{ ...RULES.groups[0].rules[0], alerts: undefined }],
      }],
    })
  );
  const response = await PrometheusTasks.rules((s) =>
    s.url(BASE).fetch(fetcher).excludeAlerts(false)
  );
  assertEquals(fetcher.sent[0].url.search, "");
  const [rule] = response.data.groups[0].rules;
  assertEquals(rule.type === "alerting" ? rule.alerts : "?", undefined);
  await assertRejects(
    () =>
      PrometheusTasks.rules((s) =>
        s.url(BASE).fetch(fakeFetch(() =>
          success({
            groups: [{
              ...RULES.groups[0],
              rules: [{ ...RULES.groups[0].rules[1], type: "other" }],
            }],
          })
        ))
      ),
    PrometheusRequestError,
    'unknown type "other"',
  );
  await assertRejects(
    () =>
      PrometheusTasks.rules((s) =>
        s.url(BASE).fetch(fakeFetch(() =>
          success({
            groups: [{
              ...RULES.groups[0],
              rules: [{ ...RULES.groups[0].rules[0], duration: "10m" }],
            }],
          })
        ))
      ),
    PrometheusRequestError,
    "a rule has no duration",
  );
  await assertRejects(
    () => PrometheusTasks.rules((s) => s.groupNextToken("")),
    Error,
    "groupNextToken(...) was given an empty value",
  );
});

Deno.test("alerts answers the active alerts", async () => {
  const fetcher = fakeFetch(() =>
    success({
      alerts: [{
        labels: { alertname: "my-alert" },
        annotations: {},
        state: "firing",
        activeAt: "2018-07-04T20:27:12.60602144+02:00",
        value: "+Inf",
      }],
    })
  );
  const response = await PrometheusTasks.alerts((s) =>
    s.url(BASE).fetch(fetcher)
  );
  assertEquals(fetcher.sent[0].url.href, `${BASE}/api/v1/alerts`);
  assertEquals(response.data.alerts[0].value, Infinity);
  assertEquals(response.data.alerts[0].state, "firing");
  await assertRejects(
    () =>
      PrometheusTasks.alerts((s) =>
        s.url(BASE).fetch(fakeFetch(() => success({})))
      ),
    PrometheusRequestError,
    "the alerts is not an array",
  );
});

Deno.test("buildInfo answers the server's version", async () => {
  const fetcher = fakeFetch(() =>
    success({ version: "3.5.0", revision: "abc", goVersion: "go1.24" })
  );
  const response = await PrometheusTasks.buildInfo((s) =>
    s.url(BASE).fetch(fetcher)
  );
  assertEquals(fetcher.sent[0].url.pathname, "/api/v1/status/buildinfo");
  assertEquals(response.data.version, "3.5.0");
  assertEquals(response.data.revision, "abc");
  assertEquals(response.data.branch, undefined);
  await assertRejects(
    () =>
      PrometheusTasks.buildInfo((s) =>
        s.url(BASE).fetch(fakeFetch(() => success({})))
      ),
    PrometheusRequestError,
    "the build information has no version",
  );
});

Deno.test("healthy and ready: 2xx is true, 503 is false, anything else throws", async () => {
  const fetcher = fakeFetch((r) =>
    r.url.pathname === "/-/healthy"
      ? new Response("Prometheus Server is Healthy.\n")
      : new Response("Service Unavailable", { status: 503 })
  );
  assertEquals(
    await PrometheusTasks.healthy((s) => s.url(BASE).fetch(fetcher)),
    true,
  );
  assertEquals(
    await PrometheusTasks.ready((s) => s.url(BASE).fetch(fetcher)),
    false,
  );
  assertEquals(fetcher.sent.map((r) => r.method), ["GET", "GET"]);
  for (const body of ["unauthorized", ""]) {
    const error = await assertRejects(
      () =>
        PrometheusTasks.ready((s) =>
          s.url(BASE).fetch(
            fakeFetch(() => new Response(body, { status: 401 })),
          )
        ),
      PrometheusApiError,
      "GET /-/ready failed: HTTP 401",
    );
    if (!(error instanceof PrometheusApiError)) throw error;
    assertEquals(error.detail, body === "" ? undefined : body);
  }
});
