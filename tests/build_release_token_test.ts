// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The release token (`build/release_token.ts`): minted from the app, never
 * `GITHUB_TOKEN`, so a release tag may differ from master in workflow files.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { GhAppTokenSettings } from "../packages/gh/mod.ts";
import type { AppTokenMint } from "../build/app_token.ts";
import { mintReleaseToken } from "../build/release_token.ts";

function recordingMint(): {
  mint: AppTokenMint;
  calls: GhAppTokenSettings[];
} {
  const calls: GhAppTokenSettings[] = [];
  const mint: AppTokenMint = (configure) => {
    calls.push(configure(new GhAppTokenSettings()));
    return Promise.resolve({
      token: "minted",
      expiresAt: "2026-01-01T00:00:00Z",
      installationId: 1,
    });
  };
  return { mint, calls };
}

Deno.test("mintReleaseToken holds workflows: write, scoped to this repository", async () => {
  const { mint, calls } = recordingMint();
  const token = await mintReleaseToken(
    { appId: "1", privateKey: "pem", repo: "zuke-build/zuke" },
    mint,
  );
  assertEquals(token, "minted");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].owner_, "zuke-build");
  assertEquals(calls[0].repositories_, ["zuke"]);
  assertEquals(calls[0].permissions_, {
    contents: "write",
    pull_requests: "write",
    workflows: "write",
  });
});

Deno.test("mintReleaseToken fails without the app credentials instead of falling back", async () => {
  const { mint, calls } = recordingMint();
  const error = await assertRejects(() =>
    mintReleaseToken({ appId: "1", repo: "zuke-build/zuke" }, mint)
  );
  assertStringIncludes(error.message, "ZUKE_BUILD_APP_KEY");
  assertStringIncludes(error.message, "workflows");
  assertEquals(calls.length, 0);
});

Deno.test("mintReleaseToken refuses to mint for another repository", async () => {
  const { mint, calls } = recordingMint();
  const error = await assertRejects(() =>
    mintReleaseToken(
      { appId: "1", privateKey: "pem", repo: "someone/fork" },
      mint,
    )
  );
  assertStringIncludes(error.message, "someone/fork");
  assertEquals(calls.length, 0);
});
