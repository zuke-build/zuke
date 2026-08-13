import { assertEquals, assertExists } from "@std/assert";
import {
  afterAll,
  beforeAll,
  describe,
  it,
} from "@std/testing/bdd";
import { withRequestInterceptor } from "../../test/with_request_interceptor.ts";
import { GhTasks } from "../../packages/gh/mod.ts";

function makeJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function interceptRequests(handler: Parameters<typeof withRequestInterceptor>[0]) {
  return async (input, _init) => {
    return await withRequestInterceptor(handler, () => fetch(input, _init));
  };
}

describe("Gemini release", () => {
  let restoreFetch: (() => void) | undefined;

  beforeAll(() => {
    restoreFetch = withRequestInterceptor((request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.endsWith("/releases/latest")) {
        return makeJsonResponse({ tag_name: "v1.2.3", id: 123 });
      }
      return new Response(null, { status: 404 });
    });
  });

  afterAll(() => {
    restoreFetch?.();
  });

  it("resolves latest release", async () => {
    const result = await GhTasks.uploadReleaseAsset((s) =>
      s.file("/tmp/zuke.tar.gz").repo("owner/repo").token("token")
    );

    assertEquals(result.state, "uploaded");
    assertEquals(result.releaseTag, "v1.2.3");
    assertEquals(result.releaseId, 123);
    assertExists(result.url);
  });
});
