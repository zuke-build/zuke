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
