// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The commands that report on containers rather than change them:
 * `docker ps`, `logs`, `inspect`, `top`, `stats`, `port`, and `diff`.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.logs((s) => s.container("app").tail(100).since("10m"));
 * const running = await DockerTasks.psEntries();
 * ```
 *
 * {@link "./docker.ts".DockerTasks.psEntries} pins `--format '{{json .}}'`,
 * which emits one JSON object per line on every docker worth supporting —
 * unlike `--format json`, which is recent-only — so a target reads what is
 * running instead of parsing a column-aligned table.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";
import { DockerSettings } from "./settings.ts";
import { parseJsonLines, stringField } from "./json_lines.ts";

/** Settings for `docker ps`. */
export class DockerPsSettings extends DockerSettings {
  #all = false;
  #quiet = false;
  #filters: string[] = [];
  #format?: string;
  #latest = false;
  #noTrunc = false;
  #size = false;

  /** Show stopped containers too (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show container IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Filter the listing (`--filter`); repeatable. */
  filter(expression: string): this {
    this.#filters.push("--filter", expression);
    return this;
  }

  /**
   * Render each container through a Go template (`--format`), e.g.
   * `{{json .}}` for one JSON object per line.
   * {@link "./docker.ts".DockerTasks.psEntries} pins that form.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Show only the most recently created container (`-l`/`--latest`). */
  latest(): this {
    this.#latest = true;
    return this;
  }

  /** Print ids and commands in full (`--no-trunc`). */
  noTrunc(): this {
    this.#noTrunc = true;
    return this;
  }

  /** Include each container's disk usage (`-s`/`--size`). */
  size(): this {
    this.#size = true;
    return this;
  }

  /** Assemble the `docker ps` argv. */
  protected override subcommandArgs(): string[] {
    const argv = ["ps"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    if (this.#latest) argv.push("--latest");
    if (this.#noTrunc) argv.push("--no-trunc");
    if (this.#size) argv.push("--size");
    argv.push(...this.#filters);
    if (this.#format !== undefined) argv.push("--format", this.#format);
    return argv;
  }
}

/** One container of `docker ps --format '{{json .}}'`. */
export interface DockerContainerEntry {
  /** The container id, as docker abbreviates it in a listing. */
  id?: string;
  /** The image it was created from. */
  image?: string;
  /** Its names, comma-separated as docker reports them. */
  names?: string;
  /** The command it runs. */
  command?: string;
  /** A human description of its state, e.g. `Up 3 minutes`. */
  status?: string;
  /** The bare state, e.g. `running` or `exited`. */
  state?: string;
  /** The published ports, as docker formats them. */
  ports?: string;
}

/**
 * Parse `docker ps --format '{{json .}}'` into entries.
 *
 * Not part of the package's public surface — exported for its unit test.
 */
export function parseContainerEntries(
  stdout: string,
): DockerContainerEntry[] {
  return parseJsonLines(stdout).map((record) => {
    const entry: DockerContainerEntry = {};
    const id = stringField(record, "ID");
    const image = stringField(record, "Image");
    const names = stringField(record, "Names");
    const command = stringField(record, "Command");
    const status = stringField(record, "Status");
    const state = stringField(record, "State");
    const ports = stringField(record, "Ports");
    if (id !== undefined) entry.id = id;
    if (image !== undefined) entry.image = image;
    if (names !== undefined) entry.names = names;
    if (command !== undefined) entry.command = command;
    if (status !== undefined) entry.status = status;
    if (state !== undefined) entry.state = state;
    if (ports !== undefined) entry.ports = ports;
    return entry;
  });
}

/**
 * Run `docker ps --format '{{json .}}'` and parse it. Backs
 * {@link "./docker.ts".DockerTasks.psEntries}.
 */
export async function readContainerEntries(
  configure?: Configure<DockerPsSettings>,
): Promise<DockerContainerEntry[]> {
  const settings = new DockerPsSettings();
  const configured = configure ? configure(settings) : settings;
  const output = await configured.format("{{json .}}").run();
  return parseContainerEntries(output.stdout);
}

/** Settings for `docker logs`. */
export class DockerLogsSettings extends DockerSettings {
  #container?: string;
  #follow = false;
  #tail?: string;
  #since?: string;
  #until?: string;
  #timestamps = false;
  #details = false;

  /** The container whose logs to read (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /**
   * Keep streaming (`-f`/`--follow`). A target that follows logs never
   * returns on its own — pair it with `.killAfter(...)` from the tooling base,
   * or with a container that exits.
   */
  follow(): this {
    this.#follow = true;
    return this;
  }

  /** Show only the last N lines (`--tail`), or `all`. */
  tail(lines: number | "all"): this {
    this.#tail = String(lines);
    return this;
  }

  /** Only logs since this timestamp or relative time (`--since`), e.g. `10m`. */
  since(when: string): this {
    this.#since = when;
    return this;
  }

  /** Only logs before this timestamp or relative time (`--until`). */
  until(when: string): this {
    this.#until = when;
    return this;
  }

  /** Prefix each line with its timestamp (`-t`/`--timestamps`). */
  timestamps(): this {
    this.#timestamps = true;
    return this;
  }

  /** Include the extra attributes docker records (`--details`). */
  details(): this {
    this.#details = true;
    return this;
  }

  /** Assemble the `docker logs` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.logs: .container() is required.");
    }
    const argv = ["logs"];
    if (this.#follow) argv.push("--follow");
    if (this.#timestamps) argv.push("--timestamps");
    if (this.#details) argv.push("--details");
    if (this.#tail !== undefined) argv.push("--tail", this.#tail);
    if (this.#since !== undefined) argv.push("--since", this.#since);
    if (this.#until !== undefined) argv.push("--until", this.#until);
    argv.push(this.#container);
    return argv;
  }
}

/** Settings for `docker inspect`. */
export class DockerInspectSettings extends DockerSettings {
  #targets: string[] = [];
  #format?: string;
  #type?: string;
  #size = false;

  /** The objects to inspect — containers, images, volumes (required). */
  targets(...names: string[]): this {
    this.#targets.push(...names);
    return this;
  }

  /**
   * Render through a Go template (`--format`), e.g. `{{.State.Status}}` for
   * one field, or `{{json .}}` for the whole record as JSON.
   */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /** Only look for this kind of object (`--type`), e.g. `container`. */
  type(kind: string): this {
    this.#type = kind;
    return this;
  }

  /** Include the disk usage of a container (`-s`/`--size`). */
  size(): this {
    this.#size = true;
    return this;
  }

  /** Assemble the `docker inspect` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#targets.length === 0) {
      throw new Error(
        "DockerTasks.inspect: .targets(...) is required — it names what to " +
          "inspect.",
      );
    }
    const argv = ["inspect"];
    if (this.#type !== undefined) argv.push("--type", this.#type);
    if (this.#size) argv.push("--size");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#targets);
    return argv;
  }
}

/** Settings for `docker top`. */
export class DockerTopSettings extends DockerSettings {
  #container?: string;
  #psArgs: string[] = [];

  /** The container whose processes to list (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Arguments passed through to `ps` inside the container. */
  psArgs(...args: string[]): this {
    this.#psArgs.push(...args);
    return this;
  }

  /** Assemble the `docker top` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.top: .container() is required.");
    }
    return ["top", this.#container, ...this.#psArgs];
  }
}

/** Settings for `docker stats`. */
export class DockerStatsSettings extends DockerSettings {
  #containers: string[] = [];
  #all = false;
  #format?: string;

  /** Limit the report to these containers; omit for all running ones. */
  containers(...names: string[]): this {
    this.#containers.push(...names);
    return this;
  }

  /** Include stopped containers (`-a`/`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Render through a Go template (`--format`). */
  format(template: string): this {
    this.#format = template;
    return this;
  }

  /**
   * Assemble the `docker stats` argv. `--no-stream` is always set: without it
   * docker streams forever, and a build target that never returns is a hang,
   * not a measurement.
   */
  protected override subcommandArgs(): string[] {
    const argv = ["stats", "--no-stream"];
    if (this.#all) argv.push("--all");
    if (this.#format !== undefined) argv.push("--format", this.#format);
    argv.push(...this.#containers);
    return argv;
  }
}

/** Settings for `docker port`. */
export class DockerPortSettings extends DockerSettings {
  #container?: string;
  #port?: string;

  /** The container whose port mappings to show (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** A single private port to resolve, e.g. `8080/tcp`. */
  port(value: string | number): this {
    this.#port = String(value);
    return this;
  }

  /** Assemble the `docker port` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.port: .container() is required.");
    }
    const argv = ["port", this.#container];
    if (this.#port !== undefined) argv.push(this.#port);
    return argv;
  }
}

/** Settings for `docker diff`. */
export class DockerDiffSettings extends DockerSettings {
  #container?: string;

  /** The container whose filesystem changes to show (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Assemble the `docker diff` argv. */
  protected override subcommandArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.diff: .container() is required.");
    }
    return ["diff", this.#container];
  }
}
