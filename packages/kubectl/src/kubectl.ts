// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `KubectlTasks` — typed task functions for the `kubectl` CLI, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { KubectlTasks } from "jsr:@zuke/kubectl";
 *
 * await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
 * await KubectlTasks.rollout((s) => s.status().resource("deployment/api"));
 * await KubectlTasks.setImage((s) =>
 *   s.resource("deployment/api").image("api", "api:1.4")
 * );
 * ```
 *
 * Every subcommand shares the cluster-targeting flags `--namespace`,
 * `--context`, and `--kubeconfig` (from the
 * {@link "./settings.ts".KubectlSettings} base). Arguments stay a discrete
 * argv array end-to-end — never a concatenated shell string — so command
 * construction is injection-free.
 *
 * This module assembles the task object; each command's settings live in the
 * module for its own domain.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import {
  KubectlApplySettings,
  KubectlCreateSettings,
  KubectlDeleteSettings,
} from "./manifests.ts";
import {
  KubectlAnnotateSettings,
  KubectlDescribeSettings,
  KubectlGetSettings,
  KubectlLabelSettings,
  KubectlPatchSettings,
} from "./resources.ts";
import {
  KubectlRolloutSettings,
  KubectlScaleSettings,
  KubectlSetImageSettings,
} from "./workloads.ts";
import {
  KubectlExecSettings,
  KubectlLogsSettings,
  KubectlPortForwardSettings,
} from "./pods.ts";
import { KubectlTopSettings, KubectlWaitSettings } from "./diagnostics.ts";
import { type KubernetesNamespace, parseNamespaces } from "./resource_json.ts";

/** The shape of {@link KubectlTasks}. */
export interface KubectlTasksApi {
  /** Apply manifests: `kubectl apply`. */
  apply(configure?: Configure<KubectlApplySettings>): Promise<CommandOutput>;
  /** Create resources: `kubectl create`. */
  create(configure?: Configure<KubectlCreateSettings>): Promise<CommandOutput>;
  /** Delete resources: `kubectl delete`. */
  delete(configure?: Configure<KubectlDeleteSettings>): Promise<CommandOutput>;
  /** List resources: `kubectl get`. */
  get(configure?: Configure<KubectlGetSettings>): Promise<CommandOutput>;
  /**
   * List namespaces as typed {@link KubernetesNamespace} records: runs
   * `kubectl get namespaces -o json` (forcing JSON output, quietly) and parses
   * the result. Use the lambda for cluster flags or a label `.selector(...)`.
   */
  getNamespaces(
    configure?: Configure<KubectlGetSettings>,
  ): Promise<KubernetesNamespace[]>;
  /** Describe resources: `kubectl describe`. */
  describe(
    configure?: Configure<KubectlDescribeSettings>,
  ): Promise<CommandOutput>;
  /** Read logs: `kubectl logs`. */
  logs(configure?: Configure<KubectlLogsSettings>): Promise<CommandOutput>;
  /** Exec into a container: `kubectl exec`. */
  exec(configure?: Configure<KubectlExecSettings>): Promise<CommandOutput>;
  /** Manage rollouts: `kubectl rollout`. */
  rollout(
    configure?: Configure<KubectlRolloutSettings>,
  ): Promise<CommandOutput>;
  /** Scale a workload: `kubectl scale`. */
  scale(configure?: Configure<KubectlScaleSettings>): Promise<CommandOutput>;
  /** Update a container image: `kubectl set image`. */
  setImage(
    configure?: Configure<KubectlSetImageSettings>,
  ): Promise<CommandOutput>;
  /** Annotate resources: `kubectl annotate`. */
  annotate(
    configure?: Configure<KubectlAnnotateSettings>,
  ): Promise<CommandOutput>;
  /** Label resources: `kubectl label`. */
  label(configure?: Configure<KubectlLabelSettings>): Promise<CommandOutput>;
  /** Patch a resource: `kubectl patch`. */
  patch(configure?: Configure<KubectlPatchSettings>): Promise<CommandOutput>;
  /** Forward local ports: `kubectl port-forward`. */
  portForward(
    configure?: Configure<KubectlPortForwardSettings>,
  ): Promise<CommandOutput>;
  /** Wait for a condition: `kubectl wait`. */
  wait(configure?: Configure<KubectlWaitSettings>): Promise<CommandOutput>;
  /** Show resource usage: `kubectl top`. */
  top(configure?: Configure<KubectlTopSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `kubectl` CLI. */
export const KubectlTasks: KubectlTasksApi = {
  apply(configure?: Configure<KubectlApplySettings>): Promise<CommandOutput> {
    return runSettings(new KubectlApplySettings(), configure);
  },
  create(configure?: Configure<KubectlCreateSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlCreateSettings(), configure);
  },
  delete(configure?: Configure<KubectlDeleteSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlDeleteSettings(), configure);
  },
  get(configure?: Configure<KubectlGetSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlGetSettings(), configure);
  },
  async getNamespaces(
    configure?: Configure<KubectlGetSettings>,
  ): Promise<KubernetesNamespace[]> {
    const settings = new KubectlGetSettings().resource("namespaces");
    configure?.(settings);
    // Force a single JSON snapshot regardless of the caller's config: JSON output
    // to parse, `.watch(false)` so it returns once instead of streaming forever,
    // and `.quiet()` so the raw JSON isn't echoed to the terminal.
    const out = await settings.output("json").watch(false).quiet().run();
    return parseNamespaces(out.text());
  },
  describe(
    configure?: Configure<KubectlDescribeSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlDescribeSettings(), configure);
  },
  logs(configure?: Configure<KubectlLogsSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlLogsSettings(), configure);
  },
  exec(configure?: Configure<KubectlExecSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlExecSettings(), configure);
  },
  rollout(
    configure?: Configure<KubectlRolloutSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlRolloutSettings(), configure);
  },
  scale(configure?: Configure<KubectlScaleSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlScaleSettings(), configure);
  },
  setImage(
    configure?: Configure<KubectlSetImageSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlSetImageSettings(), configure);
  },
  annotate(
    configure?: Configure<KubectlAnnotateSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlAnnotateSettings(), configure);
  },
  label(configure?: Configure<KubectlLabelSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlLabelSettings(), configure);
  },
  patch(configure?: Configure<KubectlPatchSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlPatchSettings(), configure);
  },
  portForward(
    configure?: Configure<KubectlPortForwardSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlPortForwardSettings(), configure);
  },
  wait(configure?: Configure<KubectlWaitSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlWaitSettings(), configure);
  },
  top(configure?: Configure<KubectlTopSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlTopSettings(), configure);
  },
};
