import { assertEquals } from "../../core/tests/_assert.ts";
import { OtelSettings, parseHeaderList, resolveOtel } from "../src/settings.ts";

/** A `readEnv` backed by a fixed map. */
function env(
  map: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => map[name];
}

const NONE = env({});

Deno.test("resolveOtel returns null when no endpoint is configured", () => {
  assertEquals(resolveOtel(new OtelSettings(), NONE), null);
});

Deno.test("resolveOtel appends the signal paths to a base endpoint", () => {
  const resolved = resolveOtel(
    new OtelSettings().endpoint("http://localhost:4318"),
    NONE,
  );
  assertEquals(resolved?.tracesUrl, "http://localhost:4318/v1/traces");
  assertEquals(resolved?.metricsUrl, "http://localhost:4318/v1/metrics");
  assertEquals(resolved?.resource.serviceName, "zuke");
});

Deno.test("resolveOtel tolerates a trailing slash on the endpoint", () => {
  const resolved = resolveOtel(
    new OtelSettings().endpoint("http://localhost:4318/"),
    NONE,
  );
  assertEquals(resolved?.tracesUrl, "http://localhost:4318/v1/traces");
});

Deno.test("resolveOtel falls back to OTEL_EXPORTER_OTLP_ENDPOINT", () => {
  const resolved = resolveOtel(
    new OtelSettings(),
    env({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }),
  );
  assertEquals(resolved?.tracesUrl, "http://collector:4318/v1/traces");
});

Deno.test("a per-signal endpoint wins and is used verbatim", () => {
  const resolved = resolveOtel(
    new OtelSettings()
      .endpoint("http://base:4318")
      .tracesEndpoint("http://traces:9999/ingest"),
    NONE,
  );
  assertEquals(resolved?.tracesUrl, "http://traces:9999/ingest");
  assertEquals(resolved?.metricsUrl, "http://base:4318/v1/metrics");
});

Deno.test("a per-signal endpoint alone enables that signal", () => {
  // Only OTEL_EXPORTER_OTLP_METRICS_ENDPOINT set (no base) still resolves,
  // because both URLs are derivable.
  const resolved = resolveOtel(
    new OtelSettings().tracesEndpoint("http://t/1").metricsEndpoint(
      "http://m/1",
    ),
    NONE,
  );
  assertEquals(resolved?.tracesUrl, "http://t/1");
  assertEquals(resolved?.metricsUrl, "http://m/1");
});

Deno.test("a lone traces endpoint enables just the trace signal", () => {
  const resolved = resolveOtel(
    new OtelSettings().tracesEndpoint("http://t/1"),
    NONE,
  );
  assertEquals(resolved?.tracesUrl, "http://t/1");
  assertEquals(resolved?.metricsUrl, undefined);
});

Deno.test("a lone metrics env endpoint enables just the metric signal", () => {
  const resolved = resolveOtel(
    new OtelSettings(),
    env({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://m/1" }),
  );
  assertEquals(resolved?.tracesUrl, undefined);
  assertEquals(resolved?.metricsUrl, "http://m/1");
});

Deno.test("a blank endpoint counts as unset (setter and env)", () => {
  assertEquals(resolveOtel(new OtelSettings().endpoint(""), NONE), null);
  assertEquals(resolveOtel(new OtelSettings().endpoint("   "), NONE), null);
  assertEquals(
    resolveOtel(new OtelSettings(), env({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })),
    null,
  );
});

Deno.test("headers merge env then setter, setter winning on conflict", () => {
  const resolved = resolveOtel(
    new OtelSettings()
      .endpoint("http://h:4318")
      .header("authorization", "Bearer set")
      .headers({ "x-tenant": "acme" }),
    env({ OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer env,x-region=eu" }),
  );
  assertEquals(resolved?.headers, {
    authorization: "Bearer set", // setter overrides env
    "x-region": "eu",
    "x-tenant": "acme",
  });
});

Deno.test("serviceName: setter > OTEL_SERVICE_NAME > default", () => {
  assertEquals(
    resolveOtel(
      new OtelSettings().endpoint("http://h").serviceName("explicit"),
      env({ OTEL_SERVICE_NAME: "from-env" }),
    )?.resource.serviceName,
    "explicit",
  );
  assertEquals(
    resolveOtel(
      new OtelSettings().endpoint("http://h"),
      env({ OTEL_SERVICE_NAME: "from-env" }),
    )?.resource.serviceName,
    "from-env",
  );
});

Deno.test("resource attributes merge env (OTEL_RESOURCE_ATTRIBUTES) and setters", () => {
  const resolved = resolveOtel(
    new OtelSettings()
      .endpoint("http://h")
      .resourceAttribute("k", "setter")
      .resourceAttributes({ team: "core" }),
    env({ OTEL_RESOURCE_ATTRIBUTES: "k=env,deployment.environment=ci" }),
  );
  assertEquals(resolved?.resource.attributes, {
    k: "setter",
    "deployment.environment": "ci",
    team: "core",
  });
});

Deno.test("timeout parses a duration string into milliseconds", () => {
  assertEquals(
    resolveOtel(new OtelSettings().endpoint("http://h").timeout("5s"), NONE)
      ?.timeoutMs,
    5000,
  );
});

Deno.test("parseHeaderList trims and skips malformed entries", () => {
  assertEquals(parseHeaderList("a=1, b = 2 ,nope,=x,c="), {
    a: "1",
    b: "2",
    c: "",
  });
});
