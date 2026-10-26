// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Just enough of Azure Container Apps to drive `containerAppCanary` against,
 * shared by its unit and integration tests. Apps are keyed by subscription,
 * resource group and name — `--subscription` picks the subscription, the
 * default otherwise — and each has revisions with a creation time, a latest
 * revision, and ingress traffic.
 *
 * `ingress traffic set` behaves as the CLI's does: each weight given updates
 * the entry of that revision (or the one that follows `latest`), or adds one,
 * and the entries not named are rescaled to what is left, so the weights
 * still add up to 100. The model answers the `--query` projections the
 * platform pins with their result directly; it does not evaluate JMESPath.
 *
 * @module
 */

import { CommandOutput } from "@zuke/core/shell";
import type { AzSettings, AzSettingsRunner } from "../mod.ts";

/** One ingress traffic entry, as the service stores it. */
export interface ModelTraffic {
  /** The revision named, when the entry names one. */
  revisionName?: string;
  /** Whether the entry follows the latest revision. */
  latestRevision?: boolean;
  /** The share of traffic. */
  weight: number;
  /** The entry's label, if any. */
  label?: string;
}

/** An app as the model keeps it. */
export interface ModelApp {
  /** `Multiple`, `Single` or `Labels`. */
  mode: string;
  /** Revisions by name. */
  revisions: Record<string, { created: string; provisioning: string }>;
  /** The newest revision. */
  latest: string;
  /** The newest revision that provisioned; {@link latest} when unset. */
  latestReady?: string;
  /** The image the latest revision runs. */
  image: string;
  /** Ingress traffic, or `null` without ingress. */
  traffic: ModelTraffic[] | null;
}

/** A recording model of Container Apps. */
export class ContainerAppModel {
  /** Every command line run, without the binary. */
  calls: string[][] = [];
  /** Apps keyed `<subscription>/<resource group>/<name>`. */
  apps: Record<string, ModelApp> = {};
  /** The subscription used when no `--subscription` is given. */
  defaultSubscription = "sub-prod";
  /** The provisioning state a new revision gets. */
  provisioning = "Provisioned";
  /** Revisions made so far, for their creation times. */
  #made = 0;

  /** A model with `api` in `rg-prod`, serving `api--v1` through "latest". */
  constructor() {
    this.apps["sub-prod/rg-prod/api"] = {
      mode: "Multiple",
      revisions: {
        "api--v1": {
          created: "2026-10-01T00:00:00Z",
          provisioning: "Provisioned",
        },
      },
      latest: "api--v1",
      image: "acr.io/api:1",
      traffic: [{ latestRevision: true, weight: 100 }],
    };
  }

  /** The runner to hand to `.runner(...)` through `a.az(...)`. */
  readonly runner: AzSettingsRunner = (settings: AzSettings) =>
    Promise.resolve(this.run(settings.argv().slice(1)));

  /** The app `api` in `rg-prod` of the default subscription. */
  get api(): ModelApp {
    return this.apps["sub-prod/rg-prod/api"];
  }

  /** Run one command line (without the binary) against the model. */
  run(argv: string[]): CommandOutput {
    this.calls.push(argv);
    const subscription = flagValue(argv, "--subscription") ??
      this.defaultSubscription;
    const group = flagValue(argv, "--resource-group");
    const name = flagValue(argv, "--name");
    const key = `${subscription}/${group}/${name}`;
    const app = this.apps[key];
    if (app === undefined) {
      return failure(`(ResourceNotFound) The resource ${key} was not found.`);
    }
    const id = `/subscriptions/${subscription}/resourceGroups/${group}/` +
      `providers/Microsoft.App/containerApps/${name}`;
    const command = argv.slice(1, 4).join(" ");
    if (argv[1] === "show") {
      return answer({
        id,
        mode: app.mode,
        latest: app.latest,
        latestReady: app.latestReady ?? app.latest,
        traffic: app.traffic === null
          ? null
          : app.traffic.map((entry) => ({ ...entry })),
      });
    }
    if (command.startsWith("revision list")) {
      const query = flagValue(argv, "--query") ?? "";
      const wanted = /name=='([^']*)'/.exec(query)?.[1] ?? "";
      const revision = app.revisions[wanted];
      return answer(revision === undefined ? null : { ...revision });
    }
    if (command === "ingress traffic set") {
      if (app.traffic === null) return failure("Ingress is not enabled.");
      const at = argv.indexOf("--revision-weight");
      const pairs = argv.slice(at + 1).filter((token) =>
        /^[a-z][a-z0-9-]*=\d+$/.test(token)
      ).map((token): [string, number] => {
        const [revision, weight] = token.split("=");
        return [revision, Number(weight)];
      });
      const touched = new Set<ModelTraffic>();
      for (const [revision, weight] of pairs) {
        const found = app.traffic.find((entry) =>
          revision === "latest"
            ? entry.latestRevision === true
            : entry.revisionName === revision
        );
        const entry = found ??
          (revision === "latest"
            ? { latestRevision: true, weight }
            : { revisionName: revision, weight });
        entry.weight = weight;
        if (found === undefined) app.traffic.push(entry);
        touched.add(entry);
      }
      const given = pairs.reduce((sum, [, weight]) => sum + weight, 0);
      const rest = app.traffic.filter((entry) => !touched.has(entry));
      const restSum = rest.reduce((sum, entry) => sum + entry.weight, 0);
      for (const entry of rest) {
        entry.weight = restSum === 0
          ? 0
          : Math.round((entry.weight / restSum) * (100 - given));
      }
      return answer(app.traffic);
    }
    if (argv[1] === "update") {
      const image = flagValue(argv, "--image") ?? app.image;
      const suffix = flagValue(argv, "--revision-suffix");
      if (image === app.image && suffix === undefined) return answer({});
      this.#made += 1;
      const revision = `${name}--${suffix ?? `r${this.#made}`}`;
      if (app.revisions[revision] !== undefined) {
        return failure(`Revision ${revision} already exists.`);
      }
      app.revisions[revision] = {
        created: `2026-10-19T00:00:0${this.#made}Z`,
        provisioning: this.provisioning,
      };
      app.latestReady = this.provisioning === "Provisioned"
        ? revision
        : app.latestReady ?? app.latest;
      app.latest = revision;
      app.image = image;
      return answer({});
    }
    return failure(`not modelled: ${argv.join(" ")}`);
  }

  /** The traffic each revision gets, with "latest" resolved. */
  shares(key = "sub-prod/rg-prod/api"): Record<string, number> {
    const app = this.apps[key];
    const shares: Record<string, number> = {};
    for (const entry of app.traffic ?? []) {
      const revision = entry.latestRevision === true
        ? app.latestReady ?? app.latest
        : entry.revisionName ?? "";
      shares[revision] = (shares[revision] ?? 0) + entry.weight;
    }
    return Object.fromEntries(
      Object.entries(shares).filter(([, weight]) => weight > 0),
    );
  }

  /** The traffic moves made, as the weights each one gave. */
  trafficMoves(): string[][] {
    return this.calls.filter((argv) => argv[1] === "ingress")
      .map((argv) =>
        argv.slice(argv.indexOf("--revision-weight") + 1)
          .filter((token) => /^[a-z][a-z0-9-]*=\d+$/.test(token))
      );
  }

  /** The commands that change something — everything but the reads. */
  mutations(): string[][] {
    return this.calls.filter((argv) =>
      argv[1] !== "show" && argv.slice(1, 3).join(" ") !== "revision list"
    );
  }
}

/** The flag's value in `argv`, as `--flag=value` or `--flag value`. */
export function flagValue(
  argv: readonly string[],
  flag: string,
): string | undefined {
  const joined = argv.find((token) => token.startsWith(`${flag}=`));
  if (joined !== undefined) return joined.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

/** A successful JSON answer. */
function answer(value: unknown): CommandOutput {
  return new CommandOutput(0, `${JSON.stringify(value)}\n`, "");
}

/** A failed call, as the CLI reports a service error. */
function failure(message: string): CommandOutput {
  return new CommandOutput(1, "", `ERROR: ${message}`);
}
