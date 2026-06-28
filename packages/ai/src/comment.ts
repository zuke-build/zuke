/**
 * Posting a single overview comment to the pull/merge request via the active CI
 * host — shared by the AI fixer and the agent fixer. Keyed by the fixer's name
 * so re-runs update one comment in place; best-effort, so a failure to post
 * never breaks the build.
 *
 * @module
 */

import type { AnyParameter } from "@zuke/core";
import { detectReviewHost, type EnvReader } from "./hosts.ts";
import { resolveKey } from "./provider.ts";

/** How to post a comment: the token source, the env reader, and a `fetch` seam. */
export interface CommentOptions {
  /** The token to post with; defaults to the host's conventional env var. */
  commentToken?: AnyParameter | string;
  /** The environment reader used to detect the host and read the token. */
  env: EnvReader;
  /** The `fetch` implementation (test seam). */
  fetch?: typeof fetch;
}

/**
 * Upsert a single comment, identified by `name`, on the current PR/MR. A no-op
 * when no CI host or PR context is detected (e.g. local runs).
 */
export async function postComment(
  name: string,
  markdown: string,
  options: CommentOptions,
): Promise<void> {
  const host = detectReviewHost(options.env);
  if (host === undefined) return;
  const token = options.commentToken !== undefined
    ? resolveKey(options.commentToken)
    : options.env(host.defaultTokenEnv) ?? "";
  const upsert = host.prepare(token, options.env);
  if (upsert === undefined) return;
  try {
    await upsert(name, markdown, options.fetch ?? fetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${name}] could not post PR comment: ${message}`);
  }
}
