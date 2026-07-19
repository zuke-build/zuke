import { assertEquals } from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import type { Configure } from "@zuke/core/tooling";
import { gcloudAccessToken, resolveAccessToken } from "../src/auth.ts";
import { GcloudSettings } from "../src/gcloud.ts";

Deno.test("gcloudAccessToken returns the trimmed print-access-token stdout", async () => {
  let argv: string[] = [];
  const run = (configure?: Configure<GcloudSettings>) => {
    argv = (configure ? configure(new GcloudSettings()) : new GcloudSettings())
      .argv();
    return Promise.resolve(new CommandOutput(0, "ya29.a-token\n", ""));
  };
  assertEquals(await gcloudAccessToken(run), "ya29.a-token");
  // Runs `gcloud auth print-access-token` (quiet keeps the token out of logs).
  assertEquals(argv, ["gcloud", "auth", "print-access-token"]);
});

Deno.test("resolveAccessToken prefers an explicit token, else the provider", async () => {
  assertEquals(await resolveAccessToken({ token: "explicit" }), "explicit");
  assertEquals(
    await resolveAccessToken({
      tokenProvider: () => Promise.resolve("from-provider"),
    }),
    "from-provider",
  );
});
