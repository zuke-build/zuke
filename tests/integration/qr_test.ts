// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build takes text as a parameter and prints it as a QR
 * code through the CLI `main()` path — a release build showing its download
 * page, a setup build showing a pairing token, or any other data to scan.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { runCli } from "./_harness.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import { QrTasks } from "../../packages/qr/mod.ts";

class QrBuild extends Build {
  url = parameter("the text to encode").required();

  qr = target()
    .description("show the parameter as a QR code")
    .executes(() => {
      QrTasks.print(this.url.value, (s) => s.errorCorrection("Q"));
    });
}

Deno.test("a build prints the parameter's URL as a QR code", async () => {
  const url = "https://zuke.build/releases/1.60.0";
  const { code, out } = await runCli(QrBuild, ["qr", "--url", url]);
  assertEquals(code, 0);
  const expected = QrTasks.renderLines(url, (s) => s.errorCorrection("Q"));
  for (const line of expected) assertStringIncludes(out, line);
  // The whole symbol is there, in order, and nothing was reflowed.
  assertStringIncludes(out, expected.join("\n"));
});

Deno.test("the qr target fails without its required parameter", async () => {
  const { code, err } = await runCli(QrBuild, ["qr"]);
  assertEquals(code, 1);
  assertStringIncludes(err, "url");
});
