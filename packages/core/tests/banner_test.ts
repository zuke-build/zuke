// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the opening banner's line builder. It is pure — the facts are
 * injected — so every shape it can take is exercised here without an
 * environment, and the executor's tests only have to prove the wiring.
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { type BannerFacts, bannerLines } from "../src/banner.ts";
import { ZUKE_LOGO } from "../src/logo.ts";

/** A complete set of facts; each test overrides only what it is about. */
function facts(overrides: Partial<BannerFacts> = {}): BannerFacts {
  return {
    version: "1.56.0",
    deno: "2.8.3",
    platform: "darwin-aarch64",
    host: "local",
    runId: "7cbd70fd-3ebc-410f-b479-1978469f6928",
    cwd: "/Users/me/work/zuke-demo",
    ...overrides,
  };
}

const ART_LINES = ZUKE_LOGO.split("\n").length;

Deno.test("banner: off CI it opens with the wordmark", () => {
  const lines = bannerLines(facts(), { color: false });
  assertEquals(lines.length, ART_LINES + 2);
  assertEquals(lines.slice(0, ART_LINES), ZUKE_LOGO.split("\n"));
});

Deno.test("banner: on CI the art is dropped and the host named", () => {
  // The identity is worth more in a runner log than anywhere else; the six
  // lines of ASCII are worth less.
  const lines = bannerLines(facts({ host: "github" }), { color: false });
  assertEquals(lines.length, 2);
  assertEquals(lines[0], "zuke 1.56.0 · deno 2.8.3 · darwin-aarch64 · github");
});

Deno.test("banner: every non-local host is named", () => {
  for (const host of ["github", "gitlab", "azure", "bitbucket"] as const) {
    const [first] = bannerLines(facts({ host }), { color: false });
    assertStringIncludes(first, ` · ${host}`);
  }
});

Deno.test("banner: local is never printed as a host", () => {
  // "local" is the absence of a CI host, not one worth naming.
  const lines = bannerLines(facts(), { color: false });
  assertEquals(lines[ART_LINES], "zuke 1.56.0 · deno 2.8.3 · darwin-aarch64");
  assertEquals(lines.some((l) => l.includes("local")), false);
});

Deno.test("banner: the run id is printed whole, for `zuke runs show`", () => {
  const id = "7cbd70fd-3ebc-410f-b479-1978469f6928";
  const lines = bannerLines(facts({ host: "github" }), { color: false });
  assertEquals(lines[1], `run ${id} · /Users/me/work/zuke-demo`);
});

Deno.test("banner: without colour no escape codes are emitted", () => {
  for (const host of ["local", "github"] as const) {
    for (const line of bannerLines(facts({ host }), { color: false })) {
      assertEquals(line.includes("\x1b["), false, line);
    }
  }
});

Deno.test("banner: with colour the text survives intact under the codes", () => {
  const plain = bannerLines(facts({ host: "github" }), { color: false });
  const painted = bannerLines(facts({ host: "github" }), { color: true });
  assertEquals(painted.length, plain.length);
  // deno-lint-ignore no-control-regex
  const stripped = painted.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  assertEquals(stripped, plain);
  assertEquals(painted[0].includes("\x1b["), true);
});

Deno.test("banner: the facts are reported verbatim", () => {
  const [line] = bannerLines(
    facts({
      host: "gitlab",
      version: "9.9.9",
      deno: "3.0.0",
      platform: "windows-x86_64",
    }),
    { color: false },
  );
  assertEquals(line, "zuke 9.9.9 · deno 3.0.0 · windows-x86_64 · gitlab");
});
