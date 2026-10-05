// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What an analysis's HTTP request needs around it: the signal it runs under,
 * and a way to report a failure without leaking the credentials a URL can
 * carry.
 *
 * @module
 */

/** A URL anywhere in a message, up to the next whitespace. */
const URL_IN_TEXT = /https?:\/\/\S+/g;

/**
 * A signal that aborts after `timeoutMs`, or when `outer` does — so an
 * in-flight check is cut short when the bake ends or the run is cancelled.
 */
export function requestSignal(
  timeoutMs: number,
  outer: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer === undefined ? timeout : AbortSignal.any([timeout, outer]);
}

/**
 * `text` with every URL in it stripped of its userinfo (`user:password@`) and
 * its query string (`?token=…`) — where credentials live, and the run's
 * redactor masks only declared secret parameters, so a hard-coded or
 * environment-read token would otherwise reach the log, the run record and
 * any pull-request comment.
 *
 * Run it **after** the redactor: it edits the URL's text in place rather than
 * re-serialising it, so it never changes the spelling of a secret the
 * redactor still has to recognise.
 */
export function withoutCredentials(text: string): string {
  return text.replaceAll(
    URL_IN_TEXT,
    (url) => url.replace(/^(https?:\/\/)[^/\s]*@/, "$1").replace(/\?.*$/, ""),
  );
}
