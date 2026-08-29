// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading the JSON `kubectl get -o json` prints.
 *
 * The narrowing helpers are internal to the package; the entry types and their
 * parsers are exported, so a build can hand a captured payload to the same
 * parser a task uses.
 *
 * @module
 */

/**
 * A Kubernetes namespace, parsed from `kubectl get namespaces -o json` — the
 * typed result of {@link KubectlTasksApi.getNamespaces}.
 */
export interface KubernetesNamespace {
  /** The namespace name (`metadata.name`). */
  name: string;
  /**
   * The lifecycle phase (`status.phase`), e.g. `"Active"` or `"Terminating"`;
   * `""` when the field is absent.
   */
  status: string;
  /** The namespace labels (`metadata.labels`), string-valued; `{}` when none. */
  labels: Record<string, string>;
  /** When the namespace was created (`metadata.creationTimestamp`), if present. */
  createdAt?: string;
}

/** Narrow an unknown value to a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow a value to a `Record<string, string>`, dropping non-string entries. */
function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string") out[key] = v;
    }
  }
  return out;
}

/** Narrow one `kubectl get` item into a {@link KubernetesNamespace}, or `null`. */
function parseNamespace(item: unknown): KubernetesNamespace | null {
  if (!isRecord(item)) return null;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const name = typeof metadata.name === "string" ? metadata.name : undefined;
  if (name === undefined) return null;
  const status = isRecord(item.status) && typeof item.status.phase === "string"
    ? item.status.phase
    : "";
  const createdAt = typeof metadata.creationTimestamp === "string"
    ? metadata.creationTimestamp
    : undefined;
  return { name, status, labels: stringMap(metadata.labels), createdAt };
}

/**
 * Parse the JSON text of `kubectl get namespaces -o json` — a `List`, or a
 * single namespace object — into {@link KubernetesNamespace} records. Items
 * without a `metadata.name` are skipped; empty input yields `[]`. Throws if the
 * text is non-empty and not valid JSON.
 */
export function parseNamespaces(json: string): KubernetesNamespace[] {
  const text = json.trim();
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  const items = isRecord(parsed) && Array.isArray(parsed.items)
    ? parsed.items
    : [parsed];
  const namespaces: KubernetesNamespace[] = [];
  for (const item of items) {
    const namespace = parseNamespace(item);
    if (namespace !== null) namespaces.push(namespace);
  }
  return namespaces;
}

/**
 * One resource of {@link "./kubectl.ts".KubectlTasksApi.getEntries} — the
 * fields every Kubernetes object carries, whatever its kind.
 */
export interface KubernetesResource {
  /** The object's name (`metadata.name`). */
  name: string;
  /** Its kind, e.g. `Pod` (`kind`); `""` when the field is absent. */
  kind: string;
  /** Its namespace (`metadata.namespace`), absent for a cluster-scoped object. */
  namespace?: string;
  /** Its labels (`metadata.labels`), string-valued; `{}` when none. */
  labels: Record<string, string>;
  /** When it was created (`metadata.creationTimestamp`), if present. */
  createdAt?: string;
}

/** Narrow one `kubectl get` item into a {@link KubernetesResource}, or `null`. */
function parseResource(item: unknown): KubernetesResource | null {
  if (!isRecord(item)) return null;
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const name = typeof metadata.name === "string" ? metadata.name : undefined;
  if (name === undefined) return null;
  const resource: KubernetesResource = {
    name,
    kind: typeof item.kind === "string" ? item.kind : "",
    labels: stringMap(metadata.labels),
  };
  if (typeof metadata.namespace === "string") {
    resource.namespace = metadata.namespace;
  }
  if (typeof metadata.creationTimestamp === "string") {
    resource.createdAt = metadata.creationTimestamp;
  }
  return resource;
}

/**
 * Parse the JSON text of any `kubectl get … -o json` — a `List`, or a single
 * object — into {@link KubernetesResource} records. Items without a
 * `metadata.name` are skipped; empty input yields `[]`. Throws if the text is
 * non-empty and not valid JSON.
 */
export function parseResources(json: string): KubernetesResource[] {
  const text = json.trim();
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  const items = isRecord(parsed) && Array.isArray(parsed.items)
    ? parsed.items
    : [parsed];
  const resources: KubernetesResource[] = [];
  for (const item of items) {
    const resource = parseResource(item);
    if (resource !== null) resources.push(resource);
  }
  return resources;
}

/**
 * One event of {@link "./kubectl.ts".KubectlTasksApi.eventEntries} — what the
 * cluster reports about a resource, which is the first thing to read when a
 * rollout stalls.
 */
export interface KubernetesEvent {
  /** `Normal` or `Warning` (`type`); `""` when the field is absent. */
  type: string;
  /** The short machine-readable cause (`reason`). */
  reason: string;
  /** The human-readable detail (`message`). */
  message: string;
  /** What the event is about, as `Kind/name` (`regarding`/`involvedObject`). */
  regarding?: string;
  /** How many times it has repeated (`series.count` or `count`). */
  count?: number;
  /** When it was last seen, ISO 8601, when the payload carries a time. */
  lastSeen?: string;
}

/** Narrow one `kubectl events -o json` item into a {@link KubernetesEvent}. */
function parseEvent(item: unknown): KubernetesEvent | null {
  if (!isRecord(item)) return null;
  const reason = typeof item.reason === "string" ? item.reason : undefined;
  const message = typeof item.message === "string"
    ? item.message
    : typeof item.note === "string"
    ? item.note
    : undefined;
  if (reason === undefined && message === undefined) return null;
  const event: KubernetesEvent = {
    type: typeof item.type === "string" ? item.type : "",
    reason: reason ?? "",
    message: message ?? "",
  };
  // kubectl's events API spells the subject `regarding`; the core/v1 Event
  // that older servers return spells it `involvedObject`.
  const subject = isRecord(item.regarding)
    ? item.regarding
    : isRecord(item.involvedObject)
    ? item.involvedObject
    : undefined;
  if (subject !== undefined) {
    const kind = typeof subject.kind === "string" ? subject.kind : undefined;
    const name = typeof subject.name === "string" ? subject.name : undefined;
    if (name !== undefined) {
      event.regarding = kind === undefined ? name : `${kind}/${name}`;
    }
  }
  const series = isRecord(item.series) ? item.series : undefined;
  const count = typeof series?.count === "number"
    ? series.count
    : typeof item.count === "number"
    ? item.count
    : undefined;
  if (count !== undefined) event.count = count;
  const lastSeen = typeof item.lastTimestamp === "string"
    ? item.lastTimestamp
    : typeof series?.lastObservedTime === "string"
    ? series.lastObservedTime
    : typeof item.eventTime === "string"
    ? item.eventTime
    : undefined;
  if (lastSeen !== undefined) event.lastSeen = lastSeen;
  return event;
}

/**
 * Parse the JSON text of `kubectl events -o json` into
 * {@link KubernetesEvent} records. Items carrying neither a reason nor a
 * message are skipped; empty input yields `[]`. Throws if the text is
 * non-empty and not valid JSON.
 */
export function parseEvents(json: string): KubernetesEvent[] {
  const text = json.trim();
  if (text === "") return [];
  const parsed: unknown = JSON.parse(text);
  const items = isRecord(parsed) && Array.isArray(parsed.items)
    ? parsed.items
    : [parsed];
  const events: KubernetesEvent[] = [];
  for (const item of items) {
    const event = parseEvent(item);
    if (event !== null) events.push(event);
  }
  return events;
}

/** The client and server versions {@link parseVersion} reads. */
export interface KubernetesVersion {
  /** The `kubectl` binary's version, e.g. `v1.31.2`. */
  client?: string;
  /** The API server's version, absent when only the client was asked for. */
  server?: string;
}

/**
 * Parse the JSON text of `kubectl version -o json` into the two version
 * strings. A payload that is not an object, or carries neither version,
 * yields an empty record rather than throwing — the versions are advisory.
 */
export function parseVersion(json: string): KubernetesVersion {
  const text = json.trim();
  if (text === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) return {};
  const version: KubernetesVersion = {};
  const client = isRecord(parsed.clientVersion) ? parsed.clientVersion : {};
  const server = isRecord(parsed.serverVersion) ? parsed.serverVersion : {};
  if (typeof client.gitVersion === "string") version.client = client.gitVersion;
  if (typeof server.gitVersion === "string") version.server = server.gitVersion;
  return version;
}
