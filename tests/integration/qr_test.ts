// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build takes a URL as a parameter and prints it as a QR
 * code through the CLI `main()` path — the "scan this to reach the upload
 * page" shape a conference demo build uses.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { runCli } from "./_harness.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { QrTasks } from "../../packages/qr/mod.ts";

class RaffleBuild extends Build {
  url = parameter("the upload page to point the room at").required();

  qr = target()
    .description("show the upload page as a QR code")
    .executes(() => {
      QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
    });
}

Deno.test("a build prints the parameter's URL as a QR code", async () => {
  const url = "https://raffle.zuke.build/?event=devopscon";
  const { code, out } = await runCli(RaffleBuild, ["qr", "--url", url]);
  assertEquals(code, 0);
  const expected = QrTasks.renderLines(url, (s) => s.errorCorrection("Q"));
  for (const line of expected) assertStringIncludes(out, line);
  // The whole symbol is there, in order, and nothing was reflowed.
  assertStringIncludes(out, expected.join("\n"));
});

Deno.test("the qr target fails without its required parameter", async () => {
  const { code, err } = await runCli(RaffleBuild, ["qr"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "url");
});
