/**
 * A tiny runnable build used by the registry-MCP e2e. It registers itself
 * (`register`) into `ZUKE_REGISTRY_DIR`, and its one target prints a marker so a
 * registry-backed `zuke mcp` server that spawns it can be shown to have captured
 * real subprocess output.
 *
 * @module
 */

import { Build, run, target } from "../../../packages/core/mod.ts";

/** A one-target pipeline whose output the e2e asserts on. */
class Widget extends Build {
  /** Prints a marker the spawning MCP server captures and returns. */
  hello = target()
    .description("Say hello")
    .executes(() => console.log("HELLO-FROM-REGISTERED"));
}

await run(Widget);
