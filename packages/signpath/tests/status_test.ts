// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import {
  SignPathApiError,
  SignPathRequestError,
  type SignPathStatusSettings,
  SignPathTasks,
} from "../mod.ts";
import {
  API,
  connected,
  fakeFetch,
  ORG,
  REQUEST,
  routes,
  seams,
  status,
  STATUS_URL,
  TOKEN,
  WEB_URL,
} from "./_fetch.ts";

Deno.test("status: reads the documented answer, with the token as a bearer", async () => {
  const net = routes({ [`GET ${STATUS_URL}`]: [status("WaitingForApproval")] });
  const result = await SignPathTasks.status((s) =>
    connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
  );
  assertEquals(result, {
    signingRequestId: REQUEST,
    status: "WaitingForApproval",
    workflowStatus: "WaitingForApproval",
    isFinalStatus: false,
    webUrl: WEB_URL,
  });
  const [sent] = net.sent;
  assertEquals(sent.headers.get("authorization"), `Bearer ${TOKEN}`);
  assertEquals(sent.headers.get("accept"), "application/json");
  assertEquals(sent.redirect, "manual");
});

Deno.test("status: the organization and token default to the environment", async () => {
  const net = routes({ [`GET ${STATUS_URL}`]: [status("Completed")] });
  const env = new Map([
    ["SIGNPATH_ORGANIZATION_ID", ORG],
    ["SIGNPATH_API_TOKEN", TOKEN],
  ]);
  const result = await SignPathTasks.status((s) =>
    seams<SignPathStatusSettings>(net, { env })(s).organizationId("")
      .signingRequestId(REQUEST)
  );
  assertEquals(result.isFinalStatus, true);
  assertEquals(net.sent[0].headers.get("authorization"), `Bearer ${TOKEN}`);
});

Deno.test("status: a missing isFinalStatus falls back to the documented final statuses", async () => {
  for (
    const [value, final] of [["Denied", true], ["InProgress", false]] as const
  ) {
    const net = fakeFetch(() => Response.json({ status: value }));
    const result = await SignPathTasks.status((s) =>
      connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
    );
    assertEquals(result.isFinalStatus, final);
    assertEquals(result.workflowStatus, undefined);
  }
  const net = fakeFetch(() =>
    Response.json({ status: "SomethingNew", isFinalStatus: true })
  );
  const result = await SignPathTasks.status((s) =>
    connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
  );
  assertEquals(result.isFinalStatus, true);
});

Deno.test("status: server text is stripped of control characters and the token", async () => {
  const esc = String.fromCharCode(27);
  const net = fakeFetch(() =>
    Response.json({
      status: `Done${esc}[2J\nforged ${TOKEN}`,
      workflowStatus: `Processing ${TOKEN}`,
    })
  );
  const result = await SignPathTasks.status((s) =>
    connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
  );
  assertEquals(result.status.includes(esc), false);
  assertEquals(result.status.includes("\n"), false);
  assertEquals(result.status.includes(TOKEN), false);
  assertEquals(result.workflowStatus?.includes(TOKEN), false);
});

Deno.test("status: a malformed answer is a request error naming the endpoint", async () => {
  for (
    const body of ["not json", "[1,2]", JSON.stringify({ status: 7 }), ""]
  ) {
    const net = fakeFetch(() => new Response(body));
    const error = await assertRejects(
      () =>
        SignPathTasks.status((s) =>
          connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
        ),
      SignPathRequestError,
      `/v1/${ORG}/SigningRequests/${REQUEST}/Status`,
    );
    assertStringIncludes(error.message, 'no "status"');
  }
});

Deno.test("status: a refusal carries SignPath's message, scrubbed of the token", async () => {
  const net = fakeFetch(() =>
    Response.json({ error: `token ${TOKEN} is not valid` }, { status: 401 })
  );
  const error = await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
      ),
    SignPathApiError,
    "HTTP 401",
  );
  assertEquals(error.message.includes(TOKEN), false);
  assertStringIncludes(error.message, "is not valid");
  assertEquals(error instanceof SignPathApiError && error.status, 401);
});

Deno.test("status: the request id must be a GUID, and is required", async () => {
  const net = fakeFetch(() => Response.json({}));
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        connected<SignPathStatusSettings>(net)(s).signingRequestId(
          "../../Admin?x=1",
        )
      ),
    Error,
    "signing request id is not a GUID",
  );
  await assertRejects(
    () =>
      SignPathTasks.status((s) => connected<SignPathStatusSettings>(net)(s)),
    Error,
    "s.signingRequestId(...)",
  );
  assertEquals(net.sent.length, 0);
});

Deno.test("connection: the organization and token are required and checked", async () => {
  const net = fakeFetch(() => Response.json({}));
  const base = seams<SignPathStatusSettings>(net);
  await assertRejects(
    () => SignPathTasks.status((s) => base(s).signingRequestId(REQUEST)),
    Error,
    "SIGNPATH_API_TOKEN",
  );
  await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        base(s).apiToken(TOKEN).signingRequestId(REQUEST)
      ),
    Error,
    "SIGNPATH_ORGANIZATION_ID",
  );
  const wrongSetter = await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        base(s).apiToken(TOKEN).organizationId(TOKEN).signingRequestId(REQUEST)
      ),
    Error,
    "organization id is not a GUID",
  );
  assertEquals(wrongSetter.message.includes(TOKEN), false);
  const newline = await assertRejects(
    () =>
      SignPathTasks.status((s) =>
        base(s).apiToken(`${TOKEN}\r\nX-Evil: 1`).organizationId(ORG)
          .signingRequestId(REQUEST)
      ),
    Error,
    "whitespace or non-ASCII",
  );
  assertEquals(newline.message.includes(TOKEN), false);
  assertEquals(net.sent.length, 0);
});

Deno.test("connection: the API URL must be https, without userinfo", async () => {
  const net = fakeFetch(() => Response.json({ status: "InProgress" }));
  const run = (url: string) =>
    SignPathTasks.status((s) =>
      connected<SignPathStatusSettings>(net)(s).apiUrl(url).signingRequestId(
        REQUEST,
      )
    );
  await assertRejects(
    () => run("http://signpath.internal/Api"),
    InsecureBackendUrlError,
  );
  await assertRejects(() => run("not a url"), Error, "not a valid URL");
  await assertRejects(() => run("ftp://x/Api"), Error, "must be an https URL");
  await assertRejects(
    () => run("https://user:pw@x/Api"),
    Error,
    "must not carry a user or password",
  );
  assertEquals(net.sent.length, 0);
  const local = await run("http://localhost:8080/Api/?q=1#f");
  assertEquals(
    net.sent[0].url.href,
    `http://localhost:8080/Api/v1/${ORG}/SigningRequests/${REQUEST}/Status`,
  );
  assertEquals(
    local.webUrl,
    `http://localhost:8080/Web/${ORG}/SigningRequests/${REQUEST}`,
  );
  const env = new Map([["ZUKE_ALLOW_INSECURE_URL", "1"]]);
  const plain = routes({});
  await assertRejects(() =>
    SignPathTasks.status((s) =>
      connected<SignPathStatusSettings>(plain, { env })(s)
        .apiUrl("http://signpath.internal/Api").signingRequestId(REQUEST)
    )
  );
  assertEquals(plain.sent[0].url.protocol, "http:");
});

Deno.test("status: the default API base is app.signpath.io", async () => {
  const net = routes({ [`GET ${STATUS_URL}`]: [status("InProgress")] });
  await SignPathTasks.status((s) =>
    connected<SignPathStatusSettings>(net)(s).signingRequestId(REQUEST)
  );
  assertEquals(net.sent[0].url.href.startsWith(API), true);
});
