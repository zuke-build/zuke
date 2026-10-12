// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  assertWrapperConformance,
  missingTool,
} from "@zuke/core/tooling/conformance";
import { DittoSettings, DittoTasks } from "../src/ditto.ts";

Deno.test("ditto: a plain copy is source then destination", () => {
  assertEquals(
    new DittoSettings().source("a.app").destination("out/a.app").argv(),
    ["ditto", "a.app", "out/a.app"],
  );
});

Deno.test("ditto: every flag renders, operands last", () => {
  assertEquals(
    new DittoSettings().create().pkzip().sequesterRsrc().keepParent()
      .source("dist/MyApp.app").destination("dist/MyApp.zip").argv(),
    [
      "ditto",
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      "dist/MyApp.app",
      "dist/MyApp.zip",
    ],
  );
  assertEquals(
    new DittoSettings().extract().source("a.zip").destination("out").argv(),
    ["ditto", "-x", "a.zip", "out"],
  );
});

Deno.test("ditto: operands that look like flags stay operands", () => {
  assertEquals(
    new DittoSettings().source("-rf").destination("--keepParent").argv(),
    ["ditto", "./-rf", "./--keepParent"],
  );
});

Deno.test("ditto: create and extract together are refused", () => {
  assertThrows(
    () =>
      new DittoSettings().create().extract().source("a").destination("b")
        .argv(),
    Error,
    "cannot be combined",
  );
});

Deno.test("ditto: a missing source or destination is refused", () => {
  assertThrows(
    () => new DittoSettings().source("a").argv(),
    Error,
    "both a source and a destination",
  );
  assertThrows(
    () => new DittoSettings().destination("b").argv(),
    Error,
    "both a source and a destination",
  );
});

Deno.test("DittoTasks: archive presets -c -k, extract presets -x -k", async () => {
  // The preset flags are visible on the settings the lambda receives.
  let archived: string[] = [];
  await assertRejects(
    () =>
      DittoTasks.archive((s) => {
        const configured = missingTool(s).keepParent().source("a.app")
          .destination("a.zip");
        archived = configured.argv();
        return configured;
      }),
    ToolNotFoundError,
  );
  assertEquals(archived.slice(1), [
    "-c",
    "-k",
    "--keepParent",
    "a.app",
    "a.zip",
  ]);
  let extracted: string[] = [];
  await assertRejects(
    () =>
      DittoTasks.extract((s) => {
        const configured = missingTool(s).source("a.zip").destination("out");
        extracted = configured.argv();
        return configured;
      }),
    ToolNotFoundError,
  );
  assertEquals(extracted.slice(1), ["-x", "-k", "a.zip", "out"]);
  await assertRejects(
    () => DittoTasks.copy((s) => missingTool(s).source("a").destination("b")),
    ToolNotFoundError,
  );
});

Deno.test("ditto resolves its binary from PATH", async () => {
  await assertWrapperConformance(
    () => new DittoSettings().source("a").destination("b"),
    "ditto",
    { resolution: "path" },
  );
});
