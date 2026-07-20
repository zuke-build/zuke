import { assertEquals, assertRejects } from "./_assert.ts";
import {
  httpDownload,
  HttpError,
  httpJson,
  type HttpOptions,
  httpText,
} from "../src/http.ts";

/** A fake `fetch` returning `body` with `status`, recording the call. */
function fakeFetch(
  body: string,
  status = 200,
): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fetch: impl, calls };
}

Deno.test("httpText returns the body and forwards headers", async () => {
  const { fetch, calls } = fakeFetch("hello");
  const options: HttpOptions = {
    fetch,
    headers: { Authorization: "Bearer x" },
  };
  assertEquals(await httpText("https://example.com/a", options), "hello");
  assertEquals(calls[0].url, "https://example.com/a");
  assertEquals(calls[0].init?.headers, { Authorization: "Bearer x" });
});

Deno.test("httpJson parses the body", async () => {
  const { fetch } = fakeFetch('{"tag":"v1.2.3"}');
  const data = await httpJson<{ tag: string }>("https://example.com/r", {
    fetch,
  });
  assertEquals(data.tag, "v1.2.3");
});

Deno.test("a non-2xx status throws HttpError carrying the status", async () => {
  const { fetch } = fakeFetch("nope", 404);
  const error = await assertRejects(
    () => httpText("https://example.com/missing", { fetch }),
    HttpError,
    "HTTP 404",
  );
  if (error instanceof HttpError) {
    assertEquals(error.status, 404);
    assertEquals(error.url, "https://example.com/missing");
  }
});

Deno.test("HttpError redacts userinfo and credential query params from the URL", () => {
  const e = new HttpError(
    500,
    "https://user:pw@host.example/x?key=abc&client_secret=cs&refresh_token=rt&q=ok",
  );
  // Userinfo and every credential param (incl. OAuth `client_secret` /
  // `refresh_token`, caught by substring markers) are masked.
  for (const leaked of ["user", "pw", "abc", "cs", "rt"]) {
    assertEquals(e.message.includes(leaked), false, `leaked: ${leaked}`);
    assertEquals(e.url.includes(leaked), false); // the stored url is redacted too
  }
  assertEquals(e.message.includes("REDACTED"), true);
  assertEquals(e.url.includes("q=ok"), true); // a non-credential param is kept
});

Deno.test("httpDownload streams the body to a file", async () => {
  const { fetch } = fakeFetch("file-contents");
  const dir = await Deno.makeTempDir();
  try {
    const dest = `${dir}/out.txt`;
    await httpDownload("https://example.com/f", dest, { fetch });
    assertEquals(await Deno.readTextFile(dest), "file-contents");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("httpDownload of a non-2xx status throws before writing", async () => {
  const { fetch } = fakeFetch("err", 500);
  const dir = await Deno.makeTempDir();
  try {
    const dest = `${dir}/out.txt`;
    await assertRejects(
      () => httpDownload("https://example.com/f", dest, { fetch }),
      HttpError,
      "HTTP 500",
    );
    assertEquals(await Deno.stat(dest).catch(() => null), null); // not created
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("httpDownload handles an empty (null) body", async () => {
  // A 204 response has a null body; the file is created but empty.
  const impl =
    (() =>
      Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch;
  const dir = await Deno.makeTempDir();
  try {
    const dest = `${dir}/empty.bin`;
    await httpDownload("https://example.com/empty", dest, { fetch: impl });
    assertEquals((await Deno.stat(dest)).size, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
