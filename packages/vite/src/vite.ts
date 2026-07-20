/**
 * `ViteTasks` — typed task functions for the [Vite](https://vitejs.dev) CLI, in
 * the settings-lambda style: configure a fluent settings object in a lambda,
 * and the task function builds the command line and executes it.
 *
 * ```ts
 * import { ViteTasks } from "jsr:@zuke/vite";
 * await ViteTasks.build((s) => s.outDir("dist").mode("production"));
 * await ViteTasks.preview((s) => s.port(4173));
 * ```
 *
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
 * Base for all `vite` subcommand settings: the binary is `vite`, with the
 * `--config` and `--mode` options shared by every subcommand.
 */
export abstract class ViteSettings extends ToolSettings {
  #config?: string;
  #mode?: string;

  /** The default binary this wrapper invokes: `vite`. */
  protected override defaultTool(): string {
    return "vite";
  }

  /** Use an explicit config file (`--config`). */
  config(path: PathLike): this {
    this.#config = String(path);
    return this;
  }

  /** Set the mode, e.g. `production` or `development` (`--mode`). */
  mode(name: string): this {
    this.#mode = name;
    return this;
  }

  /** The shared option arguments. */
  protected baseArgs(): string[] {
    const argv: string[] = [];
    if (this.#config !== undefined) argv.push("--config", this.#config);
    if (this.#mode !== undefined) argv.push("--mode", this.#mode);
    return argv;
  }
}

/** Settings for `vite dev` (the development server). */
export class ViteDevSettings extends ViteSettings {
  #host?: string;
  #port?: number;
  #open = false;

  /** Bind to a host/IP (`--host`). */
  host(value: string): this {
    this.#host = value;
    return this;
  }

  /** Serve on a specific port (`--port`). */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** Open the app in the browser on start (`--open`). */
  open(): this {
    this.#open = true;
    return this;
  }

  /** Assemble the `vite dev` argv. */
  protected override buildArgs(): string[] {
    const argv = ["dev", ...this.baseArgs()];
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#open) argv.push("--open");
    return argv;
  }
}

/** Settings for `vite build`. */
export class ViteBuildSettings extends ViteSettings {
  #outDir?: string;
  #base?: string;
  #emptyOutDir = false;
  #sourcemap = false;
  #root?: string;

  /** Output directory (`--outDir`). */
  outDir(path: PathLike): this {
    this.#outDir = String(path);
    return this;
  }

  /** Public base path (`--base`). */
  base(path: string): this {
    this.#base = path;
    return this;
  }

  /** Empty the output directory before building (`--emptyOutDir`). */
  emptyOutDir(): this {
    this.#emptyOutDir = true;
    return this;
  }

  /** Emit source maps (`--sourcemap`). */
  sourcemap(): this {
    this.#sourcemap = true;
    return this;
  }

  /** The project root (positional). */
  root(path: PathLike): this {
    this.#root = String(path);
    return this;
  }

  /** Assemble the `vite build` argv. */
  protected override buildArgs(): string[] {
    const argv = ["build", ...this.baseArgs()];
    if (this.#base !== undefined) argv.push("--base", this.#base);
    if (this.#outDir !== undefined) argv.push("--outDir", this.#outDir);
    if (this.#emptyOutDir) argv.push("--emptyOutDir");
    if (this.#sourcemap) argv.push("--sourcemap");
    if (this.#root !== undefined) argv.push(this.#root);
    return argv;
  }
}

/** Settings for `vite preview` (serve a production build locally). */
export class VitePreviewSettings extends ViteSettings {
  #host?: string;
  #port?: number;
  #open = false;

  /** Bind to a host/IP (`--host`). */
  host(value: string): this {
    this.#host = value;
    return this;
  }

  /** Serve on a specific port (`--port`). */
  port(value: number): this {
    this.#port = value;
    return this;
  }

  /** Open the app in the browser on start (`--open`). */
  open(): this {
    this.#open = true;
    return this;
  }

  /** Assemble the `vite preview` argv. */
  protected override buildArgs(): string[] {
    const argv = ["preview", ...this.baseArgs()];
    if (this.#host !== undefined) argv.push("--host", this.#host);
    if (this.#port !== undefined) argv.push("--port", String(this.#port));
    if (this.#open) argv.push("--open");
    return argv;
  }
}

/** The shape of {@link ViteTasks}. */
export interface ViteTasksApi {
  /** Start the dev server: `vite dev`. */
  dev(configure?: Configure<ViteDevSettings>): Promise<CommandOutput>;
  /** Build for production: `vite build`. */
  build(configure?: Configure<ViteBuildSettings>): Promise<CommandOutput>;
  /** Preview a production build: `vite preview`. */
  preview(configure?: Configure<VitePreviewSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `vite` CLI. */
export const ViteTasks: ViteTasksApi = {
  dev(configure?: Configure<ViteDevSettings>): Promise<CommandOutput> {
    return runSettings(new ViteDevSettings(), configure);
  },
  build(configure?: Configure<ViteBuildSettings>): Promise<CommandOutput> {
    return runSettings(new ViteBuildSettings(), configure);
  },
  preview(configure?: Configure<VitePreviewSettings>): Promise<CommandOutput> {
    return runSettings(new VitePreviewSettings(), configure);
  },
};
