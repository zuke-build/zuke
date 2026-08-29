// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that read and edit resources in place: `get`,
 * `describe`, `annotate`, `label`, and `patch`.
 *
 * @module
 */

import { KubectlSettings } from "./settings.ts";

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

  /** Assemble the `kubectl get` argv. */
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

  /** Assemble the `kubectl describe` argv. */
  protected override buildArgs(): string[] {
    // kubectl describe needs a resource type even with a selector; a bare
    // `describe -l ...` is rejected ("You must specify the type of resource").
    if (this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.describe: specify a resource type with .resource(...).",
      );
    }
    const argv = ["describe", ...this.globalArgs(), ...this.#resources];
    if (this.#selector !== undefined) argv.push("-l", this.#selector);
    return argv;
  }
}

/**
 * Whether the resource tokens name a specific resource: a `type/name` token, or
 * a non-flag positional after the type (a bare NAME). An inline `-l`/`--all`
 * token (which starts with `-`) is not a name.
 */
function hasResourceName(resources: readonly string[]): boolean {
  if (resources.length === 0) return false;
  return resources[0].includes("/") ||
    (resources.length >= 2 && !resources[1].startsWith("-"));
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

  /** Assemble the `kubectl annotate` argv. */
  protected override buildArgs(): string[] {
    // kubectl annotate always needs a resource type; `.all()`/`.selector()`
    // are modifiers on top of it, not substitutes for it.
    if (this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.annotate: a resource type is required — .resource(...).",
      );
    }
    if (this.#annotations.length === 0 && this.#removals.length === 0) {
      throw new Error(
        "KubectlTasks.annotate: at least one .annotation() or .remove() is required.",
      );
    }
    const hasName = hasResourceName(this.#resources);
    const hasSelector = this.#selector !== undefined;
    if (!hasName && !this.#all && !hasSelector && this.#resources.length < 2) {
      throw new Error(
        "KubectlTasks.annotate: a resource name, .selector(), or .all() is " +
          "required alongside the type — kubectl rejects a bare type like " +
          "`annotate pods key=val`.",
      );
    }
    // kubectl rejects a label selector combined with a name or with --all
    // ("name cannot be provided when a selector is specified" / "cannot set
    // --all and --selector"). A name + --all is accepted by kubectl (it ignores
    // --all), so it is not rejected here.
    if (hasSelector && (hasName || this.#all)) {
      throw new Error(
        "KubectlTasks.annotate: .selector() is mutually exclusive with a " +
          "resource name and with .all() — kubectl rejects `-l` with either.",
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

  /** Assemble the `kubectl label` argv. */
  protected override buildArgs(): string[] {
    // kubectl label always needs a resource type; `.all()`/`.selector()` are
    // modifiers on top of it, not substitutes for it.
    if (this.#resources.length === 0) {
      throw new Error(
        "KubectlTasks.label: a resource type is required — .resource(...).",
      );
    }
    if (this.#labels.length === 0 && this.#removals.length === 0) {
      throw new Error(
        "KubectlTasks.label: at least one .label() or .remove() is required.",
      );
    }
    const hasName = hasResourceName(this.#resources);
    const hasSelector = this.#selector !== undefined;
    if (!hasName && !this.#all && !hasSelector && this.#resources.length < 2) {
      throw new Error(
        "KubectlTasks.label: a resource name, .selector(), or .all() is " +
          "required alongside the type — kubectl rejects a bare type like " +
          "`label pods key=val`.",
      );
    }
    // kubectl rejects a label selector combined with a name or with --all
    // ("name cannot be provided when a selector is specified" / "cannot set
    // --all and --selector"). A name + --all is accepted by kubectl (it ignores
    // --all), so it is not rejected here.
    if (hasSelector && (hasName || this.#all)) {
      throw new Error(
        "KubectlTasks.label: .selector() is mutually exclusive with a resource " +
          "name and with .all() — kubectl rejects `-l` with either.",
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

  /** Assemble the `kubectl patch` argv. */
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
