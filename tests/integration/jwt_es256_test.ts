// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: `signJwtEs256` used the way a wrapper uses it — a real build,
 * driven through the CLI `main()` entry point, signs an ES256 token and
 * presents it to a server on loopback, which verifies the signature with the
 * public key and answers only a valid token. A key that is not P-256 fails
 * the build with a message that does not quote the key.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, signJwtEs256, target } from "../../packages/core/mod.ts";
import { runCli } from "./_harness.ts";

/** `bytes` as 64-column PEM lines under `label`. */
function pem(label: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/** Decode one base64url JWT segment. */
function segment(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A server that answers 200 only for a bearer token `publicKey` verifies. */
function verifier(publicKey: CryptoKey): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (request) => {
      const token = (request.headers.get("Authorization") ?? "")
        .replace(/^Bearer /, "");
      const [header, claims, signature] = token.split(".");
      const valid = signature !== undefined && await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        segment(signature),
        new TextEncoder().encode(`${header}.${claims}`),
      );
      return new Response(valid ? "ok" : "denied", {
        status: valid ? 200 : 401,
      });
    },
  );
}

/** A build that signs a token with `key` and calls `url` with it. */
function caller(key: string, url: string, statuses: number[]) {
  return class Call extends Build {
    call = target().executes(async () => {
      const iat = 1_800_000_000;
      const jwt = await signJwtEs256(
        key,
        { iss: "issuer", iat, exp: iat + 1200, aud: "appstoreconnect-v1" },
        "KEY1",
      );
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      await response.body?.cancel();
      statuses.push(response.status);
    });
  };
}

Deno.test("an ES256 token signed in a build verifies at the server", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const key = pem(
    "PRIVATE KEY",
    new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  );
  const server = verifier(pair.publicKey);
  try {
    const url = `http://127.0.0.1:${server.addr.port}/`;
    const statuses: number[] = [];
    const { code, err } = await runCli(caller(key, url, statuses), ["call"]);
    assertEquals(code, 0, err);
    assertEquals(statuses, [200]);
    // A key that is not P-256 fails the build, naming the problem only.
    const rsa = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const rsaKey = pem(
      "PRIVATE KEY",
      new Uint8Array(await crypto.subtle.exportKey("pkcs8", rsa.privateKey)),
    );
    const failed = await runCli(caller(rsaKey, url, statuses), ["call"]);
    assertEquals(failed.code, 1);
    assertStringIncludes(failed.err, "could not be read as a PKCS#8 P-256 PEM");
    const body = rsaKey.split("\n")[1];
    assertEquals(failed.err.includes(body), false);
    assertEquals(statuses, [200]);
  } finally {
    await server.shutdown();
  }
});
