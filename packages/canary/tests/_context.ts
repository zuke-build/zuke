// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/** A {@link CanaryAnalysisContext} for analysis unit tests. */

import type { CanaryAnalysisContext } from "../mod.ts";

/** A context whose redactor masks `s3cr3t`, optionally with a signal. */
export function analysisContext(signal?: AbortSignal): CanaryAnalysisContext {
  return {
    target: "rollout.step1.analyze",
    redact: (text) => text.replaceAll("s3cr3t", "[redacted]"),
    step: 1,
    requested: 10,
    exposure: 10,
    ...(signal === undefined ? {} : { signal }),
  };
}

/** A `fetch` that answers every request with `respond`, recording the URLs. */
export function fakeFetch(
  respond: (url: string, call: number) => Response | Promise<Response>,
): typeof fetch & { urls: string[]; headers: Headers[] } {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    headers.push(new Headers(init?.headers));
    return Promise.resolve(respond(url, urls.length));
  };
  return Object.assign(fetcher, { urls, headers });
}
