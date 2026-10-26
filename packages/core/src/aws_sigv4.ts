// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * AWS Signature Version 4, over the exact request a transport sends, with
 * WebCrypto's HMAC-SHA256. Shared by every package that talks to an AWS API
 * directly: the {@link "./s3_cache.ts" | S3 cache store} here, and the
 * Amazon Managed Prometheus credential source in `@zuke/prometheus`.
 *
 * Built step by step as the IAM user guide's "Create a signed AWS API
 * request" describes it, and checked against the AWS SigV4 test suite:
 *
 * 1. the canonical request — method, canonical URI (for every service but
 *    S3, the path as sent, normalised — dot segments and empty segments
 *    removed — and then percent-encoded again, so `%20` on the wire is
 *    `%2520` here, as botocore's `SigV4Auth` does; for S3, the path exactly
 *    as sent), canonical query (each name and value decoded and re-encoded,
 *    sorted by name then value), canonical headers (lower-case names, trimmed
 *    values, sorted), the signed-header list, and the hex SHA-256 of the body;
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

import { sha256Hex } from "./internal.ts";
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

/**
 * The outgoing request a signature is computed over — exactly what will be
 * sent, so the signature verifies.
 */
export interface AwsSignableRequest {
  /** The HTTP method. */
  readonly method: string;
  /** The absolute URL, including the query string, percent-encoded as sent. */
  readonly url: string;
  /**
   * The headers set so far, with lower-case names. Every one of them is
   * signed, so a header added after signing fails the request.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** The exact body bytes; empty for a request without one. */
  readonly body: Uint8Array;
}

/** What signing produced: the intermediate strings and the headers to add. */
export interface AwsSignature {
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

/** A percent-encoded query component, decoded — or an error saying so. */
function decode(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    throw new Error("aws: the URL's query is not valid percent-encoding");
  }
}

/**
 * The canonical URI. For S3 it is the path exactly as sent: S3 neither
 * normalises nor re-encodes it (botocore's `S3SigV4Auth`). For every other
 * service it is the path (already percent-encoded) normalised, then each
 * segment percent-encoded once more — the double encoding SigV4 requires.
 * The URL parser has already resolved dot segments (`.`, `..`, and their
 * `%2E` spellings), so normalising is dropping empty segments (`//`). A
 * trailing `/` is kept.
 */
function canonicalUri(url: URL, service: string): string {
  const path = url.pathname;
  if (service === "s3") return path;
  const segments = path.split("/").filter((segment) => segment !== "")
    .map(uriEncode);
  const last = path.endsWith("/") && segments.length > 0 ? "/" : "";
  return `/${segments.join("/")}${last}`;
}

/**
 * The canonical query string: each parameter's name and value decoded (a
 * `+` read as a space, as a form-encoding client writes it), RFC 3986 encoded,
 * and sorted by name, then value.
 */
function canonicalQuery(url: URL): string {
  const pairs = url.search.slice(1).split("&").filter((pair) => pair !== "")
    .map((pair): [string, string] => {
      const at = pair.indexOf("=");
      const [name, value] = at === -1
        ? [pair, ""]
        : [pair.slice(0, at), pair.slice(at + 1)];
      const read = (part: string) =>
        uriEncode(decode(part.replace(/\+/g, " ")));
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
  request: AwsSignableRequest,
  credentials: AwsCredentials,
  region: string,
  service: string,
  now: number,
): Promise<AwsSignature> {
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
    canonicalUri(url, service),
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
