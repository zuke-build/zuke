import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { HttpError } from "@zuke/core";
import { GcsTasks } from "../src/gcs.ts";

/** A `fetch` double that records calls and answers from a handler. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fetch, calls };
}

Deno.test("GcsTasks.readJson GETs the object media with a bearer token", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ slot: "sit-7" }), { status: 200 })
  );
  const object = "state/deploy.json";
  const data = await GcsTasks.readJson<{ slot: string }>(
    "my-bucket",
    object,
    { token: "t0", fetch },
  );
  assertEquals(data.slot, "sit-7");
  // The object name is percent-encoded (its slash becomes %2F) in the path.
  assertStringIncludes(
    calls[0].url,
    `/b/my-bucket/o/${encodeURIComponent(object)}`,
  );
  assertStringIncludes(calls[0].url, "alt=media");
  assertEquals(
    new Headers(calls[0].init?.headers).get("authorization"),
    "Bearer t0",
  );
});

Deno.test("GcsTasks.writeJson POSTs the JSON body to the upload endpoint", async () => {
  // An empty write response (no body) is fine — exercises the null-body path.
  const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
  await GcsTasks.writeJson("b", "k.json", { a: 1 }, { token: "t0", fetch });
  assertEquals(calls[0].init?.method, "POST");
  assertStringIncludes(calls[0].url, "/upload/storage/v1/b/b/o");
  assertStringIncludes(calls[0].url, "uploadType=media");
  assertStringIncludes(calls[0].url, "name=k.json");
  assertEquals(calls[0].init?.body, JSON.stringify({ a: 1 }));
});

Deno.test("GcsTasks.list returns object names, honouring a prefix", async () => {
  const { fetch, calls } = fakeFetch(() =>
    new Response(
      JSON.stringify({
        items: [{ name: "state/a.json" }, { name: "state/b.json" }, {}],
      }),
      { status: 200 },
    )
  );
  const names = await GcsTasks.list("b", {
    token: "t0",
    fetch,
    prefix: "state/",
  });
  // The nameless entry is skipped, not a crash.
  assertEquals(names, ["state/a.json", "state/b.json"]);
  assertStringIncludes(calls[0].url, "prefix=state%2F");
});

Deno.test("GcsTasks.list tolerates a body with no items array", async () => {
  const { fetch } = fakeFetch(() => new Response("{}", { status: 200 }));
  assertEquals(await GcsTasks.list("b", { token: "t0", fetch }), []);
});

Deno.test("GcsTasks surfaces a non-2xx response as an HttpError", async () => {
  const { fetch } = fakeFetch(() => new Response("nope", { status: 404 }));
  await assertRejects(
    () => GcsTasks.readJson("b", "missing", { token: "t0", fetch }),
    HttpError,
  );
});

Deno.test("GcsTasks resolves the token via the provider when none is given", async () => {
  let used = "";
  const { fetch } = fakeFetch((_url, init) => {
    used = new Headers(init?.headers).get("authorization") ?? "";
    return new Response("{}", { status: 200 });
  });
  await GcsTasks.list("b", {
    fetch,
    tokenProvider: () => Promise.resolve("provided"),
  });
  assertEquals(used, "Bearer provided");
});
