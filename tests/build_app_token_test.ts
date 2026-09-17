// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one App-token mint (`build/app_token.ts`): the settings it builds from a
 * caller's scope, and the credential reader every minting target starts from.
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { GhAppTokenSettings } from "../packages/gh/mod.ts";
import { mintAppToken, resolveAppCredentials } from "../build/app_token.ts";

Deno.test("mintAppToken narrows the token to the repository and the permissions it is given", async () => {
  let settings: GhAppTokenSettings | undefined;
  const token = await mintAppToken(
    { appId: "12345", privateKey: "pem" },
    "zuke-build/zuke.build",
    { contents: "write", pull_requests: "write" },
    (configure) => {
      settings = configure(new GhAppTokenSettings());
      return Promise.resolve({
        token: "minted",
        expiresAt: "2026-01-01T00:00:00Z",
        installationId: 1,
      });
    },
  );
  assertEquals(token, "minted");
  assertEquals(settings?.appId_, "12345");
  assertEquals(settings?.privateKey_, "pem");
  assertEquals(settings?.owner_, "zuke-build");
  assertEquals(settings?.repositories_, ["zuke.build"]);
  assertEquals(settings?.permissions_, {
    contents: "write",
    pull_requests: "write",
  });
});

Deno.test("resolveAppCredentials needs both halves, and treats empty as absent", () => {
  assertEquals(
    resolveAppCredentials({ appId: "1", privateKey: "pem" }),
    { appId: "1", privateKey: "pem" },
  );
  assertEquals(resolveAppCredentials({ appId: "1" }), null);
  assertEquals(resolveAppCredentials({ privateKey: "pem" }), null);
  assertEquals(resolveAppCredentials({ appId: "", privateKey: "pem" }), null);
  assertEquals(resolveAppCredentials({ appId: "1", privateKey: "" }), null);
});
