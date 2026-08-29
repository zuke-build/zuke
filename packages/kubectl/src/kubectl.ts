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
import {
  type KubernetesEvent,
  type KubernetesNamespace,
  type KubernetesResource,
  type KubernetesVersion,
  parseEvents,
  parseNamespaces,
  parseResources,
  parseVersion,
} from "./resource_json.ts";
import { KubectlDiffSettings, KubectlReplaceSettings } from "./manifests.ts";
import { KubectlExplainSettings } from "./resources.ts";
import {
  KubectlExposeSettings,
  KubectlRunSettings,
  KubectlSetEnvSettings,
  KubectlSetResourcesSettings,
} from "./workloads.ts";
import { KubectlCpSettings } from "./pods.ts";
import { KubectlEventsSettings } from "./diagnostics.ts";
import {
  KubectlApiResourcesSettings,
  KubectlApiVersionsSettings,
  KubectlAuthCanISettings,
  KubectlClusterInfoSettings,
  KubectlConfigCurrentContextSettings,
  KubectlConfigGetContextsSettings,
  KubectlConfigSetContextSettings,
  KubectlConfigUseContextSettings,
  KubectlConfigViewSettings,
  KubectlKustomizeSettings,
  KubectlVersionSettings,
} from "./cluster.ts";
import {
  KubectlCordonSettings,
  KubectlDrainSettings,
  KubectlTaintSettings,
} from "./nodes.ts";
import { answerFromExitCode } from "./exit_code.ts";

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
  /**
   * Show what an apply would change: `kubectl diff`. The command exits 1 when
   * it finds differences, so this task fails the target on drift — which is
   * what a gate wants. Use {@link KubectlTasksApi.diffHasChanges} to read the
   * answer as a value instead.
   */
  diff(configure?: Configure<KubectlDiffSettings>): Promise<CommandOutput>;
  /**
   * Whether an apply would change anything: `true` when `kubectl diff` reports
   * differences, `false` when it reports none. An exit code above 1 means
   * kubectl or its differ failed and still fails the build.
   */
  diffHasChanges(configure?: Configure<KubectlDiffSettings>): Promise<boolean>;
  /** Replace a resource wholesale: `kubectl replace`. */
  replace(
    configure?: Configure<KubectlReplaceSettings>,
  ): Promise<CommandOutput>;
  /**
   * Every matching resource as typed {@link KubernetesResource} records: runs
   * `kubectl get … -o json` and parses the common metadata, whatever the kind.
   */
  getEntries(
    configure?: Configure<KubectlGetSettings>,
  ): Promise<KubernetesResource[]>;
  /** Show a resource type's schema: `kubectl explain`. */
  explain(
    configure?: Configure<KubectlExplainSettings>,
  ): Promise<CommandOutput>;
  /** Change environment variables on a pod template: `kubectl set env`. */
  setEnv(configure?: Configure<KubectlSetEnvSettings>): Promise<CommandOutput>;
  /** Change requests and limits on a pod template: `kubectl set resources`. */
  setResources(
    configure?: Configure<KubectlSetResourcesSettings>,
  ): Promise<CommandOutput>;
  /** Run one pod imperatively: `kubectl run`. */
  run(configure?: Configure<KubectlRunSettings>): Promise<CommandOutput>;
  /** Put a service in front of a workload: `kubectl expose`. */
  expose(configure?: Configure<KubectlExposeSettings>): Promise<CommandOutput>;
  /** Copy files into or out of a container: `kubectl cp`. */
  cp(configure?: Configure<KubectlCpSettings>): Promise<CommandOutput>;
  /** Report cluster events: `kubectl events`. */
  events(configure?: Configure<KubectlEventsSettings>): Promise<CommandOutput>;
  /**
   * The events as typed {@link KubernetesEvent} records — what a build reads
   * when a rollout stalls and `rollout status` will not say why.
   */
  eventEntries(
    configure?: Configure<KubectlEventsSettings>,
  ): Promise<KubernetesEvent[]>;
  /** The name of the current kubeconfig context: `kubectl config current-context`. */
  currentContext(
    configure?: Configure<KubectlConfigCurrentContextSettings>,
  ): Promise<string>;
  /** The available context names: `kubectl config get-contexts -o name`. */
  contexts(
    configure?: Configure<KubectlConfigGetContextsSettings>,
  ): Promise<string[]>;
  /** Switch the current context: `kubectl config use-context`. */
  useContext(
    configure?: Configure<KubectlConfigUseContextSettings>,
  ): Promise<CommandOutput>;
  /** Write a context entry: `kubectl config set-context`. */
  setContext(
    configure?: Configure<KubectlConfigSetContextSettings>,
  ): Promise<CommandOutput>;
  /** Show the merged kubeconfig: `kubectl config view`. */
  configView(
    configure?: Configure<KubectlConfigViewSettings>,
  ): Promise<CommandOutput>;
  /** Print the client and server versions: `kubectl version`. */
  version(
    configure?: Configure<KubectlVersionSettings>,
  ): Promise<CommandOutput>;
  /** The client and server versions, parsed from `kubectl version -o json`. */
  versionInfo(
    configure?: Configure<KubectlVersionSettings>,
  ): Promise<KubernetesVersion>;
  /** Show where the cluster's services live: `kubectl cluster-info`. */
  clusterInfo(
    configure?: Configure<KubectlClusterInfoSettings>,
  ): Promise<CommandOutput>;
  /** List the server's API resources: `kubectl api-resources`. */
  apiResources(
    configure?: Configure<KubectlApiResourcesSettings>,
  ): Promise<CommandOutput>;
  /** List the server's API versions: `kubectl api-versions`. */
  apiVersions(
    configure?: Configure<KubectlApiVersionsSettings>,
  ): Promise<CommandOutput>;
  /** Check a permission: `kubectl auth can-i`. */
  authCanI(
    configure?: Configure<KubectlAuthCanISettings>,
  ): Promise<CommandOutput>;
  /**
   * Whether the action is allowed. `kubectl auth can-i` answers through its
   * exit status, so this reads the code rather than failing the build on a
   * routine "no".
   */
  canI(configure?: Configure<KubectlAuthCanISettings>): Promise<boolean>;
  /** Render a kustomization to stdout: `kubectl kustomize`. */
  kustomize(
    configure?: Configure<KubectlKustomizeSettings>,
  ): Promise<CommandOutput>;
  /** Mark a node unschedulable, or schedulable again: `kubectl cordon`/`uncordon`. */
  cordon(configure?: Configure<KubectlCordonSettings>): Promise<CommandOutput>;
  /** Evict a node's pods before maintenance: `kubectl drain`. */
  drain(configure?: Configure<KubectlDrainSettings>): Promise<CommandOutput>;
  /** Add or remove node taints: `kubectl taint`. */
  taint(configure?: Configure<KubectlTaintSettings>): Promise<CommandOutput>;
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

  diff(configure?: Configure<KubectlDiffSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlDiffSettings(), configure);
  },
  async diffHasChanges(
    configure?: Configure<KubectlDiffSettings>,
  ): Promise<boolean> {
    const settings = new KubectlDiffSettings();
    configure?.(settings);
    // kubectl diff reports its answer through the exit status, so the throw is
    // suppressed and the code read: 0 no differences, 1 differences, 2+ broken.
    const out = await settings.noThrow().quiet().run();
    // 0 is kubectl's "no differences", so the answer inverts into the name.
    const unchanged = answerFromExitCode("diffHasChanges", out, 1);
    return !unchanged;
  },
  replace(
    configure?: Configure<KubectlReplaceSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlReplaceSettings(), configure);
  },
  async getEntries(
    configure?: Configure<KubectlGetSettings>,
  ): Promise<KubernetesResource[]> {
    const settings = new KubectlGetSettings();
    configure?.(settings);
    const out = await settings.output("json").watch(false).quiet().run();
    return parseResources(out.text());
  },
  explain(
    configure?: Configure<KubectlExplainSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlExplainSettings(), configure);
  },
  setEnv(configure?: Configure<KubectlSetEnvSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlSetEnvSettings(), configure);
  },
  setResources(
    configure?: Configure<KubectlSetResourcesSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlSetResourcesSettings(), configure);
  },
  run(configure?: Configure<KubectlRunSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlRunSettings(), configure);
  },
  expose(configure?: Configure<KubectlExposeSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlExposeSettings(), configure);
  },
  cp(configure?: Configure<KubectlCpSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlCpSettings(), configure);
  },
  events(configure?: Configure<KubectlEventsSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlEventsSettings(), configure);
  },
  async eventEntries(
    configure?: Configure<KubectlEventsSettings>,
  ): Promise<KubernetesEvent[]> {
    const settings = new KubectlEventsSettings();
    configure?.(settings);
    const out = await settings.output("json").quiet().run();
    return parseEvents(out.text());
  },
  async currentContext(
    configure?: Configure<KubectlConfigCurrentContextSettings>,
  ): Promise<string> {
    const settings = new KubectlConfigCurrentContextSettings();
    configure?.(settings);
    const out = await settings.quiet().run();
    return out.stdout.trim();
  },
  async contexts(
    configure?: Configure<KubectlConfigGetContextsSettings>,
  ): Promise<string[]> {
    const settings = new KubectlConfigGetContextsSettings();
    configure?.(settings);
    const out = await settings.namesOnly().quiet().run();
    return out.stdout.split("\n").map((line) => line.trim()).filter((line) =>
      line !== ""
    );
  },
  useContext(
    configure?: Configure<KubectlConfigUseContextSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlConfigUseContextSettings(), configure);
  },
  setContext(
    configure?: Configure<KubectlConfigSetContextSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlConfigSetContextSettings(), configure);
  },
  configView(
    configure?: Configure<KubectlConfigViewSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlConfigViewSettings(), configure);
  },
  version(
    configure?: Configure<KubectlVersionSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlVersionSettings(), configure);
  },
  async versionInfo(
    configure?: Configure<KubectlVersionSettings>,
  ): Promise<KubernetesVersion> {
    const settings = new KubectlVersionSettings();
    configure?.(settings);
    const out = await settings.output("json").quiet().run();
    return parseVersion(out.text());
  },
  clusterInfo(
    configure?: Configure<KubectlClusterInfoSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlClusterInfoSettings(), configure);
  },
  apiResources(
    configure?: Configure<KubectlApiResourcesSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlApiResourcesSettings(), configure);
  },
  apiVersions(
    configure?: Configure<KubectlApiVersionsSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlApiVersionsSettings(), configure);
  },
  authCanI(
    configure?: Configure<KubectlAuthCanISettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlAuthCanISettings(), configure);
  },
  async canI(
    configure?: Configure<KubectlAuthCanISettings>,
  ): Promise<boolean> {
    const settings = new KubectlAuthCanISettings();
    configure?.(settings);
    // `--list` prints every allowed action and exits 0 whatever it found, so a
    // boolean read of it would always be `true` — which is not an answer.
    if (settings.argv().includes("--list")) {
      throw new Error(
        "KubectlTasks.canI: .list() prints every allowed action and always " +
          "succeeds, so there is no yes/no to read — name the action with " +
          ".verb(...), or use KubectlTasks.authCanI to get the listing.",
      );
    }
    // can-i answers through the exit status: 0 allowed, non-zero not. --quiet
    // keeps its "yes"/"no" off the build's output.
    const out = await settings.quietAnswer().noThrow().quiet().run();
    return answerFromExitCode("canI", out, 1);
  },
  kustomize(
    configure?: Configure<KubectlKustomizeSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KubectlKustomizeSettings(), configure);
  },
  cordon(configure?: Configure<KubectlCordonSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlCordonSettings(), configure);
  },
  drain(configure?: Configure<KubectlDrainSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlDrainSettings(), configure);
  },
  taint(configure?: Configure<KubectlTaintSettings>): Promise<CommandOutput> {
    return runSettings(new KubectlTaintSettings(), configure);
  },
};
