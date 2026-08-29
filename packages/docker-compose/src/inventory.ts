// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for the Compose subcommands that report on what exists rather than
 * changing it: `images`, `ls`, `volumes`, `version`, `port` and `events`.
 */

import { DockerComposeSettings } from "./settings.ts";

/**
 * Shared by the listing subcommands that accept `--format` and `--quiet`.
 *
 * `--format json` is what makes these readable by a build rather than by a
 * person, so the convenience {@link json} spells it rather than leaving the
 * caller to remember the value.
 */
export abstract class DockerComposeListingSettings
  extends DockerComposeSettings {
  #format?: string;
  #quiet = false;

  /** Format the output (`--format`), e.g. `table` or `json`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Emit JSON (`--format json`). */
  json(): this {
    return this.format("json");
  }

  /** Print only identifiers or names (`--quiet`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** The shared listing flags, in the CLI's own order. */
  protected listingFlags(): string[] {
    const argv: string[] = [];
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#quiet) argv.push("--quiet");
    return argv;
  }
}

/** Settings for `compose images`. */
export class DockerComposeImagesSettings extends DockerComposeListingSettings {
  #services: string[] = [];

  /** Restrict the listing to these services. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose images` argv. */
  protected override composeArgs(): string[] {
    return ["images", ...this.listingFlags(), ...this.#services];
  }
}

/** Settings for `compose volumes`. */
export class DockerComposeVolumesSettings extends DockerComposeListingSettings {
  #services: string[] = [];

  /** Restrict the listing to the volumes these services use. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Assemble the `compose volumes` argv. */
  protected override composeArgs(): string[] {
    return ["volumes", ...this.listingFlags(), ...this.#services];
  }
}

/** Settings for `compose ls`, which lists Compose projects rather than services. */
export class DockerComposeLsSettings extends DockerComposeListingSettings {
  #all = false;
  #filters: string[] = [];

  /** Include stopped projects (`--all`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Filter the listing (`--filter`), e.g. `name=my-project`. */
  filter(expression: string): this {
    this.#filters.push(expression);
    return this;
  }

  /** Assemble the `compose ls` argv. */
  protected override composeArgs(): string[] {
    const argv = ["ls"];
    if (this.#all) argv.push("--all");
    for (const expression of this.#filters) argv.push("--filter", expression);
    argv.push(...this.listingFlags());
    return argv;
  }
}

/** Settings for `compose version`. */
export class DockerComposeVersionSettings extends DockerComposeSettings {
  #format?: string;
  #short = false;

  /** Format the output (`--format`), `pretty` or `json`. */
  format(value: string): this {
    this.#format = value;
    return this;
  }

  /** Emit JSON (`--format json`). */
  json(): this {
    return this.format("json");
  }

  /** Print only the version number (`--short`). */
  short(): this {
    this.#short = true;
    return this;
  }

  /** Assemble the `compose version` argv. */
  protected override composeArgs(): string[] {
    const argv = ["version"];
    if (this.#format !== undefined) argv.push("--format", this.#format);
    if (this.#short) argv.push("--short");
    return argv;
  }
}

/**
 * Settings for `compose port`, which prints the host address a service's
 * container port was published on.
 */
export class DockerComposePortSettings extends DockerComposeSettings {
  #service?: string;
  #privatePort?: number;
  #protocol?: "tcp" | "udp";
  #index?: number;

  /** The service to ask about (required). */
  service(name: string): this {
    this.#service = name;
    return this;
  }

  /** The container-side port to look up (required). */
  privatePort(port: number): this {
    this.#privatePort = port;
    return this;
  }

  /** The protocol of the binding (`--protocol`), `tcp` by default. */
  protocol(value: "tcp" | "udp"): this {
    this.#protocol = value;
    return this;
  }

  /** Pick the replica to ask when the service has several (`--index`). */
  index(value: number): this {
    this.#index = value;
    return this;
  }

  /** Assemble the `compose port` argv. */
  protected override composeArgs(): string[] {
    if (this.#service === undefined || this.#privatePort === undefined) {
      throw new Error(
        "DockerComposeTasks.port: .service() and .privatePort() are both " +
          "required — compose port looks up one binding on one service.",
      );
    }
    const argv = ["port"];
    if (this.#protocol !== undefined) argv.push("--protocol", this.#protocol);
    if (this.#index !== undefined) argv.push("--index", String(this.#index));
    argv.push(this.#service, String(this.#privatePort));
    return argv;
  }
}

/** Settings for `compose events`. */
export class DockerComposeEventsSettings extends DockerComposeSettings {
  #services: string[] = [];
  #json = false;
  #since?: string;
  #until?: string;

  /** Restrict the stream to these services. */
  services(...names: string[]): this {
    this.#services.push(...names);
    return this;
  }

  /** Emit each event as a JSON object (`--json`). */
  json(): this {
    this.#json = true;
    return this;
  }

  /** Include events since a timestamp (`--since`). */
  since(timestamp: string): this {
    this.#since = timestamp;
    return this;
  }

  /**
   * Stop streaming at a timestamp (`--until`).
   *
   * Without it the command streams until interrupted, so a build target that
   * awaits it blocks — bound the run with this or with `.killAfter(ms)`.
   */
  until(timestamp: string): this {
    this.#until = timestamp;
    return this;
  }

  /** Assemble the `compose events` argv. */
  protected override composeArgs(): string[] {
    const argv = ["events"];
    if (this.#json) argv.push("--json");
    if (this.#since !== undefined) argv.push("--since", this.#since);
    if (this.#until !== undefined) argv.push("--until", this.#until);
    argv.push(...this.#services);
    return argv;
  }
}
