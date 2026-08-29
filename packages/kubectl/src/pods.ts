// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `kubectl` commands that reach into a running pod: `logs`, `exec`, and
 * `port-forward`.
 *
 * @module
 */

import { KubectlSettings } from "./settings.ts";

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

  /** Assemble the `kubectl logs` argv. */
  protected override buildArgs(): string[] {
    if (this.#resource === undefined && this.#selector === undefined) {
      throw new Error("KubectlTasks.logs: specify .resource() or .selector().");
    }
    // kubectl logs takes a pod name OR a selector, never both.
    if (this.#resource !== undefined && this.#selector !== undefined) {
      throw new Error(
        "KubectlTasks.logs: .resource() and .selector() are mutually exclusive.",
      );
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

  /** Assemble the `kubectl exec` argv. */
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

  /** Assemble the `kubectl port-forward` argv. */
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
