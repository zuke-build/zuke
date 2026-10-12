// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** A recording fake `fetch`, fixed ids, and settings helpers for the SignPath tests. */

import type { SignPathConnectionSettings } from "../src/connection.ts";

/** The organization every test talks to. */
export const ORG = "0b5d3f2c-8c7e-4a1b-9d2e-3f4a5b6c7d8e";

/** A signing request id. */
export const REQUEST = "c2099ac1-b4b5-4b30-934e-3933c2d9922d";

/** The API token — obviously fake, long enough to be masked. */
export const TOKEN = "fake-signpath-token-for-tests";

/** The GitHub token — obviously fake. */
export const GH_TOKEN = "fake-github-token-for-tests";

/** The API base every test talks to. */
export const API = `https://app.signpath.io/Api/v1/${ORG}`;

/** The status endpoint for {@link REQUEST}. */
export const STATUS_URL = `${API}/SigningRequests/${REQUEST}/Status`;

/** The signed-artifact endpoint for {@link REQUEST}. */
export const ARTIFACT_URL = `${API}/SigningRequests/${REQUEST}/SignedArtifact`;

/** The web page for {@link REQUEST}. */
export const WEB_URL =
  `https://app.signpath.io/Web/${ORG}/SigningRequests/${REQUEST}`;

/** One request the fake received. */
export interface SentRequest {
  /** The HTTP method. */
  method: string;
  /** The full URL. */
  url: URL;
  /** The headers. */
  headers: Headers;
  /** A JSON or text body; `""` when there was none or it was a form. */
  text: string;
  /** A multipart body, when one was sent. */
  form: FormData | undefined;
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
      text: typeof body === "string" ? body : "",
      form: body instanceof FormData ? body : undefined,
      redirect: init?.redirect,
      signal: init?.signal,
    };
    sent.push(request);
    return await respond(request);
  };
  return Object.assign(fetcher, { sent });
}

/**
 * A fake `fetch` answering by `"METHOD url"`, each route a queue of answers
 * consumed in order (the last one repeats). An unknown route is a 599.
 */
export function routes(
  table: Record<string, Array<(request: SentRequest) => Response>>,
): typeof fetch & { sent: SentRequest[] } {
  const used = new Map<string, number>();
  return fakeFetch((request) => {
    const key = `${request.method} ${request.url.href}`;
    const queue = table[key];
    if (queue === undefined) {
      return new Response(`no route for ${key}`, { status: 599 });
    }
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    return queue[Math.min(index, queue.length - 1)](request);
  });
}

/** A status answer. */
export function status(
  value: string,
  extra: Record<string, unknown> = {},
): () => Response {
  return () =>
    Response.json({
      signingRequestId: REQUEST,
      status: value,
      workflowStatus: value,
      isFinalStatus: ["Completed", "Failed", "Denied", "Canceled"].includes(
        value,
      ),
      ...extra,
    });
}

/** Settings seams for a test: the fake, no real sleeping, a manual clock. */
export function seams<S extends SignPathConnectionSettings>(
  fetcher: typeof fetch,
  options: { sleeps?: number[]; lines?: string[]; env?: Map<string, string> } =
    {},
): (s: S) => S {
  let clock = 1_000_000;
  return (s) =>
    s.fetch(fetcher)
      .readEnv((name) => options.env?.get(name))
      .now(() => clock)
      .sleep((ms) => {
        options.sleeps?.push(ms);
        clock += ms;
        return Promise.resolve();
      })
      .log((line) => options.lines?.push(line));
}

/** {@link seams} plus the organization and the token. */
export function connected<S extends SignPathConnectionSettings>(
  fetcher: typeof fetch,
  options: { sleeps?: number[]; lines?: string[]; env?: Map<string, string> } =
    {},
): (s: S) => S {
  const base = seams<S>(fetcher, options);
  return (s) => base(s).organizationId(ORG).apiToken(TOKEN);
}
