// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore Здравей

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  GooglePlayError,
  type GooglePlaySettings,
  GooglePlayTasks,
} from "../mod.ts";
import {
  fakeGoogle,
  type PlayCall,
  type PlayRoute,
  serviceAccountKey,
} from "./_play.ts";

const KEY = await serviceAccountKey();
const PACKAGE = "com.example.app";
const EDITS =
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/edits`;
const BUNDLE = await Deno.makeTempFile({ suffix: ".aab" });
await Deno.writeFile(BUNDLE, new Uint8Array(1234));

/** A fake Google that signs in and accepts an edit; `extra` answers first. */
function google(extra: PlayRoute = () => undefined) {
  return fakeGoogle((call) => {
    const answer = extra(call);
    if (answer !== undefined) return answer;
    const { method, url } = call;
    if (url === "https://oauth2.googleapis.com/token") {
      return { body: { access_token: "ya29.secret-token", expires_in: 3599 } };
    }
    if (method === "POST" && url === EDITS) return { body: { id: "edit-1" } };
    if (url.includes("/upload/") && url.endsWith("/bundles?uploadType=media")) {
      return { body: { versionCode: 42, sha256: "abc" } };
    }
    if (method === "DELETE") return { status: 204 };
    if (method === "PUT" || url.includes(":commit")) return { body: {} };
    return undefined;
  });
}

/** Settings against `fake` with the fixed app and key. */
function against(
  fake: { fetch: typeof fetch },
  log: string[] = [],
): (s: GooglePlaySettings) => GooglePlaySettings {
  return (s) =>
    s.serviceAccount(KEY.json).packageName(PACKAGE).bundle(BUNDLE)
      .fetch(fake.fetch).now(() => 1_700_000_000_000).log((l) => log.push(l));
}

/** The decoded JWT payload of a form call's assertion. */
function assertionOf(call: PlayCall): { parts: string[]; claims: unknown } {
  const body = call.body;
  if (typeof body !== "object" || body === null) throw new Error("not a form");
  const assertion = Reflect.get(body, "assertion");
  const parts = String(assertion).split(".");
  const decode = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return { parts, claims: JSON.parse(decode(parts[1])) };
}

Deno.test("upload signs in, uploads, releases and commits in one edit", async () => {
  const fake = google();
  const log: string[] = [];
  const result = await GooglePlayTasks.upload((s) =>
    against(fake, log)(s).releaseNotes("Hello", "en-US").releaseNotes(
      "Здравей",
      "bg",
    )
  );
  assertEquals(result, {
    packageName: PACKAGE,
    versionCode: 42,
    track: "internal",
    status: "completed",
  });
  const [token, open, bundle, track, commit] = fake.calls;
  assertEquals(fake.calls.length, 5);
  assertEquals(token.method, "POST");
  assertEquals(
    Reflect.get(Object(token.body), "grant_type"),
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  const { parts, claims } = assertionOf(token);
  assertEquals(
    JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/"))),
    {
      alg: "RS256",
      typ: "JWT",
      kid: "kid-1",
    },
  );
  assertEquals(claims, {
    iss: "play@example.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: 1_700_000_000,
    exp: 1_700_003_600,
  });
  const signature = Uint8Array.from(
    atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  assertEquals(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      KEY.publicKey,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    ),
    true,
  );
  assertEquals(open, {
    method: "POST",
    url: EDITS,
    body: undefined,
    authorization: "Bearer ya29.secret-token",
    contentType: "",
  });
  assertEquals(
    bundle.url,
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/edit-1/bundles?uploadType=media`,
  );
  assertEquals(bundle.contentType, "application/octet-stream");
  assertEquals(bundle.body, 1234);
  assertEquals(track.method, "PUT");
  assertEquals(track.url, `${EDITS}/edit-1/tracks/internal`);
  assertEquals(track.contentType, "application/json");
  assertEquals(track.body, {
    track: "internal",
    releases: [{
      versionCodes: ["42"],
      status: "completed",
      releaseNotes: [{ language: "en-US", text: "Hello" }, {
        language: "bg",
        text: "Здравей",
      }],
    }],
  });
  assertEquals(commit.method, "POST");
  assertEquals(commit.url, `${EDITS}/edit-1:commit`);
  assertEquals(log, [
    `Google Play: uploaded ${BUNDLE} as version code 42`,
    `Google Play: released version code 42 of ${PACKAGE} to internal (completed)`,
  ]);
});

Deno.test("a draft on a custom track without notes, committed without review", async () => {
  const fake = google();
  const result = await GooglePlayTasks.upload((s) =>
    against(fake)(s).track("qa team").status("draft").changesNotSentForReview()
  );
  assertEquals(result.track, "qa team");
  assertEquals(result.status, "draft");
  const [, , , track, commit] = fake.calls;
  assertEquals(track.url, `${EDITS}/edit-1/tracks/qa%20team`);
  assertEquals(track.body, {
    track: "qa team",
    releases: [{ versionCodes: ["42"], status: "draft" }],
  });
  assertEquals(
    commit.url,
    `${EDITS}/edit-1:commit?changesNotSentForReview=true`,
  );
});

Deno.test("the required settings are checked before anything is sent", async () => {
  const fake = google();
  await assertRejects(
    () =>
      GooglePlayTasks.upload((s) => s.fetch(fake.fetch).packageName(PACKAGE)),
    Error,
    ".serviceAccount(), .packageName() and .bundle() are required",
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("a missing bundle fails before signing in", async () => {
  const fake = google();
  await assertRejects(
    () =>
      GooglePlayTasks.upload((s) =>
        against(fake)(s).bundle("/nowhere/app.aab")
      ),
    Deno.errors.NotFound,
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("a key that is not JSON, or not a service-account key, is refused without being quoted", async () => {
  const fake = google();
  for (
    const [json, message] of [
      ["not json", "is not the JSON of a service-account key"],
      [
        JSON.stringify({ client_email: "x" }),
        "has no client_email or private_key",
      ],
      [
        JSON.stringify({ client_email: "x", private_key: "hunter2-not-a-key" }),
        "private_key is not an RSA key",
      ],
    ]
  ) {
    const error = await assertRejects(
      () =>
        GooglePlayTasks.upload((s) => against(fake)(s).serviceAccount(json)),
      GooglePlayError,
      message,
    );
    assertEquals(error.message.includes("hunter2"), false);
  }
  assertEquals(fake.calls.length, 0);
});

Deno.test("a refused sign-in reports Google's reason and the status", async () => {
  const fake = google((call) =>
    call.url.endsWith("/token")
      ? {
        status: 401,
        body: {
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        },
      }
      : undefined
  );
  const error = await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    "signing in as play@example.iam.gserviceaccount.com failed (HTTP 401): Invalid JWT Signature.",
  );
  assertEquals(
    error instanceof GooglePlayError ? error.status : undefined,
    401,
  );
  assertEquals(fake.calls.length, 1);
});

Deno.test("a sign-in answer without a token is an error", async () => {
  const fake = google((call) =>
    call.url.endsWith("/token")
      ? { body: { error: "server_error" } }
      : undefined
  );
  await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    "failed (HTTP 200): server_error",
  );
});

Deno.test("an edit the API opens without an id is an error", async () => {
  const fake = google((call) =>
    call.method === "POST" && call.url === EDITS ? { body: {} } : undefined
  );
  await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    "opened an edit without an id",
  );
});

Deno.test("a refused step deletes the edit and reports Google's message, flattened", async () => {
  const fake = google((call) =>
    call.method === "PUT"
      ? {
        status: 400,
        body: {
          error: {
            code: 400,
            message:
              "Only releases with status draft may be\ncreated on draft app.\u001b[31m " +
              "x".repeat(600),
          },
        },
      }
      : undefined
  );
  const error = await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    `PUT /androidpublisher/v3/applications/${PACKAGE}/edits/edit-1/tracks/internal failed (HTTP 400): Only releases with status draft may be created on draft app. [31m xxx`,
  );
  assertEquals(
    error instanceof GooglePlayError ? error.status : undefined,
    400,
  );
  assertEquals(error.message.length < 700, true);
  const last = fake.calls[fake.calls.length - 1];
  assertEquals([last.method, last.url], ["DELETE", `${EDITS}/edit-1`]);
});

Deno.test("a bundle answer without a versionCode fails and deletes the edit", async () => {
  const fake = google((call) =>
    call.url.includes("/bundles?") ? { body: { sha256: "abc" } } : undefined
  );
  await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    "without a versionCode",
  );
  assertEquals(fake.calls[fake.calls.length - 1].method, "DELETE");
});

Deno.test("a failed cleanup does not hide the step's error", async () => {
  const fake = google((call) =>
    call.method === "DELETE"
      ? { status: 500, body: "not json" }
      : call.url.endsWith(":commit")
      ? { status: 403, body: { error: { message: "Forbidden" } } }
      : undefined
  );
  await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    ":commit failed (HTTP 403): Forbidden",
  );
});

Deno.test("an error body that is not JSON still names the status", async () => {
  const fake = google((call) =>
    call.url.endsWith(":commit") ? { status: 502, body: "<html>" } : undefined
  );
  const error = await assertRejects(
    () => GooglePlayTasks.upload(against(fake)),
    GooglePlayError,
    ":commit failed (HTTP 502).",
  );
  assertEquals(
    error instanceof GooglePlayError ? error.status : undefined,
    502,
  );
});

Deno.test("an upload that outlives .timeout() is aborted, and the edit deleted", async () => {
  const seen: string[] = [];
  const fake = google((call) => {
    seen.push(call.method);
    return undefined;
  });
  const hanging: typeof fetch = (input, init) => {
    if (String(input).includes("/bundles?")) {
      return new Promise((_, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
        )
      );
    }
    return fake.fetch(input, init);
  };
  await assertRejects(
    () =>
      GooglePlayTasks.upload((s) => against(fake)(s).fetch(hanging).timeout(5)),
    GooglePlayError,
    `uploading ${BUNDLE} took longer than 0s; raise .timeout()`,
  );
  assertEquals(seen, ["POST", "POST", "DELETE"]);
});

Deno.test(".timeout() refuses less than a millisecond", () => {
  assertThrows(
    () => GooglePlayTasks.upload((s) => s.timeout(0)),
    Error,
    ".timeout() must be at least 1 ms, not 0",
  );
});

Deno.test("a plaintext apiUrl or token_uri is refused before anything is sent", async () => {
  const fake = google();
  await assertRejects(
    () =>
      GooglePlayTasks.upload((s) =>
        against(fake)(s).apiUrl("http://play.example.com")
      ),
    Error,
    "Google Play apiUrl must use https",
  );
  const plain = await serviceAccountKey({
    token_uri: "http://oauth.example.com/token",
  });
  await assertRejects(
    () =>
      GooglePlayTasks.upload((s) =>
        against(fake)(s).serviceAccount(plain.json)
      ),
    Error,
    "service-account token_uri must use https",
  );
  assertEquals(fake.calls.length, 0);
});

Deno.test("a loopback apiUrl is allowed, and a trailing slash dropped; the default token_uri fills in", async () => {
  const fake = google((call) =>
    call.url.startsWith("http://127.0.0.1:8080/")
      ? { body: { id: "edit-1", versionCode: 7 } }
      : undefined
  );
  const key = await serviceAccountKey({ token_uri: undefined });
  const result = await GooglePlayTasks.upload((s) =>
    against(fake)(s).serviceAccount(key.json).apiUrl("http://127.0.0.1:8080/")
  );
  assertEquals(result.versionCode, 7);
  assertEquals(fake.calls[0].url, "https://oauth2.googleapis.com/token");
  assertStringIncludes(
    fake.calls[1].url,
    "http://127.0.0.1:8080/androidpublisher/",
  );
});
