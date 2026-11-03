// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A command wrapper of every shape the Python facade generator must read:
 * settings on core's base with its inherited setters, a kind-changing setter,
 * a literal union behind a type alias, a rest parameter, an optional one, a
 * union of keywords, a date, a setter of plain data, setters of a callback, a
 * signal and a host the facade must leave out, a protected member, and a task
 * object declared through an interface.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** What `widget` prints: its output format. */
export type WidgetFormat = "text" | "json";

/** Plain data a build hands `widget`: JSON carries it whole. */
export interface WidgetOptions {
  /** How many times to retry a flaky step. */
  retries: number;
  /** Whether to keep the build directory. */
  keep?: boolean;
}

/** What `widget` asks the machine: not data, so no facade carries it. */
export interface WidgetHost {
  /** Answer the current time. */
  now(): Date;
}

/** Settings for `widget build`. */
export class WidgetSettings extends ToolSettings {
  #name?: string;
  #level = 0;
  #verbose = false;
  #tags: string[] = [];
  #format?: WidgetFormat;
  #limit?: string | number;
  #strict = false;
  #since?: string;
  #options?: WidgetOptions;

  protected override defaultTool(): string {
    return "widget";
  }

  protected override buildArgs(): string[] {
    const argv = ["build"];
    if (this.#name !== undefined) argv.push(this.#name);
    if (this.#level > 0) argv.push(`--level=${this.#level}`);
    if (this.#verbose) argv.push("--verbose");
    for (const tag of this.#tags) argv.push("--tag", tag);
    if (this.#format !== undefined) argv.push(`--format=${this.#format}`);
    if (this.#limit !== undefined) argv.push(`--limit=${this.#limit}`);
    if (this.#strict) argv.push("--strict");
    if (this.#since !== undefined) argv.push(`--since=${this.#since}`);
    if (this.#options !== undefined) {
      argv.push(`--retries=${this.#options.retries}`);
    }
    return argv;
  }

  /** The widget to build (required). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** How much to say, 0 to 3 (`--level`). */
  level(n: number): this {
    this.#level = n;
    return this;
  }

  /** Say everything (`--verbose`). */
  verbose(): this {
    this.#verbose = true;
    return this;
  }

  /** Tags to attach (`--tag`); repeatable. */
  tags(...values: string[]): this {
    this.#tags.push(...values);
    return this;
  }

  /** The output format (`--format`). */
  format(kind: WidgetFormat): this {
    this.#format = kind;
    return this;
  }

  /** Stop after this long, a duration or milliseconds (`--limit`). */
  limit(value: string | number): this {
    this.#limit = value;
    return this;
  }

  /** Refuse a widget with warnings (`--strict`), on by default. */
  strict(on = true): this {
    this.#strict = on;
    return this;
  }

  /** Only changes after this time (`--since`), a date or its ISO string. */
  since(time: Date | string): this {
    this.#since = typeof time === "string" ? time : time.toISOString();
    return this;
  }

  /** The build's options, as plain data. */
  options(value: WidgetOptions): this {
    this.#options = value;
    return this;
  }

  /** Stop when the signal fires: no facade carries a signal. */
  signal(signal: AbortSignal): this {
    signal.throwIfAborted();
    return this;
  }

  /** The machine's clock, through a host: no facade carries one. */
  host(host: WidgetHost): this {
    this.#since = host.now().toISOString();
    return this;
  }

  /** A hook on each output line: not JSON, so no facade carries it. */
  onLine(callback: (line: string) => void): this {
    callback("");
    return this;
  }

  /** Inspect instead of build: the inspect settings carry what is set so far. */
  inspecting(): WidgetInspectSettings {
    return new WidgetInspectSettings().tags(...this.#tags);
  }

  /** Whether a name was set; a query, not a setter. */
  protected named(): boolean {
    return this.#name !== undefined;
  }
}

/** Settings for `widget inspect`. */
export class WidgetInspectSettings extends WidgetSettings {
  #fields: string[] = [];

  protected override buildArgs(): string[] {
    return ["inspect", ...this.#fields.flatMap((f) => ["--field", f])];
  }

  /** The fields to show (`--field`); all when none is named. */
  fields(...names: string[]): this {
    this.#fields.push(...names);
    return this;
  }
}

/** The shape of {@link WidgetTasks}. */
export interface WidgetTasksApi {
  /** Build a widget: `widget build`. */
  build(configure?: Configure<WidgetSettings>): Promise<CommandOutput>;
  /** Inspect a widget by name: `widget inspect <name>`; answers its report. */
  inspect(
    name: string,
    configure: Configure<WidgetInspectSettings>,
  ): Promise<string>;
  /** Remove a widget's build output: `widget clean`. */
  clean(configure?: Configure<WidgetSettings>): Promise<void>;
  /** Watch a widget, reporting each change: a callback no facade carries. */
  watch(onChange: (name: string) => void): Promise<void>;
}

/** Typed task functions for the widget CLI. */
export const WidgetTasks: WidgetTasksApi = {
  build(configure?: Configure<WidgetSettings>): Promise<CommandOutput> {
    return runSettings(new WidgetSettings(), configure);
  },
  async inspect(
    name: string,
    configure: Configure<WidgetInspectSettings>,
  ): Promise<string> {
    const output = await runSettings(
      new WidgetInspectSettings().name(name),
      configure,
    );
    return output.stdout;
  },
  async clean(configure?: Configure<WidgetSettings>): Promise<void> {
    await runSettings(new WidgetSettings(), configure);
  },
  watch(onChange: (name: string) => void): Promise<void> {
    onChange("widget");
    return Promise.resolve();
  },
};
