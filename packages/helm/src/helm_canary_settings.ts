// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link HelmCanarySettings} — what {@link "./helm_canary.ts".helmCanary}'s
 * lambda configures, and the runner seam every command goes through.
 *
 * @module
 */

import type { CommandOutput } from "@zuke/core/shell";
import type { Configure, PathLike } from "@zuke/core/tooling";
import type { HelmSettings } from "./helm.ts";

/**
 * Runs one prepared `helm` command and returns its output. The default runs
 * it; a test or a build that executes helm some other way injects its own
 * with {@link HelmCanarySettings.runner}.
 */
export type HelmSettingsRunner = (
  settings: HelmSettings,
) => Promise<CommandOutput>;

/** How `helmCanary` reaches the releases, configured through its lambda. */
export class HelmCanarySettings {
  /** The chart the candidate is rendered from (set by {@link chart}). */
  chart_?: string;
  /** The candidate chart's version (set by {@link version}). */
  version_?: string;
  /** The chart the stable release runs (set by {@link stableChart}). */
  stableChart_?: string;
  /** The stable chart's version (set by {@link stableVersion}). */
  stableVersion_?: string;
  /** The release serving today (set by {@link stableRelease}). */
  stableRelease_?: string;
  /** The release the candidate runs as (set by {@link canaryRelease}). */
  canaryRelease_?: string;
  /** The namespace both releases live in (set by {@link namespace}). */
  namespace_?: string;
  /** The candidate's image value (set by {@link image}). */
  image_?: string;
  /** The values path the image is set on (set by {@link imageKey}). */
  imageKey_ = "image.tag";
  /** The values path the replica count is set on (set by {@link replicasKey}). */
  replicasKey_ = "replicaCount";
  /** The total replica count across both releases (set by {@link replicas}). */
  replicas_?: number;
  /** Values files for the canary release and the promotion (set by {@link values}). */
  values_: string[] = [];
  /** How long each waiting command may take (set by {@link timeout}). */
  timeout_?: string;
  /** The revision a hand-run rollback returns to (set by {@link stableRevision}). */
  stableRevision_?: number;
  /** Global helm flags for every command (set by {@link helm}). */
  helm_?: Configure<HelmSettings>;
  /** How each command is run (set by {@link runner}). */
  runner_: HelmSettingsRunner = (settings) => settings.run();

  /**
   * The chart the candidate is rendered from — a path, `repo/name` or an
   * `oci://` reference. The canary release and the promotion use it; the
   * stable release's replica moves use it too unless {@link stableChart}
   * names the chart the stable release runs. Pin a repository chart with
   * {@link version}: a chart that is not a local path (one starting with
   * `.` or `/`) is refused without one.
   */
  chart(ref: string): this {
    this.chart_ = ref;
    return this;
  }

  /** The candidate chart's version (`--version`). */
  version(value: string): this {
    this.version_ = value;
    return this;
  }

  /**
   * The chart the stable release runs today, for the replica moves on it
   * while the canary runs. Without it they render {@link chart}, so a
   * candidate that changes the chart changes every stable pod's templates at
   * the first step. A chart that is not a local path (one starting with `.`
   * or `/`) must be pinned with {@link stableVersion}, or each move would
   * render whatever the repository serves as latest.
   */
  stableChart(ref: string): this {
    this.stableChart_ = ref;
    return this;
  }

  /**
   * The stable chart's version (`--version` on the stable release's replica
   * moves). Defaults to {@link version} when {@link stableChart} is not set,
   * and is required when it names a repository or `oci://` chart.
   */
  stableVersion(value: string): this {
    this.stableVersion_ = value;
    return this;
  }

  /** The release serving today. It must already exist; the canary amends it. */
  stableRelease(name: string): this {
    this.stableRelease_ = name;
    return this;
  }

  /** The release the candidate runs as (default `<stable>-canary`). */
  canaryRelease(name: string): this {
    this.canaryRelease_ = name;
    return this;
  }

  /** The namespace both releases live in (`--namespace`). */
  namespace(name: string): this {
    this.namespace_ = name;
    return this;
  }

  /**
   * The candidate's image, as the chart reads it at {@link imageKey}. With
   * the default key, `image.tag`, that is the tag alone (`1.4.2`, or
   * `1.4.2@sha256:…`), as the chart `helm create` scaffolds expects; point
   * {@link imageKey} at a key that takes a full reference to pass one. Set
   * with `--set-string`, so a tag like `1.10` is not turned into a number.
   */
  image(value: string): this {
    this.image_ = value;
    return this;
  }

  /** The values path the image is set on (default `image.tag`). */
  imageKey(path: string): this {
    this.imageKey_ = path;
    return this;
  }

  /**
   * The values path the replica count is set on (default `replicaCount`, as
   * `helm create` scaffolds). The chart must honour it — an enabled
   * autoscaler that ignores it makes the exposure meaningless.
   */
  replicasKey(path: string): this {
    this.replicasKey_ = path;
    return this;
  }

  /**
   * The total replica count, split between the two releases while the
   * canary runs and given to the stable release by the promotion.
   */
  replicas(total: number): this {
    this.replicas_ = total;
    return this;
  }

  /**
   * Values files (`--values`) the canary release is installed with, and that
   * the promotion merges into the stable release's values. The canary
   * release inherits nothing from the stable one, so these must carry its
   * whole configuration.
   */
  values(...files: PathLike[]): this {
    this.values_.push(...files.map(String));
    return this;
  }

  /** How long each command that waits may take, e.g. `10m` (`--timeout`). */
  timeout(duration: string): this {
    this.timeout_ = duration;
    return this;
  }

  /**
   * The stable release's revision to roll back to when `rollout.abort` is run
   * by hand — the one `helm history <stable>` lists from before the rollout.
   * Such a run is fresh, with no record of a rollout, so it has nothing else
   * to go on. A rollback the engine runs mid-rollout does not use it: that one
   * returns to the revision `stage` recorded.
   */
  stableRevision(revision: number): this {
    this.stableRevision_ = revision;
    return this;
  }

  /**
   * Global flags for every helm command the platform runs —
   * `(s) => s.kubeContext("prod").kubeconfig("~/.kube/prod")`, or a
   * `.toolPath(...)` to a specific helm.
   */
  helm(configure: Configure<HelmSettings>): this {
    this.helm_ = configure;
    return this;
  }

  /**
   * Replace how each prepared command is run. The default runs it; this is
   * for a test, or for a build that executes helm through something else.
   */
  runner(run: HelmSettingsRunner): this {
    this.runner_ = run;
    return this;
  }
}
