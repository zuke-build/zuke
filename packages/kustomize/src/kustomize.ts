/**
 * `KustomizeTasks` — typed task functions for the
 * [Kustomize](https://kustomize.io) CLI, in the settings-lambda style:
 * configure a fluent settings object in a lambda, and the task function builds
 * the command line and executes it.
 *
 * ```ts
 * import { KustomizeTasks } from "jsr:@zuke/kustomize";
 * await KustomizeTasks.build((s) => s.dir("overlays/prod").output("out.yaml"));
 * await KustomizeTasks.editSetImage((s) => s.image("api", "api:1.4"));
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

/** Base for all `kustomize` subcommand settings: the binary is `kustomize`. */
export abstract class KustomizeSettings extends ToolSettings {
  /** The binary these settings invoke: `kustomize`. */
  protected override defaultTool(): string {
    return "kustomize";
  }
}

/** Settings for `kustomize build`. */
export class KustomizeBuildSettings extends KustomizeSettings {
  #dir?: string;
  #output?: string;
  #enableHelm = false;
  #loadRestrictor?: string;

  /** The kustomization directory to build (defaults to the current directory). */
  dir(path: PathLike): this {
    this.#dir = String(path);
    return this;
  }

  /** Write the rendered output to a file or directory (`--output`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Enable the Helm chart inflator (`--enable-helm`). */
  enableHelm(): this {
    this.#enableHelm = true;
    return this;
  }

  /** Set the file-load restrictor, e.g. `LoadRestrictionsNone` (`--load-restrictor`). */
  loadRestrictor(mode: string): this {
    this.#loadRestrictor = mode;
    return this;
  }

  /** Assemble the `kustomize build` argv. */
  protected override buildArgs(): string[] {
    const argv = ["build"];
    if (this.#dir !== undefined) argv.push(this.#dir);
    if (this.#output !== undefined) argv.push("--output", this.#output);
    if (this.#enableHelm) argv.push("--enable-helm");
    if (this.#loadRestrictor !== undefined) {
      argv.push("--load-restrictor", this.#loadRestrictor);
    }
    return argv;
  }
}

/** Settings for `kustomize edit set image`. */
export class KustomizeEditSetImageSettings extends KustomizeSettings {
  #images: string[] = [];

  /**
   * Set an image override, e.g. `("api", "api:1.4")` → `api=api:1.4`; repeatable,
   * at least one is required.
   */
  image(name: string, reference: string): this {
    this.#images.push(`${name}=${reference}`);
    return this;
  }

  /** Assemble the `kustomize edit set image` argv. */
  protected override buildArgs(): string[] {
    if (this.#images.length === 0) {
      throw new Error(
        "KustomizeTasks.editSetImage: at least one .image() is required.",
      );
    }
    return ["edit", "set", "image", ...this.#images];
  }
}

/** The shape of {@link KustomizeTasks}. */
export interface KustomizeTasksApi {
  /** Render a kustomization: `kustomize build`. */
  build(configure?: Configure<KustomizeBuildSettings>): Promise<CommandOutput>;
  /** Update image overrides: `kustomize edit set image`. */
  editSetImage(
    configure?: Configure<KustomizeEditSetImageSettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for the `kustomize` CLI. */
export const KustomizeTasks: KustomizeTasksApi = {
  build(configure?: Configure<KustomizeBuildSettings>): Promise<CommandOutput> {
    return runSettings(new KustomizeBuildSettings(), configure);
  },
  editSetImage(
    configure?: Configure<KustomizeEditSetImageSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new KustomizeEditSetImageSettings(), configure);
  },
};
