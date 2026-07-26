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
  );
});

Deno.test("a node_modules wrapper conforms when it declares so", async () => {
  await assertWrapperConformance(
    () => new NodeToolSettings(),
    "zuke-fake-tool",
    { resolution: "node_modules" },
  );
});

Deno.test("a node_modules wrapper fails the default PATH expectation", async () => {
  await assertRejects(
    () =>
      assertWrapperConformance(
        () => new NodeToolSettings(),
        "zuke-fake-tool",
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
      ),
    Error,
    "RangeError",
  );
  assertEquals(error instanceof ToolNotFoundError, false);
});
