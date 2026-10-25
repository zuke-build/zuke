// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration coverage for `@zuke/google`: a real build, driven through the
 * CLI `main()` entry point, that uploads an app bundle to a Play track against
 * a fake Google — and fails the run, with the edit deleted and the
 * service-account key kept out of the output, when Google refuses a step.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { GooglePlayTasks } from "../../packages/google/mod.ts";
import {
  fakeGoogle,
  type PlayCall,
  serviceAccountKey,
} from "../../packages/google/tests/_play.ts";
import { runCli, withoutMaskDirectives } from "./_harness.ts";

const KEY = await serviceAccountKey();

/** A fake Google that accepts everything but, when `refuse` is set, the commit. */
function google(refuse: boolean): { fetch: typeof fetch; calls: PlayCall[] } {
  return fakeGoogle(({ method, url }) => {
    if (url.endsWith("/token")) return { body: { access_token: "tok" } };
    if (url.endsWith("/edits")) return { body: { id: "e1" } };
    if (url.includes("/bundles?")) return { body: { versionCode: 9 } };
    if (url.includes(":commit") && refuse) {
      return {
        status: 400,
        body: { error: { message: "App not yet set up." } },
      };
    }
    return method === "PUT" || method === "POST" || method === "DELETE"
      ? { body: {} }
      : undefined;
  });
}

/** A mobile app's build: a bundle on disk, uploaded to the internal track. */
function appBuild(bundle: string, fake: { fetch: typeof fetch }) {
  return class App extends Build {
    key = parameter("Service-account key").secret().default(KEY.json);
    googlePlay = target().executes(async () => {
      const result = await GooglePlayTasks.upload((s) =>
        s.serviceAccount(this.key.value).packageName("com.example.app")
          .bundle(bundle).fetch(fake.fetch).releaseNotes("Fixes.")
      );
      console.log(`released ${result.versionCode} to ${result.track}`);
    });
  };
}

Deno.test("a build uploads a bundle to the internal track through the CLI", async () => {
  const bundle = await Deno.makeTempFile({ suffix: ".aab" });
  await Deno.writeFile(bundle, new Uint8Array([1, 2, 3]));
  const fake = google(false);
  const { code, out } = await runCli(appBuild(bundle, fake), ["googlePlay"]);
  assertEquals(code, 0, out);
  assertStringIncludes(
    out,
    `Google Play: uploaded ${bundle} as version code 9`,
  );
  assertStringIncludes(out, "released 9 to internal");
  assertEquals(fake.calls.map((c) => c.method), [
    "POST",
    "POST",
    "POST",
    "PUT",
    "POST",
  ]);
  assertEquals(fake.calls[2].body, 3);
});

Deno.test("a refused commit fails the run with Google's message, deletes the edit and never prints the key", async () => {
  const bundle = await Deno.makeTempFile({ suffix: ".aab" });
  const fake = google(true);
  const { code, out, err } = await runCli(appBuild(bundle, fake), [
    "googlePlay",
  ]);
  assertEquals(code, 1);
  assertStringIncludes(
    out + err,
    ":commit failed (HTTP 400): App not yet set up.",
  );
  assertEquals(fake.calls[fake.calls.length - 1].method, "DELETE");
  // Under GitHub Actions the run emits `::add-mask::` with the raw key once,
  // so the runner censors it; that sanctioned line is stripped first.
  assertEquals(
    withoutMaskDirectives(out + err).includes(KEY.pem.split("\n")[1]),
    false,
  );
});
