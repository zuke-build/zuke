// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A fake App Store Connect API for tests: a `fetch` that records each request
 * and answers from a route table, and a freshly generated API key.
 *
 * @module
 */

/** One request the fake received. */
export interface AscCall {
  method: string;
  /** The path and query, decoded. */
  path: string;
  body: unknown;
  authorization: string;
}

/** An answer: a status and a JSON body (or none). */
export interface AscAnswer {
  status?: number;
  body?: unknown;
}

/** Route `METHOD /path?query` (decoded) to an answer, or `undefined` for 404. */
export type AscRoute = (call: AscCall) => AscAnswer | undefined;

/** A fake API: its `fetch` and what it was sent. */
export function fakeAsc(route: AscRoute): {
  fetch: typeof fetch;
  calls: AscCall[];
} {
  const calls: AscCall[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const text = typeof init?.body === "string" ? init.body : undefined;
    const call: AscCall = {
      method: init?.method ?? "GET",
      path: decodeURIComponent(url.pathname + url.search),
      body: text === undefined ? undefined : JSON.parse(text),
      authorization: headers.get("Authorization") ?? "",
    };
    calls.push(call);
    const answer = route(call) ?? { status: 404, body: { errors: [] } };
    await Promise.resolve();
    return new Response(
      answer.body === undefined ? null : JSON.stringify(answer.body),
      { status: answer.status ?? 200 },
    );
  };
  return { fetch: fake, calls };
}

/** A new P-256 key: its PEM private key and its public key. */
export async function apiKey(): Promise<
  { pem: string; publicKey: CryptoKey }
> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  let binary = "";
  for (const byte of der) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/.{64}/g, "$&\n");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}
