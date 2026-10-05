// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Canary releases for Zuke builds. `canary(...)` turns a settings lambda into
 * a rollout's targets: stage the candidate at 0 %, step its exposure up while
 * analyses watch each bake, optionally wait for an approval, and promote — with
 * one rollback, `abort`, on every path that goes wrong.
 *
 * ```ts
 * import { Build, run, target } from "@zuke/core";
 * import { canary, httpProbe } from "@zuke/canary";
 *
 * class Deploy extends Build {
 *   rollout = canary((c) =>
 *     c.platform(myPlatform)
 *       .steps(10, 50)
 *       .bake("10m")
 *       .analysis(httpProbe((h) => h.url("https://api.example.com/healthz")))
 *       .lock((l) => l.lockKey("deploy", "api").withTtl("24h"))
 *   );
 *   ship = target().dependsOn(this.rollout.promote).executes(() => {});
 * }
 *
 * await run(Deploy);
 * ```
 *
 * The engine drives the platform only through {@link CanaryPlatform}, so the
 * same rollout runs on Cloud Run, Kubernetes, Docker or a hand-written
 * platform object.
 *
 * @module
 */

export {
  type Canary,
  canary,
  type CanaryPhaseTargets,
} from "./src/component.ts";
export { httpProbe, HttpProbeSettings } from "./src/http_probe.ts";
export { prometheus, PrometheusSettings } from "./src/prometheus.ts";
export { CanarySettings } from "./src/settings.ts";
export {
  type MetricReader,
  metricThreshold,
  MetricThresholdSettings,
  type ThresholdBounds,
} from "./src/threshold.ts";
export type {
  CanaryAnalysis,
  CanaryAnalysisContext,
  CanaryContext,
  CanaryPlatform,
  ExposureKind,
} from "./src/types.ts";
