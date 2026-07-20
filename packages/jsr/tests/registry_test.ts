import { assertEquals } from "../../core/tests/_assert.ts";
import {
  isPublished,
  jsrVersions,
  publishedVersions,
} from "../src/registry.ts";

/** A Set's members as a sorted array — an order-independent comparison that does
 * not depend on the assert helper's Set support (so it can't pass vacuously). */
function sortedMembers(set: Set<string>): string[] {
  return [...set].sort();
}

Deno.test("publishedVersions extracts version keys", () => {
  assertEquals(
    sortedMembers(
      publishedVersions({ versions: { "1.0.0": {}, "1.1.0": {} } }),
    ),
    ["1.0.0", "1.1.0"],
  );
});

Deno.test("publishedVersions tolerates malformed payloads", () => {
  assertEquals(sortedMembers(publishedVersions(null)), []);
  assertEquals(sortedMembers(publishedVersions("nope")), []);
  assertEquals(sortedMembers(publishedVersions({})), []);
  assertEquals(sortedMembers(publishedVersions({ versions: null })), []);
  assertEquals(sortedMembers(publishedVersions({ versions: 7 })), []);
});

/** A `fetch` stub returning the given JSON body with a controllable status. */
function stubFetch(
  body: unknown,
  ok = true,
): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status: ok ? 200 : 404 }),
    );
}

Deno.test("jsrVersions returns the published set on a 2xx", async () => {
  const versions = await jsrVersions("@zuke/core", {
    fetch: stubFetch({ versions: { "0.13.0": {} } }),
  });
  assertEquals(sortedMembers(versions), ["0.13.0"]);
});

Deno.test("jsrVersions resolves to an empty set on a non-2xx", async () => {
  const versions = await jsrVersions("@zuke/nope", {
    fetch: stubFetch({}, false),
  });
  assertEquals(sortedMembers(versions), []);
});

Deno.test("jsrVersions requests the package meta.json", async () => {
  let requested = "";
  const versions = await jsrVersions("@zuke/core", {
    fetch: (url) => {
      requested = String(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(requested, "https://jsr.io/@zuke/core/meta.json");
  assertEquals(sortedMembers(versions), []);
});

Deno.test("isPublished reflects membership in the published set", async () => {
  const fetch = stubFetch({ versions: { "0.13.0": {} } });
  assertEquals(await isPublished("@zuke/core", "0.13.0", { fetch }), true);
  assertEquals(await isPublished("@zuke/core", "9.9.9", { fetch }), false);
});
