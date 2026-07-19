/**
 * A real, runnable Zuke build used by the registry e2e race. Run as a subprocess
 * (`deno run -A register_build.ts register`), it records itself in the build
 * registry `ZUKE_REGISTRY_DIR` points at — so two genuine OS processes can race
 * the same descriptor's compare-and-swap and prove no torn write results.
 *
 * @module
 */

import { Build, parameter, run, target } from "../../../packages/core/mod.ts";

/** A tiny pipeline with a secret parameter (which must stay out of the record). */
class Catalog extends Build {
  /** A secret; the registered descriptor must never carry its value. */
  apiToken = parameter("api token").secret();
  /** A leaf target. */
  lint = target().description("Lint").executes(() => {});
  /** A target depending on the leaf, so the surface has an edge. */
  build = target().dependsOn(this.lint).executes(() => {});
}

await run(Catalog);
