import { assertEquals } from "../../core/tests/_assert.ts";
import { OtlpHttpExporter } from "../src/exporter.ts";
import { buildMetrics, buildTraces, type RunSpanIds } from "../src/otlp.ts";
import { makeRecord, RESOURCE } from "./_fixtures.ts";

const IDS: RunSpanIds = {
  traceId: "0123456789abcdef0123456789abcdef",
  runSpanId: "1111111111111111",
  targetSpanIds: new Map(),
};

/** The global `fetch` signature, aliased so a local `fetch` param can be typed. */
type FetchFn = typeof globalThis.fetch;

/** A captured fetch call. */
interface Call {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string;
}

/** A fake `fetch` that records calls and returns a canned response. */
function recordingFetch(
  respond: () => Response = () => new Response("{}", { status: 200 }),
): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(respond());
  };
  return { fetch, calls };
}

function exporter(fetch: FetchFn): OtlpHttpExporter {
  return new OtlpHttpExporter({
    tracesUrl: "http://c:4318/v1/traces",
    metricsUrl: "http://c:4318/v1/metrics",
    headers: { authorization: "Bearer t" },
    timeoutMs: 10_000,
    fetch,
  });
}

Deno.test("traces() POSTs JSON to the traces URL with headers", async () => {
  const { fetch, calls } = recordingFetch();
  const payload = buildTraces(
    makeRecord({ status: "succeeded" }),
    IDS,
    RESOURCE,
  );
  await exporter(fetch).traces(payload);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "http://c:4318/v1/traces");
  assertEquals(calls[0].method, "POST");
  assertEquals(calls[0].headers.get("content-type"), "application/json");
  assertEquals(calls[0].headers.get("authorization"), "Bearer t");
  assertEquals(calls[0].body, JSON.stringify(payload));
});

Deno.test("metrics() POSTs JSON to the metrics URL", async () => {
  const { fetch, calls } = recordingFetch();
  const payload = buildMetrics([], RESOURCE);
  await exporter(fetch).metrics(payload);

  assertEquals(calls[0].url, "http://c:4318/v1/metrics");
  assertEquals(calls[0].body, JSON.stringify(payload));
});

Deno.test("a thrown fetch is swallowed (best-effort)", async () => {
  const failing: FetchFn = () => Promise.reject(new Error("ECONNREFUSED"));
  // Resolves without throwing.
  await exporter(failing).metrics(buildMetrics([], RESOURCE));
});

Deno.test("a non-2xx response is swallowed (best-effort)", async () => {
  const { fetch } = recordingFetch(() => new Response("nope", { status: 500 }));
  await exporter(fetch).metrics(buildMetrics([], RESOURCE));
});

Deno.test("a response with no body is tolerated", async () => {
  const { fetch } = recordingFetch(() => new Response(null, { status: 202 }));
  await exporter(fetch).traces(
    buildTraces(makeRecord({ status: "succeeded" }), IDS, RESOURCE),
  );
});

Deno.test("skips a signal whose URL is absent", async () => {
  const { fetch, calls } = recordingFetch();
  const tracesOnly = new OtlpHttpExporter({
    tracesUrl: "http://c:4318/v1/traces",
    metricsUrl: undefined, // metrics not configured
    headers: {},
    timeoutMs: 10_000,
    fetch,
  });
  await tracesOnly.metrics(buildMetrics([], RESOURCE)); // no-op, no request
  assertEquals(calls.length, 0);
  await tracesOnly.traces(
    buildTraces(makeRecord({ status: "succeeded" }), IDS, RESOURCE),
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "http://c:4318/v1/traces");

  // Symmetric: a metrics-only exporter skips the trace signal.
  const { fetch: fetch2, calls: calls2 } = recordingFetch();
  const metricsOnly = new OtlpHttpExporter({
    tracesUrl: undefined,
    metricsUrl: "http://c:4318/v1/metrics",
    headers: {},
    timeoutMs: 10_000,
    fetch: fetch2,
  });
  await metricsOnly.traces(
    buildTraces(makeRecord({ status: "succeeded" }), IDS, RESOURCE),
  );
  assertEquals(calls2.length, 0);
  await metricsOnly.metrics(buildMetrics([], RESOURCE));
  assertEquals(calls2.length, 1);
  assertEquals(calls2[0].url, "http://c:4318/v1/metrics");
});

Deno.test("defaults to the global fetch when none is injected", () => {
  // Construction alone exercises the `?? fetch` default (never called).
  const built = new OtlpHttpExporter({
    tracesUrl: "http://c/v1/traces",
    metricsUrl: "http://c/v1/metrics",
    headers: {},
    timeoutMs: 1000,
  });
  assertEquals(built instanceof OtlpHttpExporter, true);
});
