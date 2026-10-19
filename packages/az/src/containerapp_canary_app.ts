// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading what `containerAppCanary` acts on: a container app — its resource
 * id, revision mode, latest revision and ingress traffic — and one of its
 * revisions. Each read is one CLI call, pinned to `--output json` and a
 * `--query` that keeps only those fields, and its answer is checked field by
 * field before the platform relies on it.
 *
 * Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type {
  AzContainerappRevisionListSettings,
  AzContainerappShowSettings,
} from "./containerapp.ts";
import { AzOutputError } from "./errors.ts";
import { jsonFrom } from "./reader.ts";
import { isRecord } from "./shape.ts";

/** What the platform reads failures as. */
const TASK = "containerAppCanary";

/** The fields of `containerapp show` the platform uses. */
const APP_QUERY =
  "{id: id, mode: properties.configuration.activeRevisionsMode, " +
  "latest: properties.latestRevisionName, " +
  "latestReady: properties.latestReadyRevisionName, " +
  "traffic: properties.configuration.ingress.traffic}";

/**
 * A revision name as Container Apps makes it — `<app>--<suffix>`, lowercase
 * letters, digits and hyphens, at most 63 characters. Checked before a name
 * goes into a `--query` or a `--revision-weight`, so it can neither end the
 * query's string nor be read as an option — nor be `latest`, which
 * `--revision-weight` reads as whichever revision is newest.
 */
export const REVISION_SHAPE =
  /^(?=.{1,63}$)[a-z][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/;

/**
 * A container app's resource id, whose first part names its subscription:
 * `/subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.App/
 * containerApps/<name>`. Checked on every id read and recorded, so neither
 * can carry anything else into a command or a message.
 */
const APP_ID_SHAPE =
  /^\/subscriptions\/([A-Za-z0-9-]+)\/resourceGroups\/[A-Za-z0-9_.()-]+\/providers\/Microsoft\.App\/containerApps\/[a-z0-9-]+$/i;

/** A revision's creation time as the service reports it, in ISO 8601. */
export const CREATED_SHAPE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * The subscription a container app's resource id names — `undefined` when
 * `id` is not shaped as one.
 */
export function subscriptionOf(id: string): string | undefined {
  return APP_ID_SHAPE.exec(id)?.[1];
}

/**
 * One entry of an app's ingress traffic: one that names a revision, or the
 * one that follows whichever revision is latest.
 */
type TrafficEntry =
  & {
    /** The share of traffic, in percent. */
    readonly weight: number;
    /** The entry's label, if it has one. */
    readonly label?: string;
  }
  & (
    | {
      /** The entry names a revision. */
      readonly latest: false;
      /** The revision it names. */
      readonly revision: string;
    }
    | {
      /** The entry follows the latest revision. */
      readonly latest: true;
    }
  );

/** A container app as `containerapp show` reported it. */
export interface ContainerApp {
  /** The app's resource id, which names its subscription and resource group. */
  readonly id: string;
  /** The subscription the id names. */
  readonly subscription: string;
  /** The revision mode: `Multiple`, `Single` or `Labels`. */
  readonly mode: string;
  /** The newest revision. */
  readonly latest: string;
  /**
   * The newest revision that provisioned — the one a traffic entry that
   * follows the latest revision sends its share to. It is not
   * {@link latest} while the newest revision is still provisioning, or failed.
   */
  readonly latestReady: string;
  /** The ingress traffic, or `null` when the app has no ingress. */
  readonly traffic: readonly TrafficEntry[] | null;
}

/** A revision's provisioning state and creation time. */
export interface ContainerAppRevision {
  /** `Provisioned`, `Provisioning`, `Failed`, … */
  readonly provisioning: string;
  /** When the revision was created, as the service reports it. */
  readonly created: string;
}

/**
 * Refuse a name that is not {@link REVISION_SHAPE}d before it goes into a
 * command — a `--query` or a `--revision-weight`.
 */
export function checkRevisionName(revision: string): void {
  if (REVISION_SHAPE.test(revision)) return;
  throw new Error(
    `containerAppCanary: "${revision}" is not a Container Apps revision ` +
      "name — `<app>--<suffix>`, in lowercase letters, digits and hyphens.",
  );
}

/** Read the app `command` names. */
export async function readApp(
  command: AzContainerappShowSettings,
): Promise<ContainerApp> {
  const answer = await jsonFrom(command, TASK, APP_QUERY);
  if (!isRecord(answer)) {
    throw new AzOutputError(
      TASK,
      "containerapp show did not answer with an object.",
    );
  }
  const { id, mode, latest, latestReady, traffic } = answer;
  const subscription = typeof id === "string" ? subscriptionOf(id) : undefined;
  if (typeof id !== "string" || subscription === undefined) {
    throw new AzOutputError(
      TASK,
      "containerapp show reported no container app resource id.",
    );
  }
  if (typeof mode !== "string" || mode === "") {
    throw new AzOutputError(
      TASK,
      "containerapp show reported no activeRevisionsMode.",
    );
  }
  if (typeof latest !== "string" || latest === "") {
    throw new AzOutputError(
      TASK,
      "containerapp show reported no latestRevisionName.",
    );
  }
  if (typeof latestReady !== "string" || latestReady === "") {
    throw new AzOutputError(
      TASK,
      "containerapp show reported no latestReadyRevisionName.",
    );
  }
  return {
    id,
    subscription,
    mode,
    latest,
    latestReady,
    traffic: trafficOf(traffic),
  };
}

/**
 * Read one revision of the app `command` (a `revision list --all`) names —
 * refused, as an output error, when the app has no revision of that name.
 */
export async function readRevision(
  command: AzContainerappRevisionListSettings,
  revision: string,
): Promise<ContainerAppRevision> {
  checkRevisionName(revision);
  const answer = await jsonFrom(
    command,
    TASK,
    `[?name=='${revision}'] | [0].{provisioning: ` +
      "properties.provisioningState, created: properties.createdTime}",
  );
  if (!isRecord(answer)) {
    throw new AzOutputError(TASK, `the app has no revision ${revision}.`);
  }
  const { provisioning, created } = answer;
  if (typeof provisioning !== "string" || provisioning === "") {
    throw new AzOutputError(
      TASK,
      `revision ${revision} reported no provisioningState.`,
    );
  }
  if (typeof created !== "string" || !CREATED_SHAPE.test(created)) {
    throw new AzOutputError(
      TASK,
      `revision ${revision} reported no createdTime.`,
    );
  }
  return { provisioning, created };
}

/** The ingress traffic, checked entry by entry; `null` without ingress. */
function trafficOf(value: unknown): TrafficEntry[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new AzOutputError(
      TASK,
      "containerapp show reported ingress traffic that is not a list.",
    );
  }
  return value.map((entry): TrafficEntry => {
    if (!isRecord(entry)) {
      throw new AzOutputError(
        TASK,
        "an ingress traffic entry is not an object.",
      );
    }
    const { revisionName, latestRevision, weight, label } = entry;
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new AzOutputError(TASK, "an ingress traffic entry has no weight.");
    }
    const named = typeof label === "string" ? { label } : {};
    if (latestRevision === true) return { latest: true, weight, ...named };
    if (typeof revisionName !== "string") {
      throw new AzOutputError(
        TASK,
        "an ingress traffic entry names no revision and does not follow the " +
          "latest one.",
      );
    }
    return { latest: false, revision: revisionName, weight, ...named };
  });
}
