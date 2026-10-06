// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * AWS Signature Version 4, over the exact request the transport sends, with
 * WebCrypto's HMAC-SHA256 — the signing half of the AWS credential source.
 *
 * Built step by step as the IAM user guide's "Create a signed AWS API
 * request" describes it, and checked against the AWS SigV4 test suite:
 *
 * 1. the canonical request — method, canonical URI (each path segment
 *    decoded and re-encoded per RFC 3986), canonical query (each name and
 *    value decoded and re-encoded, sorted by name then value), canonical
 *    headers (lower-case names, trimmed values, sorted), the signed-header
 *    list, and the hex SHA-256 of the body;
 * 2. the string to sign — `AWS4-HMAC-SHA256`, the `x-amz-date`, the
 *    credential scope `<date>/<region>/<service>/aws4_request`, and the hex
 *    SHA-256 of the canonical request;
 * 3. the signing key — HMAC chained over `AWS4<secret>`, the date, the region,
 *    the service and `aws4_request`;
 * 4. the `Authorization` header carrying the hex HMAC of the string to sign.
 *
 * Every header the request already carries is signed, together with `host`,
 * `x-amz-date` and — for temporary credentials — `x-amz-security-token`.
 *
 * @module
 */

import { sha256Hex } from "@zuke/core";
import type { PrometheusOutgoingRequest } from "./credentials.ts";
import { uriEncode } from "./uri.ts";

/** An AWS access key, with the session token temporary credentials carry. */
export interface AwsCredentials {
  /** The access key id (`AKIA…` long-term, `ASIA…` temporary). */
  readonly accessKeyId: string;
  /** The secret access key. Never sent; only used to derive the signing key. */
  readonly secretAccessKey: string;
  /** The session token of temporary credentials. */
  readonly sessionToken?: string;
}

/** What signing produced: the intermediate strings and the headers to add. */
export interface SigV4Signature {
  /** The canonical request (step 1). */
  readonly canonicalRequest: string;
  /** The string to sign (step 2). */
  readonly stringToSign: string;
  /** The headers to add: `x-amz-date`, `x-amz-security-token`, `authorization`. */
  readonly headers: Readonly<Record<string, string>>;
}

/** The signing algorithm's name, as the header and string to sign spell it. */
const ALGORITHM = "AWS4-HMAC-SHA256";

/** `bytes` as lower-case hex. */
function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** HMAC-SHA256 of `data` under `key`. */
async function hmac(
  key: Uint8Array<ArrayBuffer> | ArrayBuffer,
  data: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
}

/** A percent-encoded URL component, decoded — or an error saying which. */
function decode(component: string, what: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    throw new Error(`aws: the URL's ${what} is not valid percent-encoding`);
  }
}

/** The canonical URI: each path segment decoded, then RFC 3986 encoded. */
function canonicalUri(url: URL): string {
  return url.pathname.split("/").map((segment) =>
    uriEncode(decode(segment, "path"))
  ).join("/");
}

/**
 * The canonical query string: each parameter's name and value decoded (a
 * `+` read as a space, as Prometheus reads it), RFC 3986 encoded, and sorted
 * by name, then value.
 */
function canonicalQuery(url: URL): string {
  const pairs = url.search.slice(1).split("&").filter((pair) => pair !== "")
    .map((pair): [string, string] => {
      const at = pair.indexOf("=");
      const [name, value] = at === -1
        ? [pair, ""]
        : [pair.slice(0, at), pair.slice(at + 1)];
      const read = (part: string) =>
        uriEncode(decode(part.replace(/\+/g, " "), "query"));
      return [read(name), read(value)];
    });
  // Code-point order on the encoded strings, as AWS sorts. Two identical
  // pairs may land either way round: they encode the same.
  pairs.sort(([an, av], [bn, bv]) =>
    an === bn ? (av < bv ? -1 : 1) : (an < bn ? -1 : 1)
  );
  return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

/** `20150830T123600Z` for an epoch-ms instant. */
function amzDate(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(
    /\.\d{3}/,
    "",
  );
}

/**
 * Sign `request` for `service` in `region` at the instant `now` (epoch ms).
 * Pure apart from WebCrypto: the same inputs give the same signature.
 */
export async function signSigV4(
  request: PrometheusOutgoingRequest,
  credentials: AwsCredentials,
  region: string,
  service: string,
  now: number,
): Promise<SigV4Signature> {
  const url = new URL(request.url);
  const date = amzDate(now);
  const day = date.slice(0, 8);
  const added: Record<string, string> = { "x-amz-date": date };
  if (credentials.sessionToken !== undefined) {
    added["x-amz-security-token"] = credentials.sessionToken;
  }
  const headers = new Map<string, string>();
  for (
    const [name, value] of [
      ...Object.entries(request.headers),
      ["host", url.host],
      ...Object.entries(added),
    ]
  ) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  }
  const names = [...headers.keys()].sort();
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    request.method,
    canonicalUri(url),
    canonicalQuery(url),
    names.map((name) => `${name}:${headers.get(name)}\n`).join(""),
    signedHeaders,
    await sha256Hex(request.body),
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    date,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = await hmac(
    new TextEncoder().encode(`AWS4${credentials.secretAccessKey}`),
    day,
  );
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  return {
    canonicalRequest,
    stringToSign,
    headers: {
      ...added,
      authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/` +
        `${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
