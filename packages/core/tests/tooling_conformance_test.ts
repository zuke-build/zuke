// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import { CommandOutput } from "../src/shell.ts";
import {
  ToolNotFoundError,
  type ToolResolution,
  ToolSettings,
} from "../src/tooling.ts";
import {
  assertWrapperConformance,
  missingTool,
} from "../src/tooling_conformance.ts";

/** A wrapper that resolves its binary from `PATH` (the base default). */
class PathToolSettings extends ToolSettings {
  protected override defaultTool(): string {
    return "zuke-fake-tool";
  }
  protected override buildArgs(): string[] {
    return ["build"];
  }
}

/** The same wrapper, but npx-style. */
class NodeToolSettings extends PathToolSettings {
  protected override defaultResolution(): ToolResolution {
    return "node_modules";
  }
}

/** A wrapper whose default binary name disagrees with its package. */
class MisnamedToolSettings extends PathToolSettings {
  protected override defaultTool(): string {
    return "zuke-other-tool";
  }
}

Deno.test("missingTool pins linux and an unresolvable binary", async () => {
  const settings = new PathToolSettings();
  settings.os_ = "windows";
  const missing = missingTool(settings);
  assertEquals(missing.os_, "linux");
  await assertRejects(() => missing.run(), ToolNotFoundError);
});

Deno.test("a PATH wrapper conforms", async () => {
  await assertWrapperConformance(
    () => new PathToolSettings(),
    "zuke-fake-tool",
    { resolution: "path" },
  );
});

Deno.test("an ambient ZUKE_TOOL_RESOLUTION is ignored, then restored", async () => {
  const previous = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.set("ZUKE_TOOL_RESOLUTION", "node_modules");
  try {
    // The ambient override would make the PATH wrapper resolve npx-style; the
    // kit clears it for the duration so the wrapper's own default is asserted.
    await assertWrapperConformance(
      () => new PathToolSettings(),
      "zuke-fake-tool",
      { resolution: "path" },
    );
    assertEquals(Deno.env.get("ZUKE_TOOL_RESOLUTION"), "node_modules");
  } finally {
    if (previous === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", previous);
  }
});

Deno.test("a node_modules wrapper conforms when it declares so", async () => {
  await assertWrapperConformance(
    () => new NodeToolSettings(),
    "zuke-fake-tool",
    { resolution: "node_modules" },
  );
});

Deno.test("a node_modules wrapper fails a declared PATH expectation", async () => {
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new NodeToolSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    'resolution: "node_modules"',
  );
});

Deno.test("a PATH wrapper fails a node_modules expectation", async () => {
  await assertRejects(
    () =>
      assertWrapperConformance(() => new PathToolSettings(), "zuke-fake-tool", {
        resolution: "node_modules",
      }),
    Error,
    "defaultResolution()",
  );
});

Deno.test("a mismatched default binary is reported", async () => {
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new MisnamedToolSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    'spawns "zuke-other-tool"',
  );
});

Deno.test("a wrapper that swallows a missing binary is reported", async () => {
  /** A wrapper that resolves instead of raising ToolNotFoundError. */
  class SwallowingSettings extends PathToolSettings {
    override run(): Promise<CommandOutput> {
      return Promise.resolve(new CommandOutput(0, "", ""));
    }
  }
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new SwallowingSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    "did not fail",
  );
});

Deno.test("a wrapper that raises the wrong error is reported", async () => {
  /** A wrapper that reports a missing binary as some other failure. */
  class WrongErrorSettings extends PathToolSettings {
    override run(): Promise<CommandOutput> {
      return Promise.reject(new RangeError("boom"));
    }
  }
  const error = await assertRejects(
    () =>
      assertWrapperConformance(
        () => new WrongErrorSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    "RangeError",
  );
  assertEquals(error instanceof ToolNotFoundError, false);
});

Deno.test("a non-Error rejection is reported by its value", async () => {
  /** A wrapper that rejects with something that is not an Error at all. */
  class ThrowsLiteralSettings extends PathToolSettings {
    override run(): Promise<CommandOutput> {
      return Promise.reject("just a string");
    }
  }
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new ThrowsLiteralSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    "just a string",
  );
});

Deno.test("a ToolNotFoundError for another binary is not a pass", async () => {
  /**
   * A wrapper that resolves its real invocation by probing the host before
   * spawning — the `docker compose` / `docker-compose` shape — and so reports a
   * *different* tool missing than the planted one. Accepting that would let the
   * check pass on a host lacking the tool without ever exercising the
   * missing-binary path.
   */
  class DetectingSettings extends PathToolSettings {
    override run(): Promise<CommandOutput> {
      return Promise.reject(new ToolNotFoundError("some-other-tool"));
    }
  }
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new DetectingSettings(),
        "zuke-fake-tool",
        { resolution: "path" },
      ),
    Error,
    "not for the planted",
  );
});
