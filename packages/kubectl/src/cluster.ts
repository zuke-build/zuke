// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that ask about the cluster and the kubeconfig rather
 * than about the workloads in it: the `config` group, `version`,
 * `cluster-info`, `api-resources`, `api-versions`, `auth can-i`, and
 * `kustomize`.
 *
 * This is what a build targeting more than one cluster needs before anything
 * else: which context is current, switching to another, and checking a
 * permission before spending a rollout on it.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { KubectlSettings } from "./settings.ts";

/** Settings for `kubectl config current-context`. */
export class KubectlConfigCurrentContextSettings extends KubectlSettings {
  /** Assemble the `kubectl config current-context` argv. */
  protected override buildArgs(): string[] {
    return ["config", "current-context", ...this.globalArgs()];
  }
}

/** Settings for `kubectl config get-contexts`. */
export class KubectlConfigGetContextsSettings extends KubectlSettings {
  #namesOnly = false;
  #noHeaders = false;

  /** Print only the names (`-o name`), the one output format gh accepts here. */
  namesOnly(): this {
    this.#namesOnly = true;
    return this;
  }

  /** Leave the header row out (`--no-headers`). */
  noHeaders(): this {
    this.#noHeaders = true;
    return this;
  }

  /** Assemble the `kubectl config get-contexts` argv. */
  protected override buildArgs(): string[] {
    const argv = ["config", "get-contexts", ...this.globalArgs()];
    if (this.#namesOnly) argv.push("-o", "name");
    if (this.#noHeaders) argv.push("--no-headers");
    return argv;
  }
}

/** Settings for `kubectl config use-context`. */
export class KubectlConfigUseContextSettings extends KubectlSettings {
  #name?: string;

  /** The context to switch to (required). */
  contextName(name: string): this {
    this.#name = name;
    return this;
  }

  /** Assemble the `kubectl config use-context` argv. */
  protected override buildArgs(): string[] {
    if (this.#name === undefined) {
      throw new Error(
        "KubectlTasks.useContext: .contextName(...) is required — it names " +
          "the context to switch to. (.context(...) is the global flag that " +
          "picks a context for one command instead.)",
      );
    }
    return ["config", "use-context", ...this.globalArgs(), this.#name];
  }
}

/**
 * Settings for `kubectl config set-context`.
 *
 * Note that `set-context` has its own `--namespace`, which sets the namespace
 * recorded **in the context entry** rather than scoping one command. The
 * inherited `.namespace(...)` renders that same flag, which is what a caller
 * of this command wants.
 */
export class KubectlConfigSetContextSettings extends KubectlSettings {
  #name?: string;
  #current = false;
  #cluster?: string;
  #user?: string;

  /** The context to write (required unless {@link current} is set). */
  contextName(name: string): this {
    this.#name = name;
    return this;
  }

  /** Modify the current context rather than a named one (`--current`). */
  current(): this {
    this.#current = true;
    return this;
  }

  /** The cluster the context points at (`--cluster`). */
  cluster(name: string): this {
    this.#cluster = name;
    return this;
  }

  /** The user the context authenticates as (`--user`). */
  user(name: string): this {
    this.#user = name;
    return this;
  }

  /** Assemble the `kubectl config set-context` argv. */
  protected override buildArgs(): string[] {
    if (this.#name === undefined && !this.#current) {
      throw new Error(
        "KubectlTasks.setContext: name the context with .contextName(...), " +
          "or say .current() to modify the one in use.",
      );
    }
    if (this.#name !== undefined && this.#current) {
      throw new Error(
        "KubectlTasks.setContext: .contextName(...) names a context and " +
          ".current() means the one in use — pick one.",
      );
    }
    const argv = ["config", "set-context", ...this.globalArgs()];
    if (this.#current) argv.push("--current");
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#cluster !== undefined) argv.push(`--cluster=${this.#cluster}`);
    if (this.#user !== undefined) argv.push(`--user=${this.#user}`);
    return argv;
  }
}

/** Settings for `kubectl config view`. */
export class KubectlConfigViewSettings extends KubectlSettings {
  #minify = false;
  #flatten = false;
  #raw = false;
  #output?: string;

  /** Keep only what the current context uses (`--minify`). */
  minify(): this {
    this.#minify = true;
    return this;
  }

  /** Inline the referenced files, for a portable kubeconfig (`--flatten`). */
  flatten(): this {
    this.#flatten = true;
    return this;
  }

  /**
   * Print the credentials in the clear (`--raw`). kubectl redacts them by
   * default; anything this prints belongs in a `parameter().secret()`, not in
   * a build's log.
   */
  raw(): this {
    this.#raw = true;
    return this;
  }

  /** The output format (`-o`), e.g. `json`; kubectl's default is `yaml`. */
  output(format: string): this {
    this.#output = format;
    return this;
  }

  /** Assemble the `kubectl config view` argv. */
  protected override buildArgs(): string[] {
    const argv = ["config", "view", ...this.globalArgs()];
    if (this.#minify) argv.push("--minify");
    if (this.#flatten) argv.push("--flatten");
    if (this.#raw) argv.push("--raw");
    if (this.#output !== undefined) argv.push("-o", this.#output);
    return argv;
  }
}

/** Settings for `kubectl version`. */
export class KubectlVersionSettings extends KubectlSettings {
  #clientOnly = false;
  #output?: "json" | "yaml";

  /** Report the client's version without reaching a cluster (`--client`). */
  clientOnly(): this {
    this.#clientOnly = true;
    return this;
  }

  /** The output format (`-o`): `json` or `yaml`. */
  output(format: "json" | "yaml"): this {
    this.#output = format;
    return this;
  }

  /** Assemble the `kubectl version` argv. */
  protected override buildArgs(): string[] {
    const argv = ["version", ...this.globalArgs()];
    if (this.#clientOnly) argv.push("--client");
    if (this.#output !== undefined) argv.push("-o", this.#output);
    return argv;
  }
}

/** Settings for `kubectl cluster-info`. */
export class KubectlClusterInfoSettings extends KubectlSettings {
  /** Assemble the `kubectl cluster-info` argv. */
  protected override buildArgs(): string[] {
    return ["cluster-info", ...this.globalArgs()];
  }
}

/** Settings for `kubectl api-versions`. */
export class KubectlApiVersionsSettings extends KubectlSettings {
  /** Assemble the `kubectl api-versions` argv. */
  protected override buildArgs(): string[] {
    return ["api-versions", ...this.globalArgs()];
  }
}

/** Settings for `kubectl api-resources`. */
export class KubectlApiResourcesSettings extends KubectlSettings {
  #apiGroup?: string;
  #namespaced?: boolean;
  #verbs: string[] = [];
  #categories: string[] = [];
  #sortBy?: "name" | "kind";
  #output?: string;
  #noHeaders = false;
  #cached = false;

  /** Only resources in this API group (`--api-group`). */
  apiGroup(name: string): this {
    this.#apiGroup = name;
    return this;
  }

  /**
   * Whether to list namespaced resources (`--namespaced`); kubectl's default
   * is `true`, so pass `false` for the cluster-scoped ones.
   */
  namespaced(value = true): this {
    this.#namespaced = value;
    return this;
  }

  /** Only resources supporting these verbs (`--verbs`). */
  verbs(...names: string[]): this {
    this.#verbs.push(...names);
    return this;
  }

  /** Only resources in these categories (`--categories`). */
  categories(...names: string[]): this {
    this.#categories.push(...names);
    return this;
  }

  /** Sort by `name` or `kind` (`--sort-by`). */
  sortBy(field: "name" | "kind"): this {
    this.#sortBy = field;
    return this;
  }

  /** The output format (`-o`), e.g. `name` or `wide`. */
  output(format: string): this {
    this.#output = format;
    return this;
  }

  /** Leave the header row out (`--no-headers`). */
  noHeaders(): this {
    this.#noHeaders = true;
    return this;
  }

  /** Use the discovery cache rather than asking the server (`--cached`). */
  cached(): this {
    this.#cached = true;
    return this;
  }

  /** Assemble the `kubectl api-resources` argv. */
  protected override buildArgs(): string[] {
    const argv = ["api-resources", ...this.globalArgs()];
    if (this.#apiGroup !== undefined) {
      argv.push(`--api-group=${this.#apiGroup}`);
    }
    if (this.#namespaced !== undefined) {
      argv.push(`--namespaced=${this.#namespaced}`);
    }
    if (this.#verbs.length > 0) argv.push(`--verbs=${this.#verbs.join(",")}`);
    if (this.#categories.length > 0) {
      argv.push(`--categories=${this.#categories.join(",")}`);
    }
    if (this.#sortBy !== undefined) argv.push(`--sort-by=${this.#sortBy}`);
    if (this.#output !== undefined) argv.push("-o", this.#output);
    if (this.#noHeaders) argv.push("--no-headers");
    if (this.#cached) argv.push("--cached");
    return argv;
  }
}

/**
 * Settings for `kubectl auth can-i`.
 *
 * The command answers through its exit status — **0** when the action is
 * allowed and non-zero when it is not — so
 * {@link "./kubectl.ts".KubectlTasksApi.canI} reads the code into a boolean
 * rather than failing the build on a routine "no".
 */
export class KubectlAuthCanISettings extends KubectlSettings {
  #verb?: string;
  #resource?: string;
  #subresource?: string;
  #allNamespaces = false;
  #list = false;
  #quiet = false;

  /** The API verb to check, e.g. `create` (required unless {@link list}). */
  verb(name: string): this {
    this.#verb = name;
    return this;
  }

  /** The resource, e.g. `deployments` or `deployments/api`. */
  resource(name: string): this {
    this.#resource = name;
    return this;
  }

  /** A subresource, e.g. `log` or `scale` (`--subresource`). */
  subresource(name: string): this {
    this.#subresource = name;
    return this;
  }

  /** Check across every namespace (`--all-namespaces`). */
  allNamespaces(): this {
    this.#allNamespaces = true;
    return this;
  }

  /** Print every allowed action instead of checking one (`--list`). */
  list(): this {
    this.#list = true;
    return this;
  }

  /**
   * Print nothing and answer only through the exit code (kubectl's
   * `--quiet`). Named apart from the inherited `.quiet()`, which suppresses
   * Zuke's own echo of the command rather than kubectl's output.
   */
  quietAnswer(): this {
    this.#quiet = true;
    return this;
  }

  /** Assemble the `kubectl auth can-i` argv. */
  protected override buildArgs(): string[] {
    if (this.#list) {
      if (this.#verb !== undefined || this.#resource !== undefined) {
        throw new Error(
          "KubectlTasks.authCanI: .list() prints every allowed action, which " +
            "a .verb(...)/.resource(...) would narrow to nothing — drop one.",
        );
      }
      const listing = ["auth", "can-i", "--list", ...this.globalArgs()];
      if (this.#allNamespaces) listing.push("--all-namespaces");
      return listing;
    }
    if (this.#verb === undefined) {
      throw new Error(
        "KubectlTasks.authCanI: .verb(...) is required — it names the action " +
          'to check, e.g. .verb("create").',
      );
    }
    const argv = ["auth", "can-i", ...this.globalArgs(), this.#verb];
    if (this.#resource !== undefined) argv.push(this.#resource);
    if (this.#subresource !== undefined) {
      argv.push(`--subresource=${this.#subresource}`);
    }
    if (this.#allNamespaces) argv.push("--all-namespaces");
    if (this.#quiet) argv.push("--quiet");
    return argv;
  }
}

/** Settings for `kubectl kustomize` — rendering a kustomization to stdout. */
export class KubectlKustomizeSettings extends KubectlSettings {
  #dir?: string;
  #output?: string;
  #enableHelm = false;
  #loadRestrictor?: string;

  /** The kustomization directory or repository URL; kubectl assumes `.`. */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Write the rendered output to a file instead of stdout (`-o`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Allow the Helm chart inflator generator (`--enable-helm`). */
  enableHelm(): this {
    this.#enableHelm = true;
    return this;
  }

  /** Relax where a kustomization may load files from (`--load-restrictor`). */
  loadRestrictor(value: string): this {
    this.#loadRestrictor = value;
    return this;
  }

  /** Assemble the `kubectl kustomize` argv. */
  protected override buildArgs(): string[] {
    const argv = ["kustomize", ...this.globalArgs()];
    if (this.#dir !== undefined) argv.push(this.#dir);
    if (this.#output !== undefined) argv.push("-o", this.#output);
    if (this.#enableHelm) argv.push("--enable-helm");
    if (this.#loadRestrictor !== undefined) {
      argv.push(`--load-restrictor=${this.#loadRestrictor}`);
    }
    return argv;
  }
}
