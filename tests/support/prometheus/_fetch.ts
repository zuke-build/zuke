// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** A recording fake `fetch` and envelope builders for the Prometheus tests. */

/** One request the fake received, as it would have gone on the wire. */
export interface SentRequest {
  /** The HTTP method. */
  method: string;
  /** The full URL. */
  url: URL;
  /** The headers. */
  headers: Headers;
  /** The body, decoded; `""` when there was none. */
  body: string;
  /** The `redirect` mode the request asked for. */
  redirect: RequestRedirect | undefined;
  /** The request's signal. */
  signal: AbortSignal | null | undefined;
}

/** A fake `fetch` that records each request and answers with `respond`. */
export function fakeFetch(
  respond: (request: SentRequest) => Response | Promise<Response>,
): typeof fetch & { sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    const request: SentRequest = {
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers),
      body: body instanceof Uint8Array
        ? new TextDecoder().decode(body)
        : typeof body === "string"
        ? body
        : "",
      redirect: init?.redirect,
      signal: init?.signal,
    };
    sent.push(request);
    return await respond(request);
  };
  return Object.assign(fetcher, { sent });
}

/** A successful envelope around `data`, with optional annotations. */
export function success(
  data: unknown,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ status: "success", data, ...extra });
}

/** A successful instant-query envelope. */
export function queryResult(resultType: string, result: unknown): Response {
  return success({ resultType, result });
}

/** A vector of float samples, each `[labels, value]`. */
export function vector(
  ...samples: Array<[Record<string, string>, string]>
): Response {
  return queryResult(
    "vector",
    samples.map(([metric, value]) => ({ metric, value: [1700000000, value] })),
  );
}

/** The base URL every test talks to. */
export const BASE = "https://prom.example";
