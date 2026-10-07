// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Seams for the built-in credential source tests: a credentials context over
 * a fake environment, file system, clock and `fetch`, a sample outgoing
 * request, and a generated RSA key (no key is ever committed).
 */

import type {
  PrometheusCredentialsContext,
  PrometheusOutgoingRequest,
} from "../mod.ts";
import { fakeFetch, type SentRequest } from "./_fetch.ts";

/** A mutable clock, in epoch ms. */
export interface Clock {
  /** The current instant. */
  now: number;
}

/** What a test context reads, all optional. */
export interface Seams {
  /** The environment. */
  env?: Record<string, string>;
  /** The file system: path to contents. A missing path throws NotFound. */
  files?: Record<string, string>;
  /** The clock (default: a fixed 2026-01-01T00:00:00Z). */
  clock?: Clock;
  /** The `fetch` (default: one that fails every request). */
  fetch?: typeof fetch;
  /** The signal (default: never fires). */
  signal?: AbortSignal;
}

/** 2026-01-01T00:00:00Z, the default test instant. */
export const T0 = Date.parse("2026-01-01T00:00:00Z");

/** A credentials context over `seams`. */
export function context(seams: Seams = {}): PrometheusCredentialsContext {
  const clock = seams.clock ?? { now: T0 };
  const files = seams.files ?? {};
  return {
    readEnv: (name) => seams.env?.[name],
    readTextFile: (path) =>
      Object.hasOwn(files, path)
        ? Promise.resolve(files[path])
        : Promise.reject(new Deno.errors.NotFound(`no such file: ${path}`)),
    now: () => clock.now,
    fetch: seams.fetch ?? fakeFetch(() => {
      throw new TypeError("unexpected request");
    }),
    signal: seams.signal ?? new AbortController().signal,
  };
}

/** The request a source authenticates in the unit tests. */
export const REQUEST: PrometheusOutgoingRequest = {
  method: "GET",
  url: "https://prom.example/api/v1/query?query=up",
  headers: { accept: "application/json" },
  body: new Uint8Array(0),
};

/**
 * A fake `fetch` answering by `"<METHOD> <origin><pathname>"`; any other
 * request is a 404 naming it.
 */
export function routes(
  table: Record<string, (request: SentRequest) => Response>,
): typeof fetch & { sent: SentRequest[] } {
  return fakeFetch((request) => {
    const key =
      `${request.method} ${request.url.origin}${request.url.pathname}`;
    const answer = Object.hasOwn(table, key) ? table[key] : undefined;
    return answer === undefined
      ? new Response(`no route for ${key}`, { status: 404 })
      : answer(request);
  });
}

/** A fresh RSA key pair, the private half as PKCS#8 PEM. */
export async function rsaKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
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
  const body = btoa(binary).replace(/(.{64})/g, "$1\n");
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  };
}

/** Decode one base64url JWT segment to bytes. */
export function base64UrlBytes(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Decode one base64url JWT segment as JSON. */
export function base64UrlJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
}

/** A form body as a plain object. */
export function form(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}
