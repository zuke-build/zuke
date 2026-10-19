// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * What `containerAppCanary` records about the rollout it staged, and the
 * checks every later call makes against it. Before it changes anything,
 * `stage` records the pin: the app, resource group and `az` global flags it
 * was configured with; the app's resource id as the CLI read it then, which
 * names the subscription and resource group it lives in; the stable
 * revision; and whether the app's traffic followed its latest revision. Once
 * the candidate is deployed it records the rollout: the pin, plus the
 * candidate revision and when it was created.
 * A resumed process or a `zuke cancel` whose configuration — or whose default
 * subscription — resolves differently would otherwise move traffic on an app
 * the rollout never staged.
 *
 * Internal to the package: not exported from `mod.ts`.
 *
 * @module
 */

import type { JsonValue } from "@zuke/core";
import type { Configure } from "@zuke/core/tooling";
import {
  type ContainerApp,
  CREATED_SHAPE,
  REVISION_SHAPE,
  subscriptionOf,
} from "./containerapp_canary_app.ts";
import { AzSettings } from "./settings.ts";

/**
 * A container app's or resource group's name: letters, digits, `-`, `_`, `.`
 * and parentheses, not starting with `-` so the CLI cannot read it as an
 * option. Container Apps and resource groups each allow a subset of these.
 */
export const NAME_SHAPE = /^[A-Za-z0-9_.()][A-Za-z0-9_.()-]{0,89}$/;

/** The app, resource group and global flags a rollout acts through. */
export interface ContainerAppIdentity {
  /** The container app. */
  readonly name: string;
  /** Its resource group. */
  readonly resourceGroup: string;
  /** The `az` global flags every command carries, as argv. */
  readonly flags: readonly string[];
}

/** What `stage` records before it pins the app's traffic. */
export interface ContainerAppPin extends ContainerAppIdentity {
  /** The app's resource id when the rollout was staged. */
  readonly appId: string;
  /**
   * The subscription the id names. Every command a call runs after it has
   * checked the app's id carries it, so the call cannot reach another
   * subscription, whatever the CLI's default becomes in the meantime. Derived
   * from the id, not recorded apart from it.
   */
  readonly subscription: string;
  /** The revision serving all traffic when the rollout was staged. */
  readonly stable: string;
  /** Whether the app's traffic followed its latest revision before. */
  readonly followedLatest: boolean;
}

/** A rollout as `stage` recorded it, once the candidate was deployed. */
export interface ContainerAppRecord extends ContainerAppPin {
  /** The candidate revision `stage` deployed. */
  readonly candidate: string;
  /** When the candidate revision was created. */
  readonly candidateCreated: string;
}

/** The state keys the record is kept under. */
const KEYS = {
  name: "containerAppCanaryApp",
  resourceGroup: "containerAppCanaryResourceGroup",
  flags: "containerAppCanaryAzFlags",
  appId: "containerAppCanaryAppId",
  stable: "containerAppCanaryStable",
  candidate: "containerAppCanaryCandidate",
  candidateCreated: "containerAppCanaryCandidateCreated",
  followedLatest: "containerAppCanaryFollowedLatest",
};

/**
 * The global flags `configure` gives every command. Only argv, and without
 * the binary: what the lambda passes with `.env(...)` may be a secret and is
 * neither read nor recorded, and which `az` runs does not choose the app it
 * reaches.
 */
export function azFlags(configure: Configure<AzSettings>): string[] {
  // A bare AzSettings renders no command of its own, so every token after the
  // binary is one the lambda added.
  return configure(new AzSettings()).argv().slice(1);
}

/** The state patch recording the pin, before it is made. */
export function pinRecord(pin: ContainerAppPin): Record<string, JsonValue> {
  return {
    [KEYS.name]: pin.name,
    [KEYS.resourceGroup]: pin.resourceGroup,
    [KEYS.flags]: [...pin.flags],
    [KEYS.appId]: pin.appId,
    [KEYS.stable]: pin.stable,
    [KEYS.followedLatest]: pin.followedLatest,
  };
}

/** The state patch recording a staged rollout. */
export function rolloutRecord(
  record: ContainerAppRecord,
): Record<string, JsonValue> {
  return {
    ...pinRecord(record),
    [KEYS.candidate]: record.candidate,
    [KEYS.candidateCreated]: record.candidateCreated,
  };
}

/**
 * The pin `stage` recorded — `undefined` when it recorded none, so had not
 * yet changed anything — refused as a damaged record, before any command
 * runs, unless every part of it is there, with its type and the shape
 * `stage` checked it had.
 */
export function recordedPin(
  recorded: Record<string, JsonValue>,
): ContainerAppPin | undefined {
  const name = recorded[KEYS.name];
  const resourceGroup = recorded[KEYS.resourceGroup];
  const flags = recorded[KEYS.flags];
  const appId = recorded[KEYS.appId];
  const stable = recorded[KEYS.stable];
  const followedLatest = recorded[KEYS.followedLatest];
  if (Object.values(KEYS).every((key) => recorded[key] === undefined)) {
    return undefined;
  }
  if (typeof name !== "string" || !NAME_SHAPE.test(name)) {
    throw damagedRecord("the app it staged", name);
  }
  if (typeof resourceGroup !== "string" || !NAME_SHAPE.test(resourceGroup)) {
    throw damagedRecord("the resource group it staged in", resourceGroup);
  }
  if (!isStringArray(flags)) {
    throw damagedRecord("the az flags it staged with", flags);
  }
  const subscription = typeof appId === "string"
    ? subscriptionOf(appId)
    : undefined;
  if (typeof appId !== "string" || subscription === undefined) {
    throw damagedRecord("the resource id of the app it staged", appId);
  }
  if (typeof stable !== "string" || !REVISION_SHAPE.test(stable)) {
    throw damagedRecord("the stable revision", stable);
  }
  if (typeof followedLatest !== "boolean") {
    throw damagedRecord(
      "whether traffic followed the latest revision",
      followedLatest,
    );
  }
  return {
    name,
    resourceGroup,
    flags,
    appId,
    subscription,
    stable,
    followedLatest,
  };
}

/**
 * The rollout `stage` recorded, refused as a damaged record — before any
 * command runs — unless every part of it is there, with its type and the
 * shape `stage` checked it had. A record edited by hand cannot put an option
 * or a stray revision into a command, or into the recovery a refusal prints.
 */
export function recordedRollout(
  recorded: Record<string, JsonValue>,
): ContainerAppRecord {
  const pin = recordedPin(recorded);
  if (pin === undefined) throw damagedRecord("the app it staged", undefined);
  const candidate = recorded[KEYS.candidate];
  const candidateCreated = recorded[KEYS.candidateCreated];
  if (typeof candidate !== "string" || !REVISION_SHAPE.test(candidate)) {
    throw damagedRecord("the candidate revision", candidate);
  }
  if (
    typeof candidateCreated !== "string" ||
    !CREATED_SHAPE.test(candidateCreated)
  ) {
    throw damagedRecord("when the candidate was created", candidateCreated);
  }
  return { ...pin, candidate, candidateCreated };
}

/**
 * Refuse unless `now` — the identity this call is configured with — is the
 * one the rollout recorded. Pure: it runs before any command. The flags are
 * compared as written, in order, so two spellings of one subscription are
 * refused too.
 */
export function checkIdentity(
  recorded: ContainerAppPin,
  now: ContainerAppIdentity,
) {
  const parts: ReadonlyArray<
    readonly [label: string, same: boolean, was: string, is: string]
  > = [
    ["app", recorded.name === now.name, shown(recorded.name), shown(now.name)],
    [
      "resource group",
      recorded.resourceGroup === now.resourceGroup,
      shown(recorded.resourceGroup),
      shown(now.resourceGroup),
    ],
    [
      "az flags",
      sameArgv(recorded.flags, now.flags),
      shownFlags(recorded.flags),
      shownFlags(now.flags),
    ],
  ];
  for (const [label, same, was, is] of parts) {
    if (same) continue;
    throw new Error(
      `containerAppCanary: this rollout staged with the ${label} ${was}, but ` +
        `it is now configured with ${is}, so this call changed nothing rather ` +
        `than move traffic on an app the rollout never staged. ${
          recovery(recorded)
        }`,
    );
  }
}

/**
 * Refuse unless `live` — the app the CLI reaches now, read with the
 * configuration that matched the record — has the resource id `stage` read.
 * The id names the subscription, so a different one means the CLI now
 * resolves another subscription: from `az account set`, or another logged-in
 * identity, none of which the recorded flags can see.
 */
export function checkAppId(recorded: ContainerAppPin, live: ContainerApp) {
  if (live.id === recorded.appId) return;
  throw new Error(
    `containerAppCanary: this rollout staged the app ${
      shown(recorded.appId)
    }, ` +
      `but the app the Azure CLI reaches now is ${shown(live.id)}: it ` +
      "resolves another subscription (`az account set`, another logged-in " +
      "identity). This call changed nothing rather than move traffic on an " +
      `app the rollout never staged. ${recovery(recorded)}`,
  );
}

/**
 * Whether two argv lists are the same tokens in the same order. Shared with
 * the platform, which checks that the `.az(...)` lambda gives each command
 * the flags the call resolved.
 */
export function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

/**
 * How to recover from a refusal, built from the recorded values: the engine
 * settles a refused call by cancelling the run, and its rollback refuses the
 * same way, so the one course that works is by hand.
 */
export function recovery(
  recorded: ContainerAppPin | ContainerAppRecord,
): string {
  const read = [
    "az",
    "containerapp",
    "show",
    `--name=${recorded.name}`,
    `--resource-group=${recorded.resourceGroup}`,
    "--query=id",
    ...recorded.flags,
  ];
  const weights = "candidate" in recorded
    ? [`${recorded.stable}=100`, `${recorded.candidate}=0`]
    : recorded.followedLatest
    ? ["latest=100"]
    : undefined;
  const check = "The run stops, and its rollback refuses the same way. To " +
    "recover, set the configuration and the Azure CLI's subscription back " +
    `to what the rollout started with, and check that \`${shell(read)}\` ` +
    `prints ${recorded.appId} — the app that was staged.`;
  if (weights === undefined) {
    return `${check} No candidate took traffic and the traffic was pinned ` +
      `to ${recorded.stable} by name before, so there is nothing to undo.`;
  }
  const undo = [
    "az",
    "containerapp",
    "ingress",
    "traffic",
    "set",
    `--name=${recorded.name}`,
    `--resource-group=${recorded.resourceGroup}`,
    "--revision-weight",
    ...weights,
    ...recorded.flags,
  ];
  if (!("candidate" in recorded)) {
    return `${check} No candidate took traffic, but the traffic is pinned to ` +
      `${recorded.stable} by name; hand it back to the latest revision, as it ` +
      `was, with \`${shell(undo)}\`.`;
  }
  return "The run stops, and its rollback refuses the same way, so a resume " +
    "or `zuke cancel` will not roll it back: the candidate keeps whatever " +
    "share of the traffic it had. To recover, set the configuration and the " +
    "Azure CLI's subscription back to what the rollout started with, check " +
    `that \`${shell(read)}\` prints ${recorded.appId} — the app that was ` +
    "staged — then send all of its traffic back to the stable revision " +
    `${recorded.stable} with \`${shell(undo)}\`. If it prints another id, ` +
    "the app the rollout staged is out of reach from this environment: fix " +
    "the subscription first.";
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
    "containerAppCanary: the rollout's record is damaged: it does not hold " +
      `${missing} (it holds ${
        value === undefined ? "nothing" : JSON.stringify(value)
      }), so this call cannot tell which app is the rollout's and changed ` +
      "nothing. The run stops, and its rollback needs the record too, so a " +
      "resume or `zuke cancel` will not roll it back: check with `az " +
      "containerapp show --query id` that the CLI reaches the app that was " +
      "staged, then send its traffic back by hand with `az containerapp " +
      "ingress traffic set --name <app> --resource-group <group> " +
      "--revision-weight <stable>=100 <candidate>=0`, plus the --subscription " +
      "the rollout used.",
  );
}

/** A recorded or configured value, for a message. */
function shown(value: string): string {
  return JSON.stringify(value);
}

/** Global flags as an operator would type them, or a note there are none. */
function shownFlags(flags: readonly string[]): string {
  return flags.length === 0 ? "no az flags" : `\`${shell(flags)}\``;
}

/** Whether a recorded value is a list of strings. */
function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}
