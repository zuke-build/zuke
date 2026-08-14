// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Post a completed check run, creating it or updating the one already there.
 *
 * The GitHub API for check runs is create-only: `POST /check-runs` makes a new
 * one every time it is called, so a caller that retries — a step re-run, a
 * re-driven Zuke effect, a supervisor finishing work a dead process started —
 * ends up with several check runs of the same name on one commit. That is not
 * cosmetic when the name is a **required status context**: the newest one wins,
 * and which one is newest is decided by whichever caller happened to finish
 * last.
 *
 * So this operation looks first, and updates what it finds. That is what lets
 * everything upstream of it be honestly at-least-once: a retry, a re-drive, or
 * a supervisor finishing a dead process's work converges on one check run
 * rather than adding another.
 *
 * It converges; it does not serialise. The lookup and the write are two calls,
 * so two callers racing on a commit that has no check run yet can still each
 * create one, and nothing here orders two conclusions written at the same
 * moment. Callers that need one answer must agree on it before they get here —
 * which is exactly what computing it from a run's durable outcomes does.
 *
 * @module
 */

import {
  caller,
  DEFAULT_BASE_URL,
  GhApiError,
  type GhCall,
  isRecord,
  readNumber,
  readString,
} from "./api.ts";
import { resolveAuthToken, resolveRepoSlug } from "./credentials.ts";

/**
 * A check run's conclusion, as GitHub spells them.
 *
 * `"stale"` is deliberately absent: GitHub sets it itself and rejects it from a
 * caller.
 */
export type GhCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required";

/** The check run a {@link GhCheckRunApi.checkRun} call left on the commit. */
export interface GhCheckRunResult {
  /** Its numeric id. */
  id: number;
  /** Its web URL. */
  url: string;
  /**
   * Whether this call created it, as opposed to updating one already there.
   *
   * Worth reporting rather than hiding: a caller that expected to create and
   * updated instead has learned that something else posted first, which is the
   * difference between a first attempt and a re-drive.
   */
  created: boolean;
}

/**
 * Settings for posting a completed check run.
 *
 * `owner/repo` and the token fall back to the Actions environment, so a job
 * that already has them names only what it is reporting.
 */
export class GhCheckRunSettings {
  /** The check run's name — half of its identity. Set by {@link name}. */
  name_?: string;
  /** The commit it reports on. Set by {@link headSha}. */
  headSha_?: string;
  /** The conclusion to report. Set by {@link conclusion}. */
  conclusion_?: GhCheckConclusion;
  /** The output panel's title. Set by {@link title}. */
  title_?: string;
  /** The output panel's markdown body. Set by {@link summary}. */
  summary_?: string;
  /** The caller's own correlation id. Set by {@link externalId}. */
  externalId_?: string;
  /** Where the check run's "Details" link points. Set by {@link detailsUrl}. */
  detailsUrl_?: string;
  /** `owner/repo`. Set by {@link repo}. */
  repo_?: string;
  /** The token. Set by {@link token}. */
  token_?: string;
  /** The API root. Set by {@link baseUrl}. */
  baseUrl_: string = DEFAULT_BASE_URL;
  /** The `fetch` implementation. Set by {@link fetch}. */
  fetch_: typeof fetch = fetch;

  /**
   * The check run's name — what appears in the PR's checks list, and what a
   * branch protection rule names as a required status context.
   */
  name(value: string): this {
    this.name_ = value;
    return this;
  }

  /**
   * The full SHA of the commit being reported on.
   *
   * Pin this at the start of the work, not when the result is posted. A caller
   * that resolves the head of a pull request at post time reports on whatever
   * has been pushed since — which, for a required context, is a green check on
   * a commit nothing ever tested.
   */
  headSha(sha: string): this {
    this.headSha_ = sha;
    return this;
  }

  /** The conclusion to report. */
  conclusion(value: GhCheckConclusion): this {
    this.conclusion_ = value;
    return this;
  }

  /** The output panel's title. Defaults to the check run's name. */
  title(text: string): this {
    this.title_ = text;
    return this;
  }

  /** The output panel's body, as markdown. */
  summary(markdown: string): this {
    this.summary_ = markdown;
    return this;
  }

  /**
   * A correlation id of the caller's own, stored on the check run.
   *
   * Also what this operation matches on when deciding whether a check run is
   * "the same one": with an external id set, two callers writing the same name
   * on the same commit for different reasons stay distinct, and a re-drive of
   * one of them updates its own check run rather than the other's.
   */
  externalId(id: string): this {
    this.externalId_ = id;
    return this;
  }

  /** Where the check run's "Details" link points. */
  detailsUrl(url: string): this {
    this.detailsUrl_ = url;
    return this;
  }

  /** `owner/repo`. Defaults to `GITHUB_REPOSITORY`. */
  repo(slug: string): this {
    this.repo_ = slug;
    return this;
  }

  /** The token to authenticate with. Defaults to `GITHUB_TOKEN`. */
  token(value: string): this {
    this.token_ = value;
    return this;
  }

  /** The API root, for GitHub Enterprise. */
  baseUrl(url: string): this {
    this.baseUrl_ = url.replace(/\/+$/, "");
    return this;
  }

  /** Override the `fetch` implementation (a test seam). */
  fetch(fn: typeof fetch): this {
    this.fetch_ = fn;
    return this;
  }

  /** The effective `owner/repo`, from the setting or the environment. */
  repoSlug_(): string {
    return resolveRepoSlug(this.repo_, "posting a check run");
  }

  /** The effective token, from the setting or the environment. */
  authToken_(): string {
    return resolveAuthToken(
      this.token_,
      "posting a check run",
      ". It needs the `checks: write` permission and nothing else.",
    );
  }
}

/** The check-run operation {@link GhTasks} exposes. */
export interface GhCheckRunApi {
  /**
   * Post a completed check run for `.headSha(...)` named `.name(...)`, updating
   * the one already on that commit if there is one.
   *
   * The lookup and the write are two calls, so this is an upsert by
   * convergence, not an atomic one: two callers racing on a commit that has no
   * check run yet can both find nothing and both create one. What it removes is
   * the *serial* duplicate — the retry, the re-drive, the supervisor finishing
   * a dead process's work — which is the case that actually happens.
   */
  checkRun(
    configure?: (settings: GhCheckRunSettings) => GhCheckRunSettings,
  ): Promise<GhCheckRunResult>;
}

/**
 * Reject a head SHA that is not one.
 *
 * It is interpolated into the lookup path, so the same reasoning as the ref
 * names in `api.ts` applies — but the more common failure this catches is a
 * caller passing a branch name or an abbreviated SHA. GitHub rejects both when
 * creating a check run, with a 422 that does not say which field was wrong.
 */
function assertHeadSha(sha: string): void {
  if (!/^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(sha)) {
    throw new Error(
      `refusing to use ${JSON.stringify(sha)} as a head SHA: expected a full ` +
        `40- or 64-character commit SHA. An abbreviated SHA or a branch name ` +
        `is rejected when the check run is created.`,
    );
  }
}

/** Perform the configured check run. */
export async function postCheckRun(
  configure?: (settings: GhCheckRunSettings) => GhCheckRunSettings,
): Promise<GhCheckRunResult> {
  const settings = configure?.(new GhCheckRunSettings()) ??
    new GhCheckRunSettings();
  const name = settings.name_;
  const headSha = settings.headSha_;
  const conclusion = settings.conclusion_;
  if (name === undefined) {
    throw new Error("posting a check run requires .name(...).");
  }
  if (headSha === undefined) {
    throw new Error("posting a check run requires .headSha(...).");
  }
  if (conclusion === undefined) {
    // Only completed check runs, on purpose: a caller that posts a pending one
    // and then dies leaves a check that never settles, which for a required
    // context is a pull request that can never merge. There is no way to write
    // that here by accident.
    throw new Error(
      "posting a check run requires .conclusion(...) — this posts a completed " +
        "check run in one call.",
    );
  }
  assertHeadSha(headSha);

  const repo = settings.repoSlug_();
  const call = caller(
    settings.baseUrl_,
    repo,
    settings.authToken_(),
    settings.fetch_,
  );

  const body: Record<string, unknown> = { name, conclusion };
  if (settings.externalId_ !== undefined) {
    body.external_id = settings.externalId_;
  }
  if (settings.detailsUrl_ !== undefined) {
    body.details_url = settings.detailsUrl_;
  }
  if (settings.title_ !== undefined || settings.summary_ !== undefined) {
    // GitHub rejects an output panel that has one of these without the other,
    // so naming either fills in the other rather than 422-ing on the caller's
    // behalf.
    body.output = {
      title: settings.title_ ?? name,
      summary: settings.summary_ ?? "",
    };
  }

  const existing = await findCheckRun(
    call,
    headSha,
    name,
    settings.externalId_,
  );
  if (existing !== undefined) {
    // The output panel is rewritten on every update, even when this call named
    // neither half of it. A partial update would leave the previous attempt's
    // text under this attempt's conclusion — "12 of 12 checks passed" above a
    // failure — which is worse than an empty panel.
    const update = {
      ...body,
      output: {
        title: settings.title_ ?? name,
        summary: settings.summary_ ?? "",
      },
    };
    const updated = await update_(call, existing, update);
    if (updated !== undefined) {
      return {
        id: readNumber(updated, "id", "check run"),
        url: readString(updated, ["html_url"], "check run"),
        created: false,
      };
    }
    // The check run is not ours to update — fall through and post our own.
  }
  // `head_sha` is create-only — an update cannot move a check run to another
  // commit, so it is sent here and nowhere else.
  const created = await call("POST", "/check-runs", {
    ...body,
    head_sha: headSha,
  });
  return {
    id: readNumber(created, "id", "check run"),
    url: readString(created, ["html_url"], "check run"),
    created: true,
  };
}

/**
 * Update `id`, or report that it cannot be updated by this caller.
 *
 * A check run may only be updated by the GitHub App that created it; anyone
 * else is refused. That is not an edge case here — the name this posts under is
 * a required status context, and during a migration the same name is often
 * still being produced by the workflow being replaced, owned by a different
 * app. Left to propagate, the refusal would repeat identically on every
 * re-drive and the context would never be posted at all, which for a required
 * check means a pull request nobody can merge.
 *
 * So a refusal means "not ours", and posting our own is the answer. A token
 * that genuinely lacks `checks: write` is not masked: the create that follows
 * is refused too, and that error is the one the caller sees.
 */
async function update_(
  call: GhCall,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown | undefined> {
  try {
    return await call("PATCH", `/check-runs/${id}`, body);
  } catch (error) {
    if (
      error instanceof GhApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Find the check run this call would be updating, if the commit has one.
 *
 * Newest wins, by id. GitHub does not document an order for this listing, and
 * "the one a previous attempt left" is by definition the most recently created
 * of the candidates — picking any other would update a stale check run and
 * leave the visible one saying whatever it said before.
 *
 * With an `externalId`, only a check run carrying that id is a candidate: the
 * name alone is not identity when two different callers report under one
 * required context. Without one, the name is all there is.
 */
async function findCheckRun(
  call: GhCall,
  headSha: string,
  name: string,
  externalId: string | undefined,
): Promise<number | undefined> {
  const query = new URLSearchParams({
    check_name: name,
    // `filter` defaults to `latest`, which returns at most **one** check run per
    // name — so on a commit that already carries two, the one this call is
    // looking for may not be in the response at all, and it would create a
    // third. Everything below (matching on external id, taking the newest of
    // several) only means anything with the full list.
    filter: "all",
    per_page: "100",
  });
  let page = 1;
  let seen = 0;
  let best: number | undefined;
  // Paginated rather than trusting the first page: the filter makes more than
  // one page pathological, but a missed candidate is a duplicate check run,
  // which is the failure this whole function exists to prevent.
  while (true) {
    query.set("page", String(page));
    const response = await call(
      "GET",
      `/commits/${headSha}/check-runs?${query}`,
    );
    if (!isRecord(response)) return best;
    const runs = response.check_runs;
    if (!Array.isArray(runs) || runs.length === 0) return best;
    for (const run of runs) {
      if (!isRecord(run)) continue;
      if (run.name !== name) continue;
      // Symmetric on purpose. Matching only when *this* call sets an id would
      // let an id-less caller adopt a check run that belongs to one that does,
      // which is the isolation the setting is documented to provide.
      if (String(run.external_id ?? "") !== (externalId ?? "")) continue;
      const id = run.id;
      if (typeof id !== "number") continue;
      if (best === undefined || id > best) best = id;
    }
    seen += runs.length;
    const total = response.total_count;
    if (typeof total !== "number" || seen >= total) return best;
    page += 1;
  }
}
