/**
 * A real, runnable Zuke build for the OTel e2e suite. Run as a subprocess
 * (`deno run -A otel_build.ts <target>`), it deploys, suspends at an approval
 * gate, and on `resume` promotes — with the `@zuke/otel` plugin registered.
 * The plugin's HTTP transport is redirected (via the internal `otelWith` seam)
 * to a `fetch` that appends every OTLP request to the file named by
 * `OTEL_CAPTURE_FILE`, so a hermetic test can inspect what two genuine
 * processes exported without a running collector. `run()` reads `ZUKE_STATE_DIR`
 * for its durable state.
 *
 * @module
 */

import {
  Build,
  externalSignal,
  run,
  target,
} from "../../../packages/core/mod.ts";
import { otelWith } from "../../../packages/otel/src/plugin.ts";

/** The global `fetch` signature, aliased for the capturing seam. */
type FetchFn = typeof globalThis.fetch;

const captureFile = Deno.env.get("OTEL_CAPTURE_FILE");

/** A `fetch` that appends each OTLP request (url + raw body) to the capture file. */
const capturingFetch: FetchFn = (input, init) => {
  if (captureFile !== undefined && typeof init?.body === "string") {
    Deno.writeTextFileSync(
      captureFile,
      `${JSON.stringify({ url: String(input), body: init.body })}\n`,
      { append: true },
    );
  }
  return Promise.resolve(new Response("{}", { status: 200 }));
};

const plugin = otelWith((s) => s.endpoint("http://collector:4318"), {
  fetch: capturingFetch,
  readEnv: () => undefined,
});

/** A deploy → approval-gate → promote pipeline, observed by the OTel plugin. */
class Cd extends Build {
  /** Deploys (a real body, so it earns a span with timing). */
  deploy = target().executes(() => console.log("DEPLOYED"));
  /** Suspends the run until an `approved` signal is delivered on resume. */
  gate = target()
    .dependsOn(this.deploy)
    .waitsFor((s) => s.on(externalSignal("approved")));
  /** Runs only after the gate opens on resume (in the second process). */
  promote = target().dependsOn(this.gate).executes(() =>
    console.log("PROMOTED")
  );
}

await run(Cd, { plugins: [plugin] });
