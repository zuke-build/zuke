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
import { logoLines, ZUKE_LOGO } from "./logo.ts";
import { stylize } from "./render.ts";

/** What a run reports about itself, gathered by the caller. */
export interface BannerFacts {
  /** The `@zuke/core` version executing this build. */
  version: string;
  /** The Deno runtime version, e.g. `2.8.3`. */
  deno: string;
  /** The platform as `<os>-<arch>`, e.g. `darwin-aarch64`. */
  platform: string;
  /**
   * Whether this is CI at all — including the systems {@link CiHost} has no
   * name for.
   *
   * Separate from {@link BannerFacts.host} on purpose. "Is this a runner log?"
   * and "which runner?" are different questions, and only the first decides
   * the art: a `CiHost` of `"local"` covers Jenkins, CircleBuild, Buildkite,
   * Travis, TeamCity and a bare `CI=true`, so deriving the art from the host
   * would put six lines of ASCII in exactly the logs this feature exists to
   * keep clean.
   */
  ci: boolean;
  /** The named CI host, or `"local"` when it is not one Zuke names. */
  host: CiHost;
  /** This run's id. */
  runId: string;
  /** The directory the run started in. */
  cwd: string;
  /** Terminal width, so the art is dropped where it would wrap into noise. */
  width: number;
}

/** The separator between fields, matching the run's closing line. */
const SEPARATOR = " · ";

/** The art's printable width; below it the wordmark wraps into garbage. */
const ART_WIDTH = Math.max(...ZUKE_LOGO.split("\n").map((l) => l.length));

/**
 * The banner as printable lines: the wordmark off CI, then
 * `zuke <version> · deno <version> · <platform>` — with the CI host appended
 * when there is one — then `run <id> · <cwd>`.
 *
 * The wordmark is decided here rather than by the caller: "art off CI,
 * identity everywhere" is the rule this module exists to state, and a flag for
 * it would be a second place to get it wrong.
 *
 * The run id is printed in full rather than abbreviated because a truncated
 * one is not usable for the thing it is for. With durable state (`--state`, or
 * a configured store) it is the id `zuke runs show` takes; without one no
 * record is written and it serves only to tie this log to a plugin's or a
 * summary's report of the same run, which is still worth the line.
 */
export function bannerLines(facts: BannerFacts, color: boolean): string[] {
  // Two reasons to skip the art, and they are different: on CI it is noise in
  // somebody's log, and in a narrow terminal it is not the wordmark at all —
  // it wraps, and six lines of broken block characters say nothing.
  const art = !facts.ci && facts.width >= ART_WIDTH;
  const lines = art ? logoLines(color) : [];

  const fields = [
    `${stylize(color, ["cyan", "bold"], "zuke")} ${facts.version}`,
    `deno ${facts.deno}`,
    facts.platform,
  ];
  // Name the host when Zuke knows it, and otherwise say plainly that this is
  // CI — which is also what explains the missing art to whoever is reading.
  if (facts.host !== "local") fields.push(facts.host);
  else if (facts.ci) fields.push("ci");
  lines.push(fields.join(SEPARATOR));

  lines.push(
    stylize(color, ["dim"], `run ${facts.runId}${SEPARATOR}${facts.cwd}`),
  );
  return lines;
}
