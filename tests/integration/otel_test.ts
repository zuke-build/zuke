/**
 * Integration: drive a real build through the CLI `main()` with the `@zuke/otel`
 * plugin registered, against a capturing `fetch` (the only faked seam — the
 * executor, the durable state writer, the plugin, and the HTTP exporter are all
 * real). Proves the whole path: a run/target transition becomes a genuine
 * OTLP/HTTP JSON request body.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  target,
} from "../../packages/core/mod.ts";
import { otelWith } from "../../packages/otel/src/plugin.ts";
import { runCli, withStateDir } from "./_harness.ts";

/** The global `fetch` signature, aliased so a local can be annotated. */
type FetchFn = typeof globalThis.fetch;

/** One captured export request. */
interface Request {
  url: string;
  body: unknown;
}

/** A `fetch` that records the URL and parsed JSON body of every request. */
function capturingFetch(): { fetch: FetchFn; requests: Request[] } {
  const requests: Request[] = [];
  const fetch: FetchFn = (input, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url: String(input), body });
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  return { fetch, requests };
}

/** The span names inside a captured trace request body. */
function spanNames(body: unknown): string[] {
  const payload = body as {
    resourceSpans: [{ scopeSpans: [{ spans: { name: string }[] }] }];
  };
  return payload.resourceSpans[0].scopeSpans[0].spans.map((s) => s.name);
}

/** A metric's single data-point attribute value, by key. */
function metricAttr(body: unknown, key: string): string | undefined {
  const payload = body as {
    resourceMetrics: [{
      scopeMetrics: [{
        metrics: [{
          sum: {
            dataPoints: [
              {
                attributes: { key: string; value: { stringValue?: string } }[];
              },
            ];
          };
        }];
      }];
    }];
  };
  const attrs = payload.resourceMetrics[0].scopeMetrics[0].metrics[0].sum
    .dataPoints[0].attributes;
  return attrs.find((a) => a.key === key)?.value.stringValue;
}

class OtelDemo extends Build {
  lint = target().executes(() => {});
  test = target().dependsOn(this.lint).executes(() => {});
}

class OtelFails extends Build {
  build = target().executes(() => {
    throw new Error("boom");
  });
}

class OtelWaits extends Build {
  gate = target().waitsFor((s) => s.on(externalSignal("never")).timeout("1ms"));
  done = target().dependsOn(this.gate).executes(() => {});
}

Deno.test("otel exports a run trace and counters for a successful build", async () => {
  await withStateDir(async () => {
    const { fetch, requests } = capturingFetch();
    const plugin = otelWith((s) => s.endpoint("http://collector:4318"), {
      fetch,
      readEnv: () => undefined,
    });
    const result = await runCli(OtelDemo, ["test"], { plugins: [plugin] });
    assertEquals(result.code, 0);

    const traces = requests.filter((r) => r.url.endsWith("/v1/traces"));
    const metrics = requests.filter((r) => r.url.endsWith("/v1/metrics"));
    assertEquals(traces.length, 1);
    // Run span + one span per executed target (lint, test).
    assertEquals(spanNames(traces[0].body).sort(), [
      "OtelDemo",
      "lint",
      "test",
    ]);

    // A fresh start counter, then the terminal outcome counter.
    assertEquals(metrics.length, 2);
    assertEquals(metricAttr(metrics[1].body, "outcome"), "succeeded");
  });
});

Deno.test("otel reports a failed run and marks the failing target span", async () => {
  await withStateDir(async () => {
    const { fetch, requests } = capturingFetch();
    const plugin = otelWith((s) => s.endpoint("http://collector:4318"), {
      fetch,
      readEnv: () => undefined,
    });
    const result = await runCli(OtelFails, ["build"], { plugins: [plugin] });
    assertEquals(result.code, 1);

    const traces = requests.filter((r) => r.url.endsWith("/v1/traces"));
    assertEquals(traces.length, 1);
    const spans = (traces[0].body as {
      resourceSpans: [{
        scopeSpans: [{ spans: { name: string; status: { code: number } }[] }];
      }];
    }).resourceSpans[0].scopeSpans[0].spans;
    const buildSpan = spans.find((s) => s.name === "build");
    assertEquals(buildSpan?.status.code, 2); // error

    const metrics = requests.filter((r) => r.url.endsWith("/v1/metrics"));
    const outcome = metrics.at(-1);
    assertEquals(metricAttr(outcome?.body, "outcome"), "failed");
  });
});

Deno.test("otel exports a terminal trace when a wait times out on resume", async () => {
  await withStateDir(async (dir) => {
    const { fetch, requests } = capturingFetch();
    // One plugin instance across both CLI calls (dedup is per instance).
    const plugin = otelWith((s) => s.endpoint("http://collector:4318"), {
      fetch,
      readEnv: () => undefined,
    });

    // First: run to the gate and suspend (deadline 1ms in the future).
    const first = await runCli(OtelWaits, ["done"], { plugins: [plugin] });
    assertEquals(first.code, 0);
    const store = new FileSystemStateStore(dir, defaultStateHost);
    const runs = await store.listRuns({});
    assertEquals(runs.length, 1);
    const id = runs[0].id;

    // Let the deadline pass, then resume — the timeout fast-path settles the
    // run `failed` without execute()'s lifecycle, so the terminal telemetry
    // must come from the resume path announcing the record to the plugin.
    await new Promise((r) => setTimeout(r, 25));
    const resumed = await runCli(OtelWaits, ["resume", id], {
      plugins: [plugin],
    });
    assertEquals(resumed.code, 1); // a timed-out run fails

    const traces = requests.filter((r) => r.url.endsWith("/v1/traces"));
    assertEquals(traces.length, 1); // the terminal trace, from the timeout path
    const metrics = requests.filter((r) => r.url.endsWith("/v1/metrics"));
    assertEquals(metricAttr(metrics.at(-1)?.body, "outcome"), "failed");
  });
});
