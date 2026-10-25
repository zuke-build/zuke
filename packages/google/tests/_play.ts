// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A fake Google (token endpoint and Play Developer API) for tests: a `fetch`
 * that records each request and answers from a route table, and a freshly
 * generated service-account key.
 *
 * @module
 */

/** One request the fake received. */
export interface PlayCall {
  method: string;
  /** The URL as sent. */
  url: string;
  /** The body: parsed JSON, form fields, or the byte count of a raw upload. */
  body: unknown;
  authorization: string;
  contentType: string;
}

/** An answer: a status and a JSON body (or none). */
export interface PlayAnswer {
  status?: number;
  body?: unknown;
}

/** Route a call to an answer, or `undefined` for 404. */
export type PlayRoute = (call: PlayCall) => PlayAnswer | undefined;

/** A fake Google: its `fetch` and what it was sent. */
export function fakeGoogle(route: PlayRoute): {
  fetch: typeof fetch;
  calls: PlayCall[];
} {
  const calls: PlayCall[] = [];
  const fake: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const body = typeof raw === "string"
      ? JSON.parse(raw)
      : raw instanceof URLSearchParams
      ? Object.fromEntries(raw)
      : raw instanceof Uint8Array
      ? raw.byteLength
      : undefined;
    const call: PlayCall = {
      method: init?.method ?? "GET",
      url: String(input),
      body,
      authorization: headers.get("Authorization") ?? "",
      contentType: headers.get("Content-Type") ?? "",
    };
    calls.push(call);
    const answer = route(call) ?? { status: 404, body: { error: {} } };
    await Promise.resolve();
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      { status: answer.status ?? 200 },
    );
  };
  return { fetch: fake, calls };
}

/** A new RSA key: a service-account key JSON holding it, and its public key. */
export async function serviceAccountKey(
  extra: Record<string, unknown> = {},
): Promise<{ json: string; pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/.{64}/g, "$&\n");
  const pem =
    `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  return {
    json: JSON.stringify({
      type: "service_account",
      client_email: "play@example.iam.gserviceaccount.com",
      private_key: pem,
      private_key_id: "kid-1",
      token_uri: "https://oauth2.googleapis.com/token",
      ...extra,
    }),
    pem,
    publicKey: pair.publicKey,
  };
}
