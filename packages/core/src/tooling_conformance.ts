/**
 * A conformance kit for tool-wrapper tests.
 *
 * Every `@zuke/*` wrapper package owes its unit test the same three checks: the
 * settings class spawns the binary it claims to, it resolves that binary the way
 * the wrapper intends (bare on `PATH`, or npx-style from `node_modules/.bin`),
 * and a missing binary surfaces as a
 * {@link "./tooling.ts".ToolNotFoundError} rather than some raw
 * `Deno.errors.NotFound`. Hand-written per package, that is a temp-directory /
 * `ZUKE_TOOL_RESOLUTION` save-and-restore dance copied dozens of times — and a
 * wrapper that quietly forgets the resolution check keeps passing.
 *
 * {@link assertWrapperConformance} runs all three, hermetically (nothing real is
 * ever spawned), and takes the expected resolution mode as a *required*
 * argument so each wrapper *asserts* its default instead of remembering it:
 *
 * ```ts
 * Deno.test("biome conforms", async () => {
 *   await assertWrapperConformance(() => new BiomeCheckSettings(), "biome", {
 *     resolution: "node_modules",
 *   });
 * });
 * ```
 *
 * @module
 */

import {
  ToolNotFoundError,
  type ToolResolution,
  type ToolSettings,
} from "./tooling.ts";

/** Options for {@link assertWrapperConformance}. */
export interface WrapperConformanceOptions {
  /**
   * The resolution strategy the wrapper must use when nothing overrides it:
   * `"node_modules"` for a JS-ecosystem tool installed under `node_modules`,
   * `"path"` for a natively installed one. Required, with no default: an
   * npm-distributed wrapper that forgot to override `defaultResolution()` is
   * exactly the bug this kit exists to catch, and a default would let that
   * wrapper's test pass by saying nothing.
   */
  resolution: ToolResolution;
}

/** The binary name {@link missingTool} points settings at — it cannot exist. */
const MISSING = "zuke-no-such-tool-xyz";

/**
 * Point `settings` at a binary that cannot exist, so running it raises a
 * {@link "./tooling.ts".ToolNotFoundError} without ever launching a real
 * process — the way a wrapper test proves each of its task functions reaches
 * execution.
 *
 * The platform is pinned to `linux` because on Windows a missing binary is
 * retried through `cmd /c`, which exists, so the failure would surface as a
 * command error instead:
 *
 * ```ts
 * await assertRejects(() => BiomeTasks.check(missingTool), ToolNotFoundError);
 * ```
 */
export function missingTool<S extends ToolSettings>(settings: S): S {
  settings.os_ = "linux";
  return settings.toolPath(MISSING);
}

/**
 * Assert that a tool wrapper conforms: `makeSettings()` spawns `tool`, resolves
 * it per `options.resolution`, and reports a missing binary as a
 * {@link "./tooling.ts".ToolNotFoundError}.
 *
 * `makeSettings` is called once per check, so each check gets a pristine
 * instance. The resolution check runs against a throwaway temp directory holding
 * a fake `node_modules/.bin/<tool>` shim, with `ZUKE_TOOL_RESOLUTION` unset for
 * the duration and restored afterwards; no real subprocess is ever launched.
 *
 * A wrapper whose `run()` resolves something at run time must have that pinned
 * inside `makeSettings` — `() => new DockerComposeUpSettings().usePlugin()`,
 * say — or the missing-binary check would probe the ambient host. It reports a
 * `ToolNotFoundError` raised for any binary other than the planted one as a
 * failure, so such a wrapper cannot pass by accident on a host that lacks the
 * real tool.
 *
 * @throws {Error} naming the wrapper and the fix, on the first failed check.
 */
export async function assertWrapperConformance(
  makeSettings: () => ToolSettings,
  tool: string,
  options: WrapperConformanceOptions,
): Promise<void> {
  const spawned = head(makeSettings().argv());
  if (spawned !== tool) {
    throw new Error(
      `Wrapper conformance for "${tool}": the settings class spawns ` +
        `"${spawned}" instead. Either fix defaultTool() to return "${tool}", ` +
        `or pass the binary the wrapper really runs as the tool argument.`,
    );
  }
  assertResolution(makeSettings, tool, options.resolution);
  await assertToolNotFound(makeSettings, tool);
}

/**
 * Assert that the wrapper resolves its binary per `expected`, by planting a fake
 * `node_modules/.bin/<tool>` next to a temp working directory: an npx-style
 * wrapper must rewrite argv[0] to that shim, a `PATH` wrapper must ignore it.
 */
function assertResolution(
  makeSettings: () => ToolSettings,
  tool: string,
  expected: ToolResolution,
): void {
  const previous = Deno.env.get("ZUKE_TOOL_RESOLUTION");
  Deno.env.delete("ZUKE_TOOL_RESOLUTION");
  const root = Deno.makeTempDirSync();
  try {
    const binDir = `${root}/node_modules/.bin`;
    Deno.mkdirSync(binDir, { recursive: true });
    const shim = slashes(`${binDir}/${tool}`);
    Deno.writeTextFileSync(shim, "#!/bin/sh\n");
    const settings = makeSettings();
    // Pin linux: the shim written above has no `.cmd`/`.bat` extension, which is
    // all a Windows host would look for.
    settings.os_ = "linux";
    const resolved = slashes(head(settings.cwd(root).resolvedArgv()));
    if (expected === "node_modules" && resolved !== shim) {
      throw new Error(
        `Wrapper conformance for "${tool}": expected npx-style resolution, ` +
          `but the wrapper spawned "${resolved}" with a ` +
          `node_modules/.bin/${tool} shim in the working directory. Override ` +
          `defaultResolution() to return "node_modules", or pass ` +
          `{ resolution: "path" } if this tool really is a PATH install.`,
      );
    }
    if (expected === "path" && resolved !== tool) {
      throw new Error(
        `Wrapper conformance for "${tool}": expected the bare name on PATH, ` +
          `but the wrapper resolved "${resolved}". This wrapper resolves from ` +
          `node_modules — assert that by passing ` +
          `{ resolution: "node_modules" }.`,
      );
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
    if (previous === undefined) Deno.env.delete("ZUKE_TOOL_RESOLUTION");
    else Deno.env.set("ZUKE_TOOL_RESOLUTION", previous);
  }
}

/** Assert that a binary that cannot exist surfaces as a `ToolNotFoundError`. */
async function assertToolNotFound(
  makeSettings: () => ToolSettings,
  tool: string,
): Promise<void> {
  try {
    await missingTool(makeSettings()).run();
  } catch (error) {
    if (error instanceof ToolNotFoundError) {
      if (error.tool === MISSING) return;
      throw new Error(
        `Wrapper conformance for "${tool}": the missing-binary check raised a ` +
          `ToolNotFoundError for "${error.tool}", not for the planted ` +
          `"${MISSING}" — so run() resolved some other tool before spawning, ` +
          `by probing the host. Pin that resolution inside the makeSettings ` +
          `lambda (Compose's .usePlugin(), for instance) so the check stays ` +
          `hermetic and really exercises the missing binary.`,
      );
    }
    const name = error instanceof Error ? error.name : String(error);
    throw new Error(
      `Wrapper conformance for "${tool}": running a binary that does not ` +
        `exist raised ${name} instead of a ToolNotFoundError. Run the tool ` +
        `through ToolSettings.run() so the friendly error is produced.`,
    );
  }
  throw new Error(
    `Wrapper conformance for "${tool}": running a binary that does not exist ` +
      `did not fail. The task must reach ToolSettings.run() so a missing ` +
      `binary raises a ToolNotFoundError.`,
  );
}

/** The first argv entry, without an index-access `undefined` to narrow. */
function head(argv: ReadonlyArray<string>): string {
  return argv.slice(0, 1).join("");
}

/** Normalise Windows separators, the form resolved paths come back in. */
function slashes(path: string): string {
  return path.replace(/\\/g, "/");
}
