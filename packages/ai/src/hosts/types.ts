/**
 * The {@link ReviewHost} contract — what each per-host integration provides so
 * the {@link "../reviewer.ts".Reviewer} can post its assessment to a pull
 * (or merge) request without knowing which provider it's running on.
 *
 * @module
 */

/** Read an environment variable, tolerating an absent `--allow-env` permission. */
export type EnvReader = (name: string) => string | undefined;

/** The default env reader — `Deno.env.get` wrapped to return `undefined` on denial. */
export function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/**
 * Upsert one PR/MR comment keyed by the hidden marker derived from `name`.
 * Closes over its host-specific context — the reviewer never sees that shape.
 */
export type UpsertComment = (
  name: string,
  markdown: string,
  doFetch: typeof fetch,
) => Promise<void>;

/**
 * A pull-request commenting integration for one CI host. Each implementation
 * (`hosts/github.ts`, `hosts/gitlab.ts`, …) resolves its context from the
 * ambient environment and returns a closure that posts (and updates) one
 * comment per reviewer.
 */
export interface ReviewHost {
  /** A short label for the host, used in skip/diagnostic messages. */
  readonly label: string;
  /** Env var the reviewer reads when `.commentToken(...)` isn't set. */
  readonly defaultTokenEnv: string;
  /**
   * Resolve the host context from the environment and return a closure that
   * upserts one comment. Returns `undefined` when the environment is missing
   * a required signal (e.g. no PR id) — commenting then skips silently.
   */
  prepare(token: string, env: EnvReader): UpsertComment | undefined;
}

/** The Markdown header that every PR comment opens with, identifying Zuke. */
export const HEADER = "🤖 **[Zuke](https://zuke.build) AI review**";

/** Render the hidden marker (an HTML comment) used to identify a reviewer's prior comment. */
export function commentMarker(name: string): string {
  return `<!-- zuke-ai-review:${name} -->`;
}

/** Compose the final comment body: marker + header + assessment markdown. */
export function commentBody(name: string, markdown: string): string {
  return `${commentMarker(name)}\n${HEADER}\n\n${markdown}`;
}
