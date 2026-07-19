/**
 * A tiny runnable build used by the registry-MCP e2e. It registers itself
 * (`register`) into `ZUKE_REGISTRY_DIR`, and its one target prints a marker so a
 * registry-backed `zuke mcp` server that spawns it can be shown to have captured
 * real subprocess output.
 *
 * @module
 */

import { Build, parameter, run, target } from "../../../packages/core/mod.ts";

/** A small pipeline whose output the registry-MCP e2e asserts on. */
class Widget extends Build {
  /** Repos to deploy — a runtime list forwarded across the spawn boundary. */
  repos = parameter("service repos to deploy").array();
  /** Whether to skip the e2e stage — a boolean forwarded as `--skip-e2e`. */
  skipE2e = parameter("skip the e2e stage").boolean();
  /** An optional SIT slot; when omitted the build reports it as auto-leased. */
  sit = parameter("SIT slot");

  /** Prints a marker the spawning MCP server captures and returns. */
  hello = target()
    .description("Say hello")
    .executes(() => console.log("HELLO-FROM-REGISTERED"));

  /** Echoes its bound parameters, proving they crossed the spawn boundary. */
  deploy = target()
    .description("Deploy the given repos")
    .executes(() =>
      console.log(
        `DEPLOY repos=${this.repos.value.join(",")} ` +
          `skipE2e=${this.skipE2e.value} sit=${this.sit.value ?? "auto"}`,
      )
    );
}

await run(Widget);
