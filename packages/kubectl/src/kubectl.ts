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
 * `--context`, and `--kubeconfig` (from the {@link KubectlSettings} base).
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/**
 * Base for all `kubectl` subcommand settings: the binary is `kubectl`, and the
 * cluster-targeting flags (`--namespace`, `--context`, `--kubeconfig`) are
 * shared by every subcommand.
 */
abstract class KubectlSettings extends ToolSettings {
  #namespace?: string;
  #context?: string;
  #kubeconfig?: string;

  protected override defaultTool(): string {
    return "kubectl";
  }

  /** Target a namespace (`--namespace`). */
  namespace(name: string): this {
    this.#namespace = name;
    return this;
  }

  /** Use a named kubeconfig context (`--context`). */
  context(name: string): this {
    this.#context = name;
    return this;
  }

  /** Use an explicit kubeconfig file (`--kubeconfig`). */
  kubeconfig(path: PathLike): this {
    this.#kubeconfig = String(path);
    return this;
  }

  /** The cluster-targeting flags shared by every subcommand. */
  protected globalArgs(): string[] {
    const argv: string[] = [];
    if (this.#namespace !== undefined) {
      argv.push("--namespace", this.#namespace);
    }
    if (this.#context !== undefined) argv.push("--context", this.#context);
    if (this.#kubeconfig !== undefined) {
      argv.push("--kubeconfig", this.#kubeconfig);
    }
    return argv;
  }
}

/** The `--dry-run` strategies kubectl accepts. */
export type DryRunMode = "none" | "client" | "server";

/** Settings for `kubectl apply`. */
export class KubectlApplySettings extends KubectlSettings {
  #files: string[] = [];
  #kustomize?: string;
  #recursive = false;
  #prune = false;
  #serverSide = false;
  #dryRun?: DryRunMode;
  #selector?: string;
  #force = false;

  /** Apply a manifest file, directory, or URL (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Apply a kustomization directory (`-k`). */
  kustomize(dir: PathLike): this {
    this.#kustomize = String(dir);
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Prune resources not present in the applied set (`--prune`). */
  prune(): this {
    this.#prune = true;
    return this;
  }

  /** Apply server-side (`--server-side`). */
  serverSide(): this {
    this.#serverSide = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Force apply by delete-and-recreate when needed (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#kustomize === undefined) {
      throw new Error(
        "KubectlTasks.apply: .file() or .kustomize() is required.",
      );
    }
    const argv = ["apply", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#kustomize !== undefined) argv.push("-k", this.#kustomize);
    if (this.#recursive) argv.push("-R");
    if (this.#prune) argv.push("--prune");
    if (this.#serverSide) argv.push("--server-side");
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#force) argv.push("--force");
    return argv;
  }
}

/** Settings for `kubectl create`. */
export class KubectlCreateSettings extends KubectlSettings {
  #files: string[] = [];
  #recursive = false;
  #dryRun?: DryRunMode;
  #output?: string;
  #saveConfig = false;

  /**
   * Create from a manifest file, directory, or URL (`-f`); repeatable. For
   * resource-form creation (`create secret …`), use the base `.args(...)`.
   */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Output format, e.g. `yaml` or `json` (`-o`). */
  output(format: string): this {
    this.#output = format;
    return this;
  }

  /** Record the current resource in its annotation (`--save-config`). */
  saveConfig(): this {
    this.#saveConfig = true;
    return this;
  }

  protected override buildArgs(): string[] {
    const argv = ["create", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#recursive) argv.push("-R");
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    if (this.#output !== undefined) argv.push("-o", this.#output);
    if (this.#saveConfig) argv.push("--save-config");
    return argv;
  }
}

/** Settings for `kubectl delete`. */
export class KubectlDeleteSettings extends KubectlSettings {
  #files: string[] = [];
  #resources: string[] = [];
  #selector?: string;
  #all = false;
  #ignoreNotFound = false;
  #force = false;
  #gracePeriod?: number;
  #recursive = false;

  /** Delete from a manifest file or directory (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Resource tokens, e.g. `("pod", "web")` or `("deployment/api")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Delete all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Treat "not found" as a success (`--ignore-not-found`). */
  ignoreNotFound(): this {
    this.#ignoreNotFound = true;
    return this;
  }

  /** Force immediate deletion (`--force`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Seconds to wait before forceful termination (`--grace-period`). */
  gracePeriod(seconds: number): this {
    this.#gracePeriod = seconds;
    return this;
  }

  /** Recurse into directories given to `-f` (`-R`). */
  recursive(): this {
    this.#recursive = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.delete: specify .file() or .resource(...).",
      );
    }
    const argv = ["delete", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    argv.push(...this.#resources);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    if (this.#ignoreNotFound) argv.push("--ignore-not-found");
    if (this.#force) argv.push("--force");
    if (this.#gracePeriod !== undefined) {
      argv.push(`--grace-period=${this.#gracePeriod}`);
    }
    if (this.#recursive) argv.push("-R");
    return argv;
  }
}

/** Settings for `kubectl get`. */
export class KubectlGetSettings extends KubectlSettings {
  #resources: string[] = [];
  #output?: string;
  #selector?: string;
  #fieldSelector?: string;
  #allNamespaces = false;
  #watch = false;
  #showLabels = false;

  /** Resource tokens, e.g. `("pods")` or `("pod", "web")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Output format, e.g. `wide`, `yaml`, `json`, `jsonpath=…` (`-o`). */
  output(format: string): this {
    this.#output = format;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Restrict by field selector (`--field-selector`). */
  fieldSelector(query: string): this {
    this.#fieldSelector = query;
    return this;
  }

  /** List across all namespaces (`-A`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  /** Watch for changes instead of returning once (`-w`); pass `false` to disable. */
  watch(on = true): this {
    this.#watch = on;
    return this;
  }

  /** Include resource labels as columns (`--show-labels`). */
  showLabels(): this {
    this.#showLabels = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.get: specify a resource type with .resource(...).",
      );
    }
    const argv = ["get", ...this.globalArgs(), ...this.#resources];
    if (this.#output !== undefined) argv.push("-o", this.#output);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#fieldSelector !== undefined) {
      argv.push(`--field-selector=${this.#fieldSelector}`);
    }
    if (this.#allNamespaces) argv.push("-A");
    if (this.#watch) argv.push("-w");
    if (this.#showLabels) argv.push("--show-labels");
    return argv;
  }
}

/** Settings for `kubectl describe`. */
export class KubectlDescribeSettings extends KubectlSettings {
  #resources: string[] = [];
  #selector?: string;

  /** Resource tokens, e.g. `("pod", "web")` or `("deployment/api")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resources.length === 0 && this.#selector === undefined) {
      throw new Error(
        "KubectlTasks.describe: specify .resource(...) or .selector().",
      );
    }
    const argv = ["describe", ...this.globalArgs(), ...this.#resources];
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    return argv;
  }
}

/** Settings for `kubectl logs`. */
export class KubectlLogsSettings extends KubectlSettings {
  #resource?: string;
  #container?: string;
  #selector?: string;
  #follow = false;
  #previous = false;
  #tail?: number;
  #since?: string;
  #allContainers = false;
  #timestamps = false;

  /** The pod (or `type/name`) to read logs from. */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Read from a specific container (`-c`). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Select pods by label instead of naming one (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Stream new log output (`-f`). */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** Read the previous container instance's logs (`--previous`). */
  previous(): this {
    this.#previous = true;
    return this;
  }

  /** Show only the last N lines (`--tail`). */
  tail(lines: number): this {
    this.#tail = lines;
    return this;
  }

  /** Only logs newer than a duration, e.g. `5m` (`--since`). */
  since(duration: string): this {
    this.#since = duration;
    return this;
  }

  /** Include all containers in the pod (`--all-containers`). */
  allContainers(): this {
    this.#allContainers = true;
    return this;
  }

  /** Prefix each line with a timestamp (`--timestamps`). */
  timestamps(): this {
    this.#timestamps = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resource === undefined && this.#selector === undefined) {
      throw new Error("KubectlTasks.logs: specify .resource() or .selector().");
    }
    const argv = ["logs", ...this.globalArgs()];
    if (this.#resource !== undefined) argv.push(this.#resource);
    if (this.#container !== undefined) argv.push("-c", this.#container);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#follow) argv.push("-f");
    if (this.#previous) argv.push("--previous");
    if (this.#tail !== undefined) argv.push(`--tail=${this.#tail}`);
    if (this.#since !== undefined) argv.push(`--since=${this.#since}`);
    if (this.#allContainers) argv.push("--all-containers");
    if (this.#timestamps) argv.push("--timestamps");
    return argv;
  }
}

/** Settings for `kubectl exec`. */
export class KubectlExecSettings extends KubectlSettings {
  #resource?: string;
  #container?: string;
  #stdin = false;
  #tty = false;
  #command: string[] = [];

  /** The pod (or `type/name`) to exec into (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Target a specific container (`-c`). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Keep STDIN open (`-i`). */
  stdin(): this {
    this.#stdin = true;
    return this;
  }

  /** Allocate a TTY (`-t`). */
  tty(): this {
    this.#tty = true;
    return this;
  }

  /** The command and arguments to run in the container (required). */
  command(...args: Array<string | number>): this {
    this.#command.push(...args.map(String));
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.exec: .resource() is required.");
    }
    if (this.#command.length === 0) {
      throw new Error("KubectlTasks.exec: .command(...) is required.");
    }
    const argv = ["exec", ...this.globalArgs()];
    if (this.#stdin) argv.push("-i");
    if (this.#tty) argv.push("-t");
    if (this.#container !== undefined) argv.push("-c", this.#container);
    argv.push(this.#resource, "--", ...this.#command);
    return argv;
  }
}

/** A rollout sub-action: `kubectl rollout <action>`. */
export type RolloutAction = "status" | "restart" | "undo" | "history";

/** Settings for `kubectl rollout`. */
export class KubectlRolloutSettings extends KubectlSettings {
  #action?: RolloutAction;
  #resource?: string;
  #toRevision?: number;
  #timeout?: string;

  /** Show rollout status (`rollout status`). */
  status(): this {
    this.#action = "status";
    return this;
  }

  /** Restart a rollout (`rollout restart`). */
  restart(): this {
    this.#action = "restart";
    return this;
  }

  /** Roll back to the previous revision (`rollout undo`). */
  undo(): this {
    this.#action = "undo";
    return this;
  }

  /** Show rollout history (`rollout history`). */
  history(): this {
    this.#action = "history";
    return this;
  }

  /** The resource, e.g. `deployment/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** With `undo`, the revision to roll back to (`--to-revision`). */
  toRevision(revision: number): this {
    this.#toRevision = revision;
    return this;
  }

  /** With `status`, how long to wait, e.g. `60s` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#action === undefined) {
      throw new Error(
        "KubectlTasks.rollout: choose .status(), .restart(), .undo(), or .history().",
      );
    }
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.rollout: .resource() is required.");
    }
    const argv = [
      "rollout",
      this.#action,
      ...this.globalArgs(),
      this.#resource,
    ];
    if (this.#toRevision !== undefined) {
      argv.push(`--to-revision=${this.#toRevision}`);
    }
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    return argv;
  }
}

/** Settings for `kubectl scale`. */
export class KubectlScaleSettings extends KubectlSettings {
  #replicas?: number;
  #resource?: string;
  #file?: string;
  #currentReplicas?: number;
  #selector?: string;
  #all = false;

  /** Desired replica count (`--replicas`, required). */
  replicas(count: number): this {
    this.#replicas = count;
    return this;
  }

  /** The resource to scale, e.g. `deployment/api`. */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Scale a resource defined in a file (`-f`). */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /** Only scale if the current replica count matches (`--current-replicas`). */
  currentReplicas(count: number): this {
    this.#currentReplicas = count;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Scale all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#replicas === undefined) {
      throw new Error("KubectlTasks.scale: .replicas() is required.");
    }
    if (this.#resource === undefined && this.#file === undefined) {
      throw new Error("KubectlTasks.scale: specify .resource() or .file().");
    }
    const argv = [
      "scale",
      ...this.globalArgs(),
      `--replicas=${this.#replicas}`,
    ];
    if (this.#currentReplicas !== undefined) {
      argv.push(`--current-replicas=${this.#currentReplicas}`);
    }
    if (this.#file !== undefined) argv.push("-f", this.#file);
    if (this.#resource !== undefined) argv.push(this.#resource);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `kubectl set image`. */
export class KubectlSetImageSettings extends KubectlSettings {
  #resource?: string;
  #images: string[] = [];
  #selector?: string;
  #all = false;

  /** The resource to update, e.g. `deployment/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** Set a container's image (`container=image`); repeatable, at least one. */
  image(container: string, reference: string): this {
    this.#images.push(`${container}=${reference}`);
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Apply to all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.setImage: .resource() is required.");
    }
    if (this.#images.length === 0) {
      throw new Error(
        "KubectlTasks.setImage: at least one .image() is required.",
      );
    }
    const argv = ["set", "image", ...this.globalArgs(), this.#resource];
    argv.push(...this.#images);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `kubectl annotate`. */
export class KubectlAnnotateSettings extends KubectlSettings {
  #resources: string[] = [];
  #annotations: string[] = [];
  #removals: string[] = [];
  #overwrite = false;
  #all = false;
  #selector?: string;

  /** Resource tokens, e.g. `("deploy", "api")` or `("pods", "-l", "app=web")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Set an annotation as a `key=value` token; repeatable. */
  annotation(key: string, value: string): this {
    this.#annotations.push(`${key}=${value}`);
    return this;
  }

  /** Remove an annotation, rendered as kubectl's `key-` syntax; repeatable. */
  remove(key: string): this {
    this.#removals.push(`${key}-`);
    return this;
  }

  /** Overwrite existing annotations (`--overwrite`). */
  overwrite(): this {
    this.#overwrite = true;
    return this;
  }

  /** Apply to all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  protected override buildArgs(): string[] {
    if (
      this.#resources.length === 0 && this.#selector === undefined &&
      !this.#all
    ) {
      throw new Error(
        "KubectlTasks.annotate: a target is required — .resource(...), .selector(), or .all().",
      );
    }
    if (this.#annotations.length === 0 && this.#removals.length === 0) {
      throw new Error(
        "KubectlTasks.annotate: at least one .annotation() or .remove() is required.",
      );
    }
    const argv = [
      "annotate",
      ...this.#resources,
      ...this.#annotations,
      ...this.#removals,
    ];
    if (this.#overwrite) argv.push("--overwrite");
    if (this.#all) argv.push("--all");
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    argv.push(...this.globalArgs());
    return argv;
  }
}

/** Settings for `kubectl label`. */
export class KubectlLabelSettings extends KubectlSettings {
  #resources: string[] = [];
  #labels: string[] = [];
  #removals: string[] = [];
  #overwrite = false;
  #all = false;
  #selector?: string;

  /** Resource tokens, e.g. `("deploy", "api")` or `("pods", "-l", "app=web")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** Set a label as a `key=value` token; repeatable. */
  label(key: string, value: string): this {
    this.#labels.push(`${key}=${value}`);
    return this;
  }

  /** Remove a label, rendered as kubectl's `key-` syntax; repeatable. */
  remove(key: string): this {
    this.#removals.push(`${key}-`);
    return this;
  }

  /** Overwrite existing labels (`--overwrite`). */
  overwrite(): this {
    this.#overwrite = true;
    return this;
  }

  /** Apply to all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  protected override buildArgs(): string[] {
    if (
      this.#resources.length === 0 && this.#selector === undefined &&
      !this.#all
    ) {
      throw new Error(
        "KubectlTasks.label: a target is required — .resource(...), .selector(), or .all().",
      );
    }
    if (this.#labels.length === 0 && this.#removals.length === 0) {
      throw new Error(
        "KubectlTasks.label: at least one .label() or .remove() is required.",
      );
    }
    const argv = [
      "label",
      ...this.#resources,
      ...this.#labels,
      ...this.#removals,
    ];
    if (this.#overwrite) argv.push("--overwrite");
    if (this.#all) argv.push("--all");
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    argv.push(...this.globalArgs());
    return argv;
  }
}

/** A patch strategy accepted by `kubectl patch --type`. */
export type PatchType = "strategic" | "merge" | "json";

/** Settings for `kubectl patch`. */
export class KubectlPatchSettings extends KubectlSettings {
  #resource?: string;
  #patch?: string;
  #type?: PatchType;

  /** The resource to patch, e.g. `deployment/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** The patch document (`-p`, required). */
  patch(content: string): this {
    this.#patch = content;
    return this;
  }

  /** The patch strategy (`--type`). */
  type(strategy: PatchType): this {
    this.#type = strategy;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.patch: .resource() is required.");
    }
    if (this.#patch === undefined) {
      throw new Error("KubectlTasks.patch: .patch() is required.");
    }
    const argv = ["patch", ...this.globalArgs(), this.#resource];
    if (this.#type !== undefined) argv.push("--type", this.#type);
    argv.push("-p", this.#patch);
    return argv;
  }
}

/** Settings for `kubectl port-forward`. */
export class KubectlPortForwardSettings extends KubectlSettings {
  #resource?: string;
  #ports: string[] = [];
  #address?: string;

  /** The pod or service, e.g. `svc/api` (required). */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** A port mapping, e.g. `8080:80` or `8080`; repeatable, at least one. */
  port(mapping: string): this {
    this.#ports.push(mapping);
    return this;
  }

  /** The local address(es) to bind (`--address`). */
  address(value: string): this {
    this.#address = value;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.portForward: .resource() is required.");
    }
    if (this.#ports.length === 0) {
      throw new Error(
        "KubectlTasks.portForward: at least one .port() is required.",
      );
    }
    const argv = ["port-forward", ...this.globalArgs()];
    if (this.#address !== undefined) argv.push("--address", this.#address);
    argv.push(this.#resource, ...this.#ports);
    return argv;
  }
}

/** Settings for `kubectl wait`. */
export class KubectlWaitSettings extends KubectlSettings {
  #files: string[] = [];
  #resources: string[] = [];
  #forCondition?: string;
  #timeout?: string;
  #selector?: string;
  #all = false;

  /** Wait on resources defined in a file (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Resource tokens, e.g. `("pod/web")` or `("pods")`; repeatable. */
  resource(...tokens: string[]): this {
    this.#resources.push(...tokens);
    return this;
  }

  /** The condition to wait for, e.g. `condition=Available` or `delete`. */
  forCondition(condition: string): this {
    this.#forCondition = condition;
    return this;
  }

  /** How long to wait, e.g. `60s` (`--timeout`). */
  timeout(duration: string): this {
    this.#timeout = duration;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Wait on all resources of the given type (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#files.length === 0 && this.#resources.length === 0) {
      throw new Error("KubectlTasks.wait: specify .file() or .resource(...).");
    }
    if (this.#forCondition === undefined) {
      throw new Error("KubectlTasks.wait: .forCondition() is required.");
    }
    const argv = ["wait", ...this.globalArgs()];
    for (const f of this.#files) argv.push("-f", f);
    argv.push(...this.#resources);
    argv.push(`--for=${this.#forCondition}`);
    if (this.#timeout !== undefined) argv.push(`--timeout=${this.#timeout}`);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#all) argv.push("--all");
    return argv;
  }
}

/** Settings for `kubectl top`. */
export class KubectlTopSettings extends KubectlSettings {
  #kind?: "pods" | "nodes";
  #name?: string;
  #selector?: string;
  #containers = false;
  #allNamespaces = false;

  /** Report pod usage (`top pods`). */
  pods(): this {
    this.#kind = "pods";
    return this;
  }

  /** Report node usage (`top nodes`). */
  nodes(): this {
    this.#kind = "nodes";
    return this;
  }

  /** Limit to a single named pod or node. */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Break pod usage down by container (`--containers`). */
  containers(): this {
    this.#containers = true;
    return this;
  }

  /** Report across all namespaces (`-A`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  protected override buildArgs(): string[] {
    if (this.#kind === undefined) {
      throw new Error("KubectlTasks.top: choose .pods() or .nodes().");
    }
    const argv = ["top", this.#kind, ...this.globalArgs()];
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#containers) argv.push("--containers");
    if (this.#allNamespaces) argv.push("-A");
    return argv;
  }
}

/**
 * A Kubernetes namespace, parsed from `kubectl get namespaces -o json` — the
 * typed result of {@link KubectlTasksApi.getNamespaces}.
 */
export interface KubernetesNamespace {
  /** The namespace name (`metadata.name`). */
  name: string;
  /**
   * The lifecycle phase (`status.phase`), e.g. `"Active"` or `"Terminating"`;
   * `""` when the field is absent.
   */
  status: string;
  /** The namespace labels (`metadata.labels`), string-valued; `{}` when none. */
  labels: Record<string, string>;
  /** When the namespace was created (`metadata.creationTimestamp`), if present. */
  createdAt?: string;
}

/** Narrow an unknown value to a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow a value to a `Record<string, string>`, dropping non-string entries. */
function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string") out[key] = v;
    }
  }
  return out;
}

/** Narrow one `kubectl get` item into a {@link KubernetesNamespace}, or `null`. */
function parseNamespace(item: unknown): KubernetesNamespace | null {
  if (!isRecord(item)) return null;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const name = typeof metadata.name === "string" ? metadata.name : undefined;
  if (name === undefined) return null;
  const status = isRecord(item.status) && typeof item.status.phase === "string"
    ? item.status.phase
    : "";
  const createdAt = typeof metadata.creationTimestamp === "string"
    ? metadata.creationTimestamp
    : undefined;
  return { name, status, labels: stringMap(metadata.labels), createdAt };
}

/**
 * Parse the JSON text of `kubectl get namespaces -o json` — a `List`, or a
 * single namespace object — into {@link KubernetesNamespace} records. Items
 * without a `metadata.name` are skipped; empty input yields `[]`. Throws if the
 * text is non-empty and not valid JSON.
 */
export function parseNamespaces(json: string): KubernetesNamespace[] {
  const text = json.trim();
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  const items = isRecord(parsed) && Array.isArray(parsed.items)
    ? parsed.items
    : [parsed];
  const namespaces: KubernetesNamespace[] = [];
  for (const item of items) {
    const namespace = parseNamespace(item);
    if (namespace !== null) namespaces.push(namespace);
  }
  return namespaces;
}

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
