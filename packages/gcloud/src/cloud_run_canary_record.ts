// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `cloudRunCanary` records about the service a rollout acts on, and the
 * checks every later call makes against it: the service, region, tag and
 * gcloud global flags `stage` was configured with, and the Cloud Run
 * service's `metadata.uid` as gcloud read it then. A resumed process or a
 * `zuke cancel` whose configuration resolves differently would otherwise
 * move traffic on — or promote — a service the rollout never staged.
 *
 * Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  GcloudRunServicesDescribeSettings,
  GcloudRunUpdateTrafficSettings,
} from "./cloud_run.ts";
import { GcloudSettings } from "./settings.ts";

/** The projection that reads a Cloud Run service's uid. */
export const UID_FORMAT = "value(metadata.uid)";

/** The service, region, tag and global flags a rollout acts through. */
export interface CloudRunIdentity {
  /** The Cloud Run service. */
  readonly service: string;
  /** The region, or `null` when gcloud's default applies. */
  readonly region: string | null;
  /** The tag that routes the candidate's traffic. */
  readonly tag: string;
  /** The gcloud global flags every command carries, as argv. */
  readonly flags: readonly string[];
}

/** An identity as `stage` recorded it, with the service's uid it read. */
export interface RecordedIdentity extends CloudRunIdentity {
  /** The service's `metadata.uid` when the rollout was staged. */
  readonly uid: string;
}

/** The state keys the identity is recorded under. */
const KEYS = {
  service: "cloudRunService",
  region: "cloudRunRegion",
  tag: "cloudRunTag",
  flags: "cloudRunGcloudFlags",
  uid: "cloudRunServiceUid",
};

/**
 * The global flags `configure` gives every command — none without a lambda.
 * Only argv, and without the binary: what the lambda passes with `.env(...)`
 * may be a secret and is neither read nor recorded, and which gcloud runs
 * does not choose the service it reaches.
 */
export function gcloudFlags(
  configure: Configure<GcloudSettings> | undefined,
): string[] {
  if (configure === undefined) return [];
  // A bare GcloudSettings renders nothing of its own, so every token after
  // the binary is one the lambda added.
  return configure(new GcloudSettings()).argv().slice(1);
}

/** The state patch recording `identity` and the service's `uid`. */
export function identityRecord(
  identity: CloudRunIdentity,
  uid: string,
): Record<string, JsonValue> {
  return {
    [KEYS.service]: identity.service,
    [KEYS.region]: identity.region,
    [KEYS.tag]: identity.tag,
    [KEYS.flags]: [...identity.flags],
    [KEYS.uid]: uid,
  };
}

/**
 * The identity `stage` recorded, refused as a damaged record — before any
 * command runs — unless every part of it is there with its type.
 */
export function recordedIdentity(
  recorded: Record<string, JsonValue>,
): RecordedIdentity {
  const service = recorded[KEYS.service];
  const region = recorded[KEYS.region];
  const tag = recorded[KEYS.tag];
  const flags = recorded[KEYS.flags];
  const uid = recorded[KEYS.uid];
  if (typeof service !== "string" || service === "") {
    throw damagedRecord("the service it staged", service);
  }
  if (typeof region !== "string" && region !== null) {
    throw damagedRecord("the region it staged in", region);
  }
  if (typeof tag !== "string" || tag === "") {
    throw damagedRecord("the tag it staged with", tag);
  }
  if (!isStringArray(flags)) {
    throw damagedRecord("the gcloud flags it staged with", flags);
  }
  if (typeof uid !== "string" || uid === "") {
    throw damagedRecord("the uid of the service it staged", uid);
  }
  return { service, region, tag, flags, uid };
}

/**
 * Refuse unless `now` — the identity this call is configured with — is the
 * one the rollout recorded. Pure: it runs before any command. The flags are
 * compared as written, in order, so two spellings of one project are refused
 * too.
 */
export function checkIdentity(
  recorded: RecordedIdentity,
  now: CloudRunIdentity,
): void {
  const parts: ReadonlyArray<
    readonly [label: string, same: boolean, was: string, is: string]
  > = [
    [
      "service",
      recorded.service === now.service,
      shown(recorded.service),
      shown(now.service),
    ],
    [
      "region",
      recorded.region === now.region,
      shownRegion(recorded.region),
      shownRegion(now.region),
    ],
    ["tag", recorded.tag === now.tag, shown(recorded.tag), shown(now.tag)],
    [
      "gcloud flags",
      sameArgv(recorded.flags, now.flags),
      shownFlags(recorded.flags),
      shownFlags(now.flags),
    ],
  ];
  for (const [label, same, was, is] of parts) {
    if (same) continue;
    throw new Error(
      `cloudRunCanary: this rollout staged with the ${label} ${was}, but it ` +
        `is now configured with ${is}, so this call changed nothing rather ` +
        "than move traffic on a service the rollout never staged. " +
        recovery(recorded),
    );
  }
}

/** Whether two argv lists are the same tokens in the same order. */
function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/**
 * Refuse unless `live` — the uid of the service gcloud reaches now, read with
 * the configuration that matched the record — is the uid `stage` read. Cloud
 * Run gives a service its uid when it is created and keeps it until it is
 * deleted, so a different one means the service was deleted and created
 * again, or gcloud now resolves another project: from `CLOUDSDK_CORE_PROJECT`,
 * `gcloud config set project`, or another active configuration, none of which
 * the recorded flags can see.
 */
export function checkUid(recorded: RecordedIdentity, live: string): void {
  if (live === recorded.uid) return;
  throw new Error(
    `cloudRunCanary: the service ${shown(recorded.service)} this rollout ` +
      `staged has the uid ${shown(recorded.uid)}, but the one gcloud reaches ` +
      `now has the uid ${shown(live)}: it was deleted and created again, or ` +
      "gcloud resolves another project (CLOUDSDK_CORE_PROJECT, `gcloud " +
      "config set project`, another active configuration). This call " +
      "changed nothing rather than move traffic on a service the rollout " +
      `never staged. ${recovery(recorded)}`,
  );
}

/**
 * How to recover from a refusal, built from the recorded values: the
 * engine settles a refused call by cancelling the run, and its rollback
 * refuses the same way, so the one course that works is by hand.
 */
function recovery(recorded: RecordedIdentity): string {
  // The projection goes last, so a --format among the recorded flags does
  // not override it.
  const describe = scopedTo(
    recorded,
    new GcloudRunServicesDescribeSettings().service(recorded.service),
  ).args("--format", UID_FORMAT);
  const undo = scopedTo(
    recorded,
    new GcloudRunUpdateTrafficSettings().service(recorded.service)
      .toTags(`${recorded.tag}=0`),
  );
  const revisions = new GcloudSettings().command(
    "run",
    "revisions",
    "list",
    "--service",
    recorded.service,
  );
  if (recorded.region !== null) revisions.flag("region", recorded.region);
  revisions.args(...recorded.flags);
  return "The run stops, and its rollback refuses the same way, so a " +
    "resume or `zuke cancel` will not roll it back: the candidate's tagged " +
    "route stays as it is. To recover, set the configuration and gcloud's " +
    "active project back to what the rollout started with, check that " +
    `\`${shell(describe.argv())}\` prints ${recorded.uid} — the service ` +
    "that was staged (a rollback run by hand has no record to check it " +
    "against) — then take the candidate's traffic back with " +
    `\`${shell(undo.argv())}\`. Prefer that: it returns the tag's share to ` +
    "the revisions already serving, keeping their split. Running the " +
    "rollout's <field>.abort target by hand (for example `zuke " +
    "rollout.abort`) with r.stable('<revision>') instead sends all traffic " +
    "to that one revision, collapsing any earlier split; " +
    `\`${shell(revisions.argv())}\` lists the revisions to choose from. If ` +
    "it prints another uid, the service the rollout staged was deleted or " +
    "is out of reach: check `gcloud run services list` and clean up by hand.";
}

/**
 * Refuse, before it runs, unless the tokens the `.gcloud(...)` lambda added
 * to `argv` — everything after its first `own` tokens, the binary and the
 * command's own — are exactly `flags`, the ones this call resolved and
 * checked. The lambda runs once per command, so one that resolves
 * differently between two runs of itself (it reads a clock, or changes what
 * it closes over) is caught here rather than sending one command to another
 * project.
 */
export function checkApplied(
  argv: readonly string[],
  own: number,
  flags: readonly string[],
): void {
  if (sameArgv(argv.slice(own), flags)) return;
  throw new Error(
    `cloudRunCanary: r.gcloud(...) gave this command \`${shell(argv)}\` ` +
      `where the gcloud flags this call resolved are ${shownFlags(flags)}, ` +
      "so it does not run: the lambda must give the same flags every time " +
      "it runs. " +
      "Make it depend only on the build's resolved parameters.",
  );
}

/**
 * `command` with the recorded region, when one was recorded, and the
 * recorded global flags, which gcloud accepts after the command's own.
 */
function scopedTo<S extends GcloudSettings & { region(value: string): S }>(
  recorded: RecordedIdentity,
  command: S,
): S {
  if (recorded.region !== null) command.region(recorded.region);
  return command.args(...recorded.flags);
}

/** An argv as a POSIX shell would take it back, quoting what needs it. */
function shell(argv: readonly string[]): string {
  return argv.map((token) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(token)
      ? token
      : `'${token.replaceAll("'", "'\\''")}'`
  ).join(" ");
}

/**
 * The refusal for a record missing one of its parts — `missing` names it —
 * which nothing can be checked against, so the call changes nothing.
 */
export function damagedRecord(
  missing: string,
  value: JsonValue | undefined,
): Error {
  return new Error(
    "cloudRunCanary: the rollout's record is damaged: it does not hold " +
      `${missing} (it holds ${
        value === undefined ? "nothing" : JSON.stringify(value)
      }), so this call cannot tell which service is the rollout's and ` +
      "changed nothing. A rollout staged before @zuke/gcloud recorded its " +
      "service has no such record. The run stops, and its rollback needs " +
      "the record too, so a " +
      "resume or `zuke cancel` will not roll it back: check with `gcloud run " +
      "services describe` that gcloud reaches the service that was staged, " +
      "then take the candidate's traffic back by hand with `gcloud run " +
      "services update-traffic <service> --region <region> --to-tags " +
      "<tag>=0`, plus the --project and --account flags the rollout used.",
  );
}

/** A recorded or configured value, for a message. */
function shown(value: string): string {
  return JSON.stringify(value);
}

/** A region, or a note that gcloud's default applies. */
function shownRegion(region: string | null): string {
  return region === null ? "gcloud's default region" : shown(region);
}

/** Global flags as an operator would type them, or a note there are none. */
function shownFlags(flags: readonly string[]): string {
  return flags.length === 0 ? "no gcloud flags" : `\`${shell(flags)}\``;
}

/** Whether a recorded value is a list of strings. */
function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}
