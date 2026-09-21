// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The banner a run opens with: the Zuke wordmark, the framework and runtime
 * versions, the platform, and this run's identity.
 *
 * It answers the questions a log cannot otherwise answer — did Zuke start,
 * which version executed, on what, and which stored run record does this log
 * belong to. That last pair is why the identifying lines print on CI even
 * though the art does not: a runner's log is exactly where "which version, on
 * which platform" is worth having, and exactly where six lines of ASCII are
 * not.
 *
 * Everything here is pure. The facts are injected rather than read, so the
 * builder can be unit-tested without an environment and the reads stay in the
 * one place that already owns them.
 *
 * @module
 */

import type { CiHost } from "./host.ts";
import { logoLines } from "./logo.ts";
import { stylize } from "./render.ts";

/** What a run reports about itself, gathered by the caller. */
export interface BannerFacts {
  /** The `@zuke/core` version executing this build. */
  version: string;
  /** The Deno runtime version, e.g. `2.8.3`. */
  deno: string;
  /** The platform as `<os>-<arch>`, e.g. `darwin-aarch64`. */
  platform: string;
  /** The detected CI host, or `"local"` off CI. */
  host: CiHost;
  /** This run's id — the one `zuke runs show <id>` takes. */
  runId: string;
  /** The directory the run started in. */
  cwd: string;
}

/** How {@link bannerLines} renders. */
export interface BannerOptions {
  /** Emit ANSI colour codes. */
  color: boolean;
}

/** The separator between fields, matching the run's closing line. */
const SEPARATOR = " · ";

/**
 * The banner as printable lines: the wordmark off CI, then
 * `zuke <version> · deno <version> · <platform>` — with the CI host appended
 * when there is one — then `run <id> · <cwd>`.
 *
 * The wordmark is decided here, from `facts.host`, rather than by the caller:
 * "art off CI, identity everywhere" is the rule this module exists to state,
 * and a flag for it would be a second place to get it wrong. Suppressing the
 * banner entirely is the caller's business, and a different question.
 *
 * The run id is printed in full rather than abbreviated: its reason for being
 * here is that it can be pasted into `zuke runs show`, and a truncated id
 * cannot.
 */
export function bannerLines(
  facts: BannerFacts,
  options: BannerOptions,
): string[] {
  const { color } = options;
  const lines = facts.host === "local" ? logoLines(color) : [];

  const fields = [
    `${stylize(color, ["cyan", "bold"], "zuke")} ${facts.version}`,
    `deno ${facts.deno}`,
    facts.platform,
  ];
  // "local" is the absence of a CI host, not a host worth naming: on a laptop
  // the word is noise, and the line is already saying where it runs.
  if (facts.host !== "local") fields.push(facts.host);
  lines.push(fields.join(SEPARATOR));

  lines.push(
    stylize(
      color,
      ["dim"],
      `run ${facts.runId}${SEPARATOR}${facts.cwd}`,
    ),
  );
  return lines;
}
