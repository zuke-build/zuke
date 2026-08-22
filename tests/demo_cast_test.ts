// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Validates the README demo recording against the real CLI: replays the
 * interactive `zuke setup` scene the cast stages — same answers, same
 * gh-authenticated star flow — through the actual `main()` with the fake
 * seams, and asserts every deterministic output line appears in the cast's
 * transcript. If setup's wording, prompt ordering, scaffold output, or the
 * logo art change without `assets/demo.cast` being re-captured, this fails —
 * so the demo cannot silently drift from reality (see `assets/README.md` for
 * the re-capture recipe).
 */

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { ConsoleTasks } from "../packages/console/mod.ts";
import { main } from "../packages/cli/mod.ts";
import { VERSION } from "../packages/cli/src/version.ts";
import {
  FakeHost,
  FakePrompter,
  FakeStarActions,
} from "../packages/cli/tests/_fakes.ts";

/**
 * Every terminal control sequence, including cursor movement and mode toggles
 * — broader than the SGR-only pattern in core's render, because the cast
 * carries Deno's interactive-prompt sequences too.
 */
// deno-lint-ignore no-control-regex
const CONTROL_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** The cast's whole output stream as plain text, one string. */
function castTranscript(): string {
  const lines = Deno.readTextFileSync(
    new URL("../assets/demo.cast", import.meta.url),
  ).split("\n").filter((line) => line.trim() !== "");
  let text = "";
  for (const line of lines.slice(1)) {
    const parsed: unknown = JSON.parse(line);
    if (Array.isArray(parsed) && parsed[1] === "o") {
      text += String(parsed[2]);
    }
  }
  return text.replace(CONTROL_PATTERN, "").replaceAll("\r\n", "\n");
}

Deno.test("the demo cast matches the real interactive setup flow", async () => {
  const transcript = castTranscript();

  // Replay the scene the cast stages: name "Pipeline", no overwrite, star
  // with an authenticated gh — through the real main(), hermetically.
  const host = new FakeHost();
  const prompter = new FakePrompter(true, "Pipeline", false, true);
  const actions = new FakeStarActions(true);
  ConsoleTasks.configure({ level: "info", color: false });
  try {
    assertEquals(await main(["setup"], host, prompter, undefined, actions), 0);
  } finally {
    ConsoleTasks.reset();
  }

  // Every deterministic line the CLI printed must appear in the cast. The
  // version tagline is exempt: release-please bumps VERSION without touching
  // the recording, and the demo need not be re-captured per release.
  const expected = host.logs.filter(
    (line) => line !== "" && !line.includes(VERSION),
  );
  for (const line of expected) {
    assertEquals(
      transcript.includes(line),
      true,
      `cast is missing a line the real CLI prints: ${JSON.stringify(line)} — ` +
        `re-capture assets/demo.cast (see assets/README.md).`,
    );
  }

  // The questions, exactly as asked (Deno's confirm appends " [y/N]").
  for (const question of prompter.confirms) {
    assertEquals(
      transcript.includes(`${question} [y/N]`),
      true,
      `cast is missing the prompt ${JSON.stringify(question)} — re-capture ` +
        `assets/demo.cast (see assets/README.md).`,
    );
  }
  // The scene's premise held: gh was probed and the star was placed.
  assertEquals(actions.calls, ["auth", "star"]);
  assertEquals(transcript.includes("Build class name"), true);
});
