// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * gh hands out `--json` and `--web` unevenly, and a wrapper that offers either
 * where gh does not renders a flag gh rejects as unknown. `gh release list`
 * already cost one round of that. This pins the whole matrix, so adding a
 * command to the wrong base fails here rather than at a user's terminal.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  GhCacheListSettings,
  GhIssueListSettings,
  GhIssueViewSettings,
  GhLabelListSettings,
  GhPrChecksSettings,
  GhPrListSettings,
  GhPrViewSettings,
  GhReleaseListSettings,
  GhReleaseViewSettings,
  GhRepoListSettings,
  GhRepoViewSettings,
  GhRunListSettings,
  GhRunViewSettings,
  GhSecretListSettings,
  GhVariableGetSettings,
  GhVariableListSettings,
  GhWorkflowListSettings,
  GhWorkflowViewSettings,
} from "../mod.ts";

/** Each reading command, with what gh's manual gives it. */
const MATRIX: Array<[string, { json: boolean; web: boolean }, object]> = [
  ["pr list", { json: true, web: true }, new GhPrListSettings()],
  ["pr view", { json: true, web: true }, new GhPrViewSettings()],
  ["pr checks", { json: true, web: true }, new GhPrChecksSettings()],
  ["issue list", { json: true, web: true }, new GhIssueListSettings()],
  ["issue view", { json: true, web: true }, new GhIssueViewSettings()],
  // gh gives `release list` no browser view, alone among the listings.
  ["release list", { json: true, web: false }, new GhReleaseListSettings()],
  ["release view", { json: true, web: true }, new GhReleaseViewSettings()],
  ["run list", { json: true, web: false }, new GhRunListSettings()],
  ["run view", { json: true, web: true }, new GhRunViewSettings()],
  ["workflow list", { json: true, web: false }, new GhWorkflowListSettings()],
  // gh gives `workflow view` --web and --yaml but no --json.
  ["workflow view", { json: false, web: true }, new GhWorkflowViewSettings()],
  ["secret list", { json: true, web: false }, new GhSecretListSettings()],
  ["variable list", { json: true, web: false }, new GhVariableListSettings()],
  ["variable get", { json: true, web: false }, new GhVariableGetSettings()],
  ["cache list", { json: true, web: false }, new GhCacheListSettings()],
  ["label list", { json: true, web: true }, new GhLabelListSettings()],
  ["repo list", { json: true, web: false }, new GhRepoListSettings()],
  ["repo view", { json: true, web: true }, new GhRepoViewSettings()],
];

Deno.test("each reading command offers exactly the read flags gh gives it", () => {
  const actual = MATRIX.map((
    [name, _expected, settings],
  ) => [name, { json: "json" in settings, web: "web" in settings }]);
  const expected = MATRIX.map(([name, flags]) => [name, flags]);
  assertEquals(actual, expected);
});
