/**
 * Unit tests for {@link HttpBuildRegistry}: the REST verbs, ETag/If-Match
 * compare-and-swap, and untrusted-response validation, all driven through the
 * injectable `fetch` seam (no network). Mirrors the HttpStateStore tests.
 */

import { assertEquals, assertRejects } from "./_assert.ts";
import { HttpError } from "../src/http.ts";
import type { CliDescription } from "../src/describe.ts";
import {
  type BuildDescriptor,
  stringifyBuildDescriptor,
  toBuildSummary,
} from "../src/registry/descriptor.ts";
import { HttpBuildRegistry } from "../src/registry/http_registry.ts";

/** A minimal, valid CLI surface. */
function surface(): CliDescription {
  return { commands: [], flags: [], targets: [], parameters: [] };
}

/** A sample descriptor. */
function descriptor(overrides: Partial<BuildDescriptor> = {}): BuildDescriptor {
  return {
    id: "CI",
    name: "CI",
    location: { kind: "module", module: "file:///x/zuke.ts", cwd: "/x" },
    surface: surface(),
    actor: "me",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Wrap a synchronous handler as a `fetch` implementation. */
function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init));
}

/** Read one request header without casting, whatever `HeadersInit` shape it is. */
function headerOf(
  init: RequestInit | undefined,
  name: string,
): string | undefined {
  const headers = init?.headers;
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) if (key === name) return value;
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key === name) return value;
  }
  return undefined;
}

Deno.test("HttpBuildRegistry.getBuild returns descriptor + ETag, or null on 404", async () => {
  const registry = new HttpBuildRegistry({
    url: "https://r.example/",
    token: "t",
    fetch: fakeFetch((url, init) => {
      assertEquals(init?.headers, {
        Authorization: "Bearer t",
        "x-zuke-state-protocol": "1",
      });
      if (url.endsWith("/builds/missing")) {
        return new Response(null, { status: 404 });
      }
      return new Response(stringifyBuildDescriptor(descriptor()), {
        status: 200,
        headers: { etag: "v1" },
      });
    }),
  });
  const loaded = await registry.getBuild("CI");
  assertEquals(loaded?.version, "v1");
  assertEquals(loaded?.descriptor.id, "CI");
  assertEquals(await registry.getBuild("missing"), null);
});

Deno.test("HttpBuildRegistry.getBuild errors without an ETag or on failure", async () => {
  const noEtag = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() =>
      new Response(stringifyBuildDescriptor(descriptor()), { status: 200 })
    ),
  });
  await assertRejects(
    () => noEtag.getBuild("CI"),
    Error,
    "did not return an ETag",
  );

  const failing = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => failing.getBuild("CI"), HttpError);
});

Deno.test("HttpBuildRegistry.register sends preconditions and maps 412 to a conflict", async () => {
  const registry = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch((_url, init) => {
      // A create (null version) sends If-None-Match:*.
      if (headerOf(init, "If-None-Match") === "*") {
        return new Response(null, { status: 200, headers: { etag: "v1" } });
      }
      // A stale If-Match version is rejected.
      if (headerOf(init, "If-Match") === "stale") {
        return new Response(null, { status: 412 });
      }
      return new Response(null, { status: 200, headers: { etag: "v2" } });
    }),
  });
  const created = await registry.register(descriptor(), null);
  assertEquals(created, { ok: true, version: "v1" });

  const conflict = await registry.register(descriptor(), "stale");
  assertEquals(conflict, { ok: false, conflict: true });

  const updated = await registry.register(descriptor(), "v1");
  assertEquals(updated, { ok: true, version: "v2" });
});

Deno.test("HttpBuildRegistry.register errors without an ETag or on failure", async () => {
  const noEtag = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 200 })),
  });
  await assertRejects(
    () => noEtag.register(descriptor(), null),
    Error,
    "did not return an ETag on write",
  );

  const failing = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => failing.register(descriptor(), null), HttpError);
});

Deno.test("HttpBuildRegistry.deregister tolerates 404 and reports other errors", async () => {
  let method: string | undefined;
  const ok = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch((_url, init) => {
      method = init?.method;
      return new Response(null, { status: 204 });
    }),
  });
  await ok.deregister("CI");
  assertEquals(method, "DELETE");

  const missing = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 404 })),
  });
  await missing.deregister("CI"); // 404 is not an error

  const failing = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => failing.deregister("CI"), HttpError);
});

Deno.test("HttpBuildRegistry.listBuilds builds a query and validates the array", async () => {
  let seenUrl = "";
  const registry = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch((url) => {
      seenUrl = url;
      return new Response(
        JSON.stringify([toBuildSummary(descriptor())]),
        { status: 200 },
      );
    }),
  });
  const summaries = await registry.listBuilds({
    name: "CI",
    since: "2026-01-01T00:00:00.000Z",
  });
  assertEquals(summaries.map((s) => s.id), ["CI"]);
  assertEquals(seenUrl.includes("name=CI"), true);
  assertEquals(seenUrl.includes("since=2026-01-01"), true);

  const notArray = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response("{}", { status: 200 })),
  });
  await assertRejects(() => notArray.listBuilds({}), Error, "JSON array");

  // A 200 with a non-JSON body (e.g. a proxy HTML page) is a friendly error,
  // not a raw SyntaxError.
  const notJson = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() =>
      new Response("<html>Bad Gateway</html>", { status: 200 })
    ),
  });
  await assertRejects(
    () => notJson.listBuilds({}),
    Error,
    "did not return valid JSON",
  );

  const failing = new HttpBuildRegistry({
    url: "https://r.example",
    fetch: fakeFetch(() => new Response(null, { status: 500 })),
  });
  await assertRejects(() => failing.listBuilds({}), HttpError);
});
