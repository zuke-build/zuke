// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that drive a workload: `rollout`, `scale`, the
 * `set` group, `run`, and `expose`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { type DryRunMode, KubectlSettings } from "./settings.ts";

/** A rollout sub-action: `kubectl rollout <action>`. */
export type RolloutAction =
  | "status"
  | "restart"
  | "undo"
  | "history"
  | "pause"
  | "resume";

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

  /**
   * Stop the rollout where it is (`rollout pause`) — half of a canary. A
   * paused workload takes no further updates until {@link resume}.
   */
  pause(): this {
    this.#action = "pause";
    return this;
  }

  /** Let a paused rollout continue (`rollout resume`). */
  resume(): this {
    this.#action = "resume";
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

  /** Assemble the `kubectl rollout <action>` argv. */
  protected override buildArgs(): string[] {
    if (this.#action === undefined) {
      throw new Error(
        "KubectlTasks.rollout: choose .status(), .restart(), .undo(), .history(), " +
          ".pause(), or .resume().",
      );
    }
    if (this.#resource === undefined) {
      throw new Error("KubectlTasks.rollout: .resource() is required.");
    }
    if (this.#toRevision !== undefined && this.#action !== "undo") {
      throw new Error(
        "KubectlTasks.rollout: .toRevision(...) is what .undo() rolls back " +
          `to, and this is a ${this.#action} — drop one.`,
      );
    }
    if (this.#timeout !== undefined && this.#action !== "status") {
      throw new Error(
        "KubectlTasks.rollout: .timeout(...) is how long .status() waits, " +
          `and this is a ${this.#action} — drop one.`,
      );
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

  /** Assemble the `kubectl scale` argv. */
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

  /** Assemble the `kubectl set image` argv. */
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

/**
 * Base for the `kubectl set` subcommands that change a pod template in place:
 * they share the target (a resource, a manifest, or everything in the
 * namespace) and the container selection.
 */
export abstract class KubectlSetSettings extends KubectlSettings {
  #resources: string[] = [];
  #files: string[] = [];
  #all = false;
  #containers?: string;
  #selector?: string;
  #local = false;
  #dryRun?: DryRunMode;

  /** The resource to change, e.g. `deployment/api`; repeatable. */
  resource(...names: string[]): this {
    this.#resources.push(...names);
    return this;
  }

  /** Change the resource identified by a manifest instead (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** Change every resource of the named types in the namespace (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Which containers to change (`-c`); kubectl's default is every one. */
  containers(pattern: string): this {
    this.#containers = pattern;
    return this;
  }

  /** Restrict to resources matching a label selector (`-l`). */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Rewrite the local manifest without contacting the server (`--local`). */
  local(): this {
    this.#local = true;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** The `set` subcommand's own name, e.g. `env`. */
  protected abstract setSubcommand(): string;

  /** The task name a refusal names, e.g. `setEnv`. */
  protected abstract readonly taskName: string;

  /** The subcommand's own flags, rendered after the target. */
  protected abstract setFlags(): string[];

  /** The target flags, after refusing a target kubectl cannot resolve. */
  protected targetArgs(task: string): string[] {
    if (
      this.#resources.length === 0 && this.#files.length === 0 && !this.#all
    ) {
      throw new Error(
        `KubectlTasks.${task}: name what to change with .resource(...), ` +
          ".file(...), or .all().",
      );
    }
    if (this.#local && this.#files.length === 0) {
      throw new Error(
        `KubectlTasks.${task}: .local() rewrites a manifest without reaching ` +
          "the server, so it needs .file(...) — add it, or drop .local().",
      );
    }
    const argv: string[] = [...this.#resources];
    for (const f of this.#files) argv.push("-f", f);
    if (this.#all) argv.push("--all");
    if (this.#containers !== undefined) argv.push("-c", this.#containers);
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    if (this.#local) argv.push("--local");
    return argv;
  }

  /** Assemble the `kubectl set <subcommand>` argv. */
  protected override buildArgs(): string[] {
    const argv = [
      "set",
      this.setSubcommand(),
      ...this.globalArgs(),
      ...this.targetArgs(this.taskName),
      ...this.setFlags(),
    ];
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}

/** Settings for `kubectl set env`. */
export class KubectlSetEnvSettings extends KubectlSetSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "setEnv";
  #env: string[] = [];
  #from?: string;
  #keys: string[] = [];
  #prefix?: string;
  #list = false;
  #resolve = false;
  #overwrite?: boolean;

  /** Set a variable (`-e KEY=VALUE`); repeatable. */
  set(key: string, value: string): this {
    this.#env.push(`${key}=${value}`);
    return this;
  }

  /** Remove a variable, which kubectl spells `KEY-` (`-e KEY-`); repeatable. */
  remove(key: string): this {
    this.#env.push(`${key}-`);
    return this;
  }

  /** Inject every key of a ConfigMap or Secret (`--from`), e.g. `secret/db`. */
  from(reference: string): this {
    this.#from = reference;
    return this;
  }

  /** Only these keys of the {@link from} resource (`--keys`). */
  keys(...names: string[]): this {
    this.#keys.push(...names);
    return this;
  }

  /** Prefix the injected variable names (`--prefix`). */
  prefix(value: string): this {
    this.#prefix = value;
    return this;
  }

  /** Print the environment instead of changing it (`--list`). */
  list(): this {
    this.#list = true;
    return this;
  }

  /** Show what the references resolve to when listing (`--resolve`). */
  resolve(): this {
    this.#resolve = true;
    return this;
  }

  /** Whether an existing variable may be replaced (`--overwrite`). */
  overwrite(value = true): this {
    this.#overwrite = value;
    return this;
  }

  /** The `set` subcommand: `env`. */
  protected override setSubcommand(): string {
    return "env";
  }

  /** Assemble the `kubectl set env` flags. */
  protected override setFlags(): string[] {
    if (this.#env.length === 0 && this.#from === undefined && !this.#list) {
      throw new Error(
        "KubectlTasks.setEnv: name a variable with .set(...)/.remove(...), " +
          "inject one with .from(...), or ask to .list() them.",
      );
    }
    if (this.#keys.length > 0 && this.#from === undefined) {
      throw new Error(
        "KubectlTasks.setEnv: .keys(...) picks from the .from(...) resource " +
          "— add it, or drop the keys.",
      );
    }
    if (this.#resolve && !this.#list) {
      throw new Error(
        "KubectlTasks.setEnv: .resolve() shows what a listing's references " +
          "point at, so it needs .list() — add it, or drop .resolve().",
      );
    }
    const argv: string[] = [];
    for (const pair of this.#env) argv.push("-e", pair);
    if (this.#from !== undefined) argv.push(`--from=${this.#from}`);
    if (this.#keys.length > 0) argv.push(`--keys=${this.#keys.join(",")}`);
    if (this.#prefix !== undefined) argv.push(`--prefix=${this.#prefix}`);
    if (this.#overwrite !== undefined) {
      argv.push(`--overwrite=${this.#overwrite}`);
    }
    if (this.#list) argv.push("--list");
    if (this.#resolve) argv.push("--resolve");
    return argv;
  }
}

/** Settings for `kubectl set resources`. */
export class KubectlSetResourcesSettings extends KubectlSetSettings {
  /** The task this settings class backs. */
  protected override readonly taskName = "setResources";
  #limits: string[] = [];
  #requests: string[] = [];

  /** A resource limit, e.g. `.limit("cpu", "500m")`; repeatable. */
  limit(resource: string, quantity: string): this {
    this.#limits.push(`${resource}=${quantity}`);
    return this;
  }

  /** A resource request, e.g. `.request("memory", "256Mi")`; repeatable. */
  request(resource: string, quantity: string): this {
    this.#requests.push(`${resource}=${quantity}`);
    return this;
  }

  /** The `set` subcommand: `resources`. */
  protected override setSubcommand(): string {
    return "resources";
  }

  /** Assemble the `kubectl set resources` flags. */
  protected override setFlags(): string[] {
    if (this.#limits.length === 0 && this.#requests.length === 0) {
      throw new Error(
        "KubectlTasks.setResources: .limit(...) or .request(...) is required " +
          "— there is nothing to set otherwise.",
      );
    }
    const argv: string[] = [];
    if (this.#limits.length > 0) {
      argv.push(`--limits=${this.#limits.join(",")}`);
    }
    if (this.#requests.length > 0) {
      argv.push(`--requests=${this.#requests.join(",")}`);
    }
    return argv;
  }
}

/**
 * Settings for `kubectl run` — one pod, imperatively.
 *
 * This is for a one-off: a migration job, a debug shell. A workload a build
 * owns belongs in a manifest and goes through
 * {@link "./manifests.ts".KubectlApplySettings}, which is declarative and can
 * be diffed.
 */
export class KubectlRunSettings extends KubectlSettings {
  #name?: string;
  #image?: string;
  #restart?: "Always" | "OnFailure" | "Never";
  #env: string[] = [];
  #labels?: string;
  #port?: string;
  #overrides?: string;
  #expose = false;
  #command = false;
  #args: string[] = [];
  #dryRun?: DryRunMode;

  /** The pod's name (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The image to run (`--image`, required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** The restart policy (`--restart`). */
  restart(policy: "Always" | "OnFailure" | "Never"): this {
    this.#restart = policy;
    return this;
  }

  /**
   * An environment variable for the container (`--env KEY=VALUE`);
   * repeatable. Named apart from the inherited `.env(...)`, which sets the
   * environment `kubectl` itself runs in.
   */
  envVar(key: string, value: string): this {
    this.#env.push(`${key}=${value}`);
    return this;
  }

  /** Labels for the pod (`--labels`), comma-separated. */
  labels(value: string): this {
    this.#labels = value;
    return this;
  }

  /** The port the container exposes (`--port`). */
  port(value: string | number): this {
    this.#port = String(value);
    return this;
  }

  /** An inline JSON override for the generated pod (`--overrides`). */
  overrides(json: string): this {
    this.#overrides = json;
    return this;
  }

  /** Also create a ClusterIP service (`--expose`), which needs {@link port}. */
  expose(): this {
    this.#expose = true;
    return this;
  }

  /**
   * The command and arguments to run, after kubectl's `--` separator. Passing
   * any also sets `--command`, so they replace the image's entrypoint rather
   * than being appended to it.
   */
  command(first: string, ...rest: string[]): this {
    this.#command = true;
    this.#args.push(first, ...rest);
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl run` argv. */
  protected override buildArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error("KubectlTasks.run: .name(...) is required.");
    }
    if (this.#image === undefined) {
      throw new Error("KubectlTasks.run: .image(...) is required.");
    }
    if (this.#expose && this.#port === undefined) {
      throw new Error(
        "KubectlTasks.run: .expose() creates a service for a port, so it " +
          "needs .port(...) — add it, or drop .expose().",
      );
    }
    const argv = ["run", ...this.globalArgs(), this.#name];
    argv.push(`--image=${this.#image}`);
    if (this.#restart !== undefined) argv.push(`--restart=${this.#restart}`);
    for (const pair of this.#env) argv.push(`--env=${pair}`);
    if (this.#labels !== undefined) argv.push(`--labels=${this.#labels}`);
    if (this.#port !== undefined) argv.push(`--port=${this.#port}`);
    if (this.#expose) argv.push("--expose");
    if (this.#overrides !== undefined) {
      argv.push(`--overrides=${this.#overrides}`);
    }
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    if (this.#command) argv.push("--command", "--", ...this.#args);
    return argv;
  }
}

/** Settings for `kubectl expose` — a service in front of an existing workload. */
export class KubectlExposeSettings extends KubectlSettings {
  #resource?: string;
  #files: string[] = [];
  #port?: string;
  #targetPort?: string;
  #type?: string;
  #name?: string;
  #protocol?: string;
  #selector?: string;
  #labels?: string;
  #sessionAffinity?: string;
  #dryRun?: DryRunMode;

  /** The workload to expose, e.g. `deployment/api`. */
  resource(reference: string): this {
    this.#resource = reference;
    return this;
  }

  /** Expose the workload a manifest identifies instead (`-f`); repeatable. */
  file(path: PathLike): this {
    this.#files.push(String(path));
    return this;
  }

  /** The port the service serves on (`--port`). */
  port(value: string | number): this {
    this.#port = String(value);
    return this;
  }

  /** The container port traffic goes to (`--target-port`). */
  targetPort(value: string | number): this {
    this.#targetPort = String(value);
    return this;
  }

  /** The service type (`--type`), e.g. `LoadBalancer`. */
  type(value: string): this {
    this.#type = value;
    return this;
  }

  /** The new service's name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** The protocol (`--protocol`), e.g. `TCP`. */
  protocol(value: string): this {
    this.#protocol = value;
    return this;
  }

  /**
   * The selector the service routes by (`--selector`). kubectl infers it from
   * the exposed resource when it is omitted, and only equality-based
   * requirements are supported here.
   */
  selector(query: string): this {
    this.#selector = query;
    return this;
  }

  /** Labels for the created service (`--labels`), comma-separated. */
  labels(value: string): this {
    this.#labels = value;
    return this;
  }

  /** Session affinity (`--session-affinity`): `None` or `ClientIP`. */
  sessionAffinity(value: "None" | "ClientIP"): this {
    this.#sessionAffinity = value;
    return this;
  }

  /** Preview without persisting (`--dry-run=`; defaults to `client`). */
  dryRun(mode: DryRunMode = "client"): this {
    this.#dryRun = mode;
    return this;
  }

  /** Assemble the `kubectl expose` argv. */
  protected override buildArgs(): string[] {
    if (this.#resource === undefined && this.#files.length === 0) {
      throw new Error(
        "KubectlTasks.expose: name what to expose with .resource(...) or " +
          ".file(...).",
      );
    }
    if (this.#resource !== undefined && this.#files.length > 0) {
      throw new Error(
        "KubectlTasks.expose: .resource(...) and .file(...) are two ways to " +
          "name the same workload — pick one.",
      );
    }
    const argv = ["expose", ...this.globalArgs()];
    if (this.#resource !== undefined) argv.push(this.#resource);
    for (const f of this.#files) argv.push("-f", f);
    if (this.#port !== undefined) argv.push(`--port=${this.#port}`);
    if (this.#targetPort !== undefined) {
      argv.push(`--target-port=${this.#targetPort}`);
    }
    if (this.#type !== undefined) argv.push(`--type=${this.#type}`);
    if (this.#name !== undefined) argv.push(`--name=${this.#name}`);
    if (this.#protocol !== undefined) argv.push(`--protocol=${this.#protocol}`);
    // `-l` is --labels on expose, not --selector as it is elsewhere, so both
    // are spelled in full to keep them apart.
    if (this.#selector !== undefined) argv.push(`--selector=${this.#selector}`);
    if (this.#labels !== undefined) argv.push(`--labels=${this.#labels}`);
    if (this.#sessionAffinity !== undefined) {
      argv.push(`--session-affinity=${this.#sessionAffinity}`);
    }
    if (this.#dryRun !== undefined) argv.push(`--dry-run=${this.#dryRun}`);
    return argv;
  }
}
