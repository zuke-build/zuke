// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../../core/tests/_assert.ts";
import { promptStar, realStarActions, ZUKE_REPO_URL } from "../src/star.ts";
import { FakeHost, FakePrompter, FakeStarActions } from "./_fakes.ts";
import { CommandOutput } from "@zuke/core/shell";
import { GhApiSettings } from "@zuke/gh";

Deno.test("promptStar respects a no, silently", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(true);
  await promptStar(host, new FakePrompter(true, "", true, false), actions);
  assertEquals(host.logs, []);
  assertEquals(actions.calls, []);
});

Deno.test("promptStar stars through an authenticated gh", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(true);
  await promptStar(host, new FakePrompter(true, "", false, true), actions);
  assertEquals(actions.calls, ["auth", "star"]);
  assertEquals(host.logs, ["★ Starred zuke-build/zuke — thank you!"]);
});

Deno.test("promptStar opens the browser when gh is not authenticated", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(false);
  await promptStar(host, new FakePrompter(true, "", false, true), actions);
  assertEquals(actions.calls, ["auth", `open:${ZUKE_REPO_URL}`]);
  assertEquals(host.logs.length, 1);
  assertEquals(host.logs[0].includes(ZUKE_REPO_URL), true);
});

Deno.test("promptStar falls back to the browser when gh api fails", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(true, false);
  await promptStar(host, new FakePrompter(true, "", false, true), actions);
  assertEquals(actions.calls, ["auth", "star", `open:${ZUKE_REPO_URL}`]);
  assertEquals(host.logs[0].includes("Opened"), true);
});

Deno.test("promptStar prints the URL when the browser cannot launch", async () => {
  const host = new FakeHost();
  const actions = new FakeStarActions(false, true, false);
  await promptStar(host, new FakePrompter(true, "", false, true), actions);
  assertEquals(host.logs, [`Star Zuke at ${ZUKE_REPO_URL} — thank you!`]);
});

/** A `CommandOutput` carrying just an exit code. */
function exit(code: number): CommandOutput {
  return new CommandOutput(code, "", "");
}

Deno.test("realStarActions.ghAuthenticated maps exit codes and throws", async () => {
  const ok = realStarActions(() => Promise.resolve(exit(0)));
  assertEquals(await ok.ghAuthenticated(), true);
  const loggedOut = realStarActions(() => Promise.resolve(exit(1)));
  assertEquals(await loggedOut.ghAuthenticated(), false);
  const missing = realStarActions(() => Promise.reject(new Error("no gh")));
  assertEquals(await missing.ghAuthenticated(), false);
});

Deno.test("realStarActions.starWithGh PUTs the star endpoint", async () => {
  let seen: string[] = [];
  const actions = realStarActions(undefined, (endpoint, configure) => {
    // Recover the argv the settings lambda would produce, without running gh.
    const settings = configure
      ? configure(new GhApiSettings(endpoint))
      : new GhApiSettings(endpoint);
    seen = settings.argv();
    return Promise.resolve(exit(0));
  });
  await actions.starWithGh();
  assertEquals(seen.slice(0, 3), ["gh", "api", "user/starred/zuke-build/zuke"]);
  assertEquals(seen.includes("--method"), true);
  assertEquals(seen.includes("PUT"), true);
});

Deno.test("realStarActions.openBrowser maps launch outcomes", async () => {
  let opened = "";
  const ok = realStarActions(undefined, undefined, (url) => {
    opened = url;
    return Promise.resolve(exit(0));
  });
  assertEquals(await ok.openBrowser(ZUKE_REPO_URL), true);
  assertEquals(opened, ZUKE_REPO_URL);
  const failed = realStarActions(
    undefined,
    undefined,
    () => Promise.resolve(exit(3)),
  );
  assertEquals(await failed.openBrowser(ZUKE_REPO_URL), false);
  const missing = realStarActions(
    undefined,
    undefined,
    () => Promise.reject(new Error("no opener")),
  );
  assertEquals(await missing.openBrowser(ZUKE_REPO_URL), false);
});
