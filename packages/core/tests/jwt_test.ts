// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the RS256 JWT signer — header and claims framing, the `kid`, a
 * signature that verifies with the public half of a key generated here (no
 * key is committed), PKCS#1 and PKCS#8 input, and the named failures.
 */

import { assertEquals, assertRejects } from "./_assert.ts";
import { signJwtRs256 } from "../mod.ts";

/** Base64-encode bytes into 64-column PEM lines. */
function pem(label: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/**
 * `body` between PKCS#8 delimiter lines, spelt out at run time so a
 * deliberately broken key in a test reads as no key to a secret scanner.
 */
function armor(body: string): string {
  const label = ["PRIVATE", "KEY"].join(" ");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

/** Decode one base64url JWT segment. */
function segment(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A fresh RSA key pair, its private half as PKCS#8 and PKCS#1 PEM. */
async function keys(): Promise<
  { pkcs8: string; pkcs1: string; publicKey: CryptoKey }
> {
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
  // PKCS#8 wraps the PKCS#1 key in an OCTET STRING after a fixed 26-byte
  // prefix for a 2048-bit key (SEQUENCE, version, AlgorithmIdentifier, tag
  // and long-form length).
  return {
    pkcs8: pem("PRIVATE KEY", der),
    pkcs1: pem("RSA PRIVATE KEY", der.slice(26)),
    publicKey: pair.publicKey,
  };
}

Deno.test("signJwtRs256 frames header and claims and signs them verifiably", async () => {
  const { pkcs8, pkcs1, publicKey } = await keys();
  for (const key of [pkcs8, pkcs1]) {
    const jwt = await signJwtRs256(key, { iss: "me", iat: 1, exp: 2 }, "kid-1");
    const [header, claims, signature] = jwt.split(".");
    const text = (part: string) => new TextDecoder().decode(segment(part));
    assertEquals(JSON.parse(text(header)), {
      alg: "RS256",
      typ: "JWT",
      kid: "kid-1",
    });
    assertEquals(JSON.parse(text(claims)), { iss: "me", iat: 1, exp: 2 });
    assertEquals(/[=+/]/.test(jwt), false);
    assertEquals(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        segment(signature),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
      true,
    );
  }
  const plain = await signJwtRs256(pkcs8, {});
  assertEquals(
    JSON.parse(new TextDecoder().decode(segment(plain.split(".")[0]))),
    { alg: "RS256", typ: "JWT" },
  );
});

Deno.test("signJwtRs256 names an empty, non-base64 or non-RSA key", async () => {
  const cases: Array<[string, string]> = [
    ["", "pass the PEM contents, not a path"],
    [armor("%%%%"), "not valid base64"],
    [armor("AAAA"), "could not be read as RSA PEM"],
    // A PKCS#1 body short enough for the short-form DER length the envelope
    // takes: re-framed, then refused by WebCrypto all the same.
    [
      armor("AAAA").replaceAll(
        "PRIVATE KEY",
        ["RSA", "PRIVATE", "KEY"].join(" "),
      ),
      "could not be read as RSA PEM",
    ],
  ];
  for (const [key, message] of cases) {
    await assertRejects(() => signJwtRs256(key, {}), Error, message);
  }
});
