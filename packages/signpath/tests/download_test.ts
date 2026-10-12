// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  SignPathApiError,
  type SignPathDownloadSettings,
  SignPathRequestError,
  SignPathTasks,
} from "../mod.ts";
import {
  ARTIFACT_URL,
  connected,
  fakeFetch,
  REQUEST,
  routes,
  TOKEN,
} from "./_fetch.ts";

/** A fresh temp directory and the file the download writes into it. */
async function target(
  name = "zuke.exe",
): Promise<{ dir: string; output: string }> {
  const dir = await Deno.makeTempDir();
  return { dir, output: `${dir}/${name}` };
}

/** The names left in `dir`. */
async function entries(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}

/** Download {@link REQUEST}'s artifact through `net` to `output`. */
function download(
  net: typeof fetch,
  output: string,
  configure: (s: SignPathDownloadSettings) => SignPathDownloadSettings = (s) =>
    s,
) {
  return SignPathTasks.download((s) =>
    configure(
      connected<SignPathDownloadSettings>(net)(s).signingRequestId(REQUEST)
        .output(output),
    )
  );
}

Deno.test("download: writes exactly the configured path, ignoring the server's file name", async () => {
  const { dir, output } = await target();
  await Deno.writeTextFile(output, "old");
  const net = routes({
    [`GET ${ARTIFACT_URL}`]: [() =>
      new Response("MZ signed", {
        headers: {
          "content-disposition": 'attachment; filename="../../evil.exe"',
        },
      })],
  });
  const result = await download(net, output);
  assertEquals(result, { path: output, bytes: 9 });
  assertEquals(await Deno.readTextFile(output), "MZ signed");
  assertEquals(await entries(dir), ["zuke.exe"]);
  assertEquals(net.sent[0].headers.get("authorization"), `Bearer ${TOKEN}`);
});

Deno.test("download: creates the output's directory, and accepts an empty body", async () => {
  const { dir } = await target();
  const output = `${dir}/a/b/zuke.exe`;
  const net = routes({
    [`GET ${ARTIFACT_URL}`]: [() => new Response(null, { status: 200 })],
  });
  assertEquals((await download(net, output)).bytes, 0);
  assertEquals(await Deno.readTextFile(output), "");
});

Deno.test("download: a relative bare file name is written in the working directory", async () => {
  const { dir } = await target();
  const previous = Deno.cwd();
  Deno.chdir(dir);
  try {
    const net = routes({
      [`GET ${ARTIFACT_URL}`]: [() => new Response("x")],
    });
    await download(net, "zuke.exe");
    assertEquals(await Deno.readTextFile(`${dir}/zuke.exe`), "x");
  } finally {
    Deno.chdir(previous);
  }
});

Deno.test("download: a redirect to storage is followed without the token", async () => {
  const { output } = await target();
  const storage = "https://blob.example/signed/zuke.exe?sig=abc";
  const net = routes({
    [`GET ${ARTIFACT_URL}`]: [
      () => new Response(null, { status: 302, headers: { location: storage } }),
    ],
    [`GET ${storage}`]: [() =>
      new Response(null, {
        status: 307,
        headers: { location: "https://blob.example/final" },
      })],
    ["GET https://blob.example/final"]: [() => new Response("signed")],
  });
  await download(net, output);
  assertEquals(await Deno.readTextFile(output), "signed");
  assertEquals(net.sent.map((r) => r.headers.has("authorization")), [
    true,
    false,
    false,
  ]);
  assertEquals(net.sent.every((r) => r.redirect === "manual"), true);
});

Deno.test("download: a same-origin redirect keeps the token", async () => {
  const { output } = await target();
  const net = routes({
    [`GET ${ARTIFACT_URL}`]: [
      () =>
        new Response(null, { status: 302, headers: { location: "/other" } }),
    ],
    ["GET https://app.signpath.io/other"]: [() => new Response("ok")],
  });
  await download(net, output);
  assertEquals(net.sent[1].headers.get("authorization"), `Bearer ${TOKEN}`);
});

Deno.test("download: unsafe or endless redirects are refused", async () => {
  const { dir, output } = await target();
  const plain = routes({
    [`GET ${ARTIFACT_URL}`]: [() =>
      new Response(null, {
        status: 302,
        headers: { location: "http://blob.example/x" },
      })],
  });
  await assertRejects(
    () => download(plain, output),
    SignPathRequestError,
    "not https",
  );
  assertEquals(plain.sent.length, 1);
  const loop = fakeFetch(() =>
    new Response(null, { status: 302, headers: { location: ARTIFACT_URL } })
  );
  await assertRejects(
    () => download(loop, output),
    SignPathRequestError,
    "more than 5 redirects",
  );
  assertEquals(loop.sent.length, 6);
  const nowhere = fakeFetch(() => new Response(null, { status: 302 }));
  await assertRejects(
    () => download(nowhere, output),
    SignPathRequestError,
    "names no location",
  );
  assertEquals(await entries(dir), []);
});

Deno.test("download: a refusal is an API error and writes nothing", async () => {
  const { dir, output } = await target();
  const net = fakeFetch(() =>
    Response.json({ error: "The signing request is not completed" }, {
      status: 409,
    })
  );
  await assertRejects(
    () => download(net, output),
    SignPathApiError,
    "is not completed",
  );
  assertEquals(await entries(dir), []);
});

Deno.test("download: an oversized artifact is refused and leaves no partial file", async () => {
  const { dir, output } = await target();
  await Deno.writeTextFile(output, "previous");
  const net = fakeFetch(() => new Response("0123456789"));
  const error = await assertRejects(
    () => download(net, output, (s) => s.maxDownloadBytes(4)),
    SignPathRequestError,
    "larger than 4 bytes",
  );
  assertStringIncludes(error.message, "maxDownloadBytes");
  assertEquals(await entries(dir), ["zuke.exe"]);
  assertEquals(await Deno.readTextFile(output), "previous");
});

Deno.test("download: a stream that fails or stalls leaves no partial file", async () => {
  const { dir, output } = await target();
  const broken = fakeFetch(() =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("half"));
          controller.error(new Error(`reset while sending ${TOKEN}`));
        },
      }),
    )
  );
  const error = await assertRejects(
    () => download(broken, output),
    SignPathRequestError,
    "reset while sending",
  );
  assertEquals(error.message.includes(TOKEN), false);
  assertEquals(await entries(dir), []);
  const stall = fakeFetch((request) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("half"));
          request.signal?.addEventListener(
            "abort",
            () => controller.error(new Error("aborted")),
          );
        },
      }),
    )
  );
  await assertRejects(
    () => download(stall, output, (s) => s.downloadTimeout(20)),
    SignPathRequestError,
    "timed out after 20 ms",
  );
  assertEquals(await entries(dir), []);
});

Deno.test("download: the output and the request id are required", async () => {
  const net = fakeFetch(() => new Response("x"));
  await assertRejects(
    () =>
      SignPathTasks.download((s) =>
        connected<SignPathDownloadSettings>(net)(s).signingRequestId(REQUEST)
      ),
    Error,
    "s.output(...)",
  );
  await assertRejects(
    () =>
      SignPathTasks.download((s) =>
        connected<SignPathDownloadSettings>(net)(s).output("x.exe")
      ),
    Error,
    "s.signingRequestId(...)",
  );
  assertEquals(net.sent.length, 0);
});

Deno.test("download: a redirect to a location that is not a URL is a request error", async () => {
  // Regression (adversarial review): this used to escape as a raw TypeError.
  const { output } = await target();
  const net = fakeFetch(() =>
    new Response("moved", {
      status: 302,
      headers: { location: "http://[bad" },
    })
  );
  await assertRejects(
    () => download(net, output),
    SignPathRequestError,
    "location that is not a URL",
  );
});

Deno.test("download: a destination that cannot be created releases the connection", async () => {
  // Regression (adversarial review): the response body used to be left unread.
  const { dir } = await target();
  await Deno.writeTextFile(`${dir}/file`, "x");
  let cancelled = false;
  const net = fakeFetch(() =>
    new Response(new ReadableStream({ cancel: () => void (cancelled = true) }))
  );
  await assertRejects(() => download(net, `${dir}/file/zuke.exe`));
  assertEquals(cancelled, true);
});

Deno.test("download: an output that is a directory fails and leaves no partial file", async () => {
  const { dir } = await target();
  await Deno.mkdir(`${dir}/zuke.exe`);
  const net = fakeFetch(() => new Response("signed"));
  await assertRejects(
    () => download(net, `${dir}/zuke.exe`),
    SignPathRequestError,
  );
  assertEquals(await entries(dir), ["zuke.exe"]);
});
