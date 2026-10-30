// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Readers for untrusted JSON: a {@link Fields} view of one object names the
 * field it rejects and where in the message it sits, so a worker author sees
 * exactly what the engine refused.
 *
 * @module
 */

import { type JsonValue, parseDuration } from "@zuke/core";
import type { Duration } from "./protocol.ts";

/** Whether `value` is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is JSON: what a parsed wire message can hold, nothing else. */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      return Array.isArray(value)
        ? value.every(isJsonValue)
        : Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

/** The shape of a field name a `zuke.ts` build declares. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A view of one untrusted object at `where`, whose readers name the field
 * they reject.
 */
export class Fields {
  constructor(
    private readonly object: Record<string, unknown>,
    /** Where this object sits in the message, the prefix of every rejection. */
    readonly where: string,
  ) {}

  /** Whether the field is present. */
  has(name: string): boolean {
    return this.object[name] !== undefined;
  }

  required(name: string): unknown {
    const value = this.object[name];
    if (value === undefined) {
      throw new Error(`${this.where}: missing field "${name}"`);
    }
    return value;
  }

  string(name: string): string {
    const value = this.required(name);
    if (typeof value !== "string") {
      throw new Error(`${this.where}: field "${name}" must be a string`);
    }
    return value;
  }

  stringOr(name: string, fallback: string): string {
    return this.has(name) ? this.string(name) : fallback;
  }

  stringIfSet(name: string): string | undefined {
    return this.has(name) ? this.string(name) : undefined;
  }

  strings(name: string): string[] {
    const value = this.required(name);
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      throw new Error(
        `${this.where}: field "${name}" must be an array of strings`,
      );
    }
    return value;
  }

  stringsOr(name: string, fallback: string[]): string[] {
    return this.has(name) ? this.strings(name) : fallback;
  }

  stringsIfSet(name: string): string[] | undefined {
    return this.has(name) ? this.strings(name) : undefined;
  }

  number(name: string): number {
    const value = this.required(name);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `${this.where}: field "${name}" must be a non-negative number`,
      );
    }
    return value;
  }

  numberIfSet(name: string): number | undefined {
    return this.has(name) ? this.number(name) : undefined;
  }

  /** A duration core can parse, refused here rather than when it is used. */
  durationIfSet(name: string): Duration | undefined {
    if (!this.has(name)) return undefined;
    const value = this.object[name];
    if (typeof value !== "string" && typeof value !== "number") {
      return this.reject(name, "be a duration string or milliseconds");
    }
    try {
      parseDuration(value);
    } catch {
      return this.reject(name, 'be a duration such as "5m" or milliseconds');
    }
    return value;
  }

  /**
   * A name usable as a build's field: what `zuke.ts` can declare, and what
   * the CLI can derive a flag from.
   */
  identifier(name: string): string {
    const value = this.string(name);
    return IDENTIFIER.test(value)
      ? value
      : this.reject(name, "be an identifier, as a build's field name is");
  }

  booleanOr(name: string, fallback: boolean): boolean {
    if (!this.has(name)) return fallback;
    const value = this.object[name];
    if (typeof value !== "boolean") {
      throw new Error(`${this.where}: field "${name}" must be a boolean`);
    }
    return value;
  }

  booleanIfSet(name: string): boolean | undefined {
    return this.has(name) ? this.booleanOr(name, false) : undefined;
  }

  stringMap(name: string): Record<string, string> {
    const value = this.required(name);
    if (
      !isRecord(value) ||
      !Object.values(value).every((v) => typeof v === "string")
    ) {
      throw new Error(
        `${this.where}: field "${name}" must map strings to strings`,
      );
    }
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] =>
        typeof e[1] === "string"
      ),
    );
  }

  stringMapIfSet(name: string): Record<string, string> | undefined {
    return this.has(name) ? this.stringMap(name) : undefined;
  }

  /** The objects in an array field, each viewed at `where.name[i]`. */
  objects(name: string): Fields[] {
    const value = this.required(name);
    if (!Array.isArray(value)) {
      throw new Error(`${this.where}: field "${name}" must be an array`);
    }
    return value.map((item, i) =>
      fieldsOf(item, `${this.where}.${name}[${i}]`)
    );
  }

  objectsOr(name: string): Fields[] {
    return this.has(name) ? this.objects(name) : [];
  }

  /** The nested object field, viewed at `where.name`, or an empty one. */
  objectOr(name: string): Fields {
    return this.has(name)
      ? fieldsOf(this.required(name), `${this.where}.${name}`)
      : new Fields({}, `${this.where}.${name}`);
  }

  /** The raw value, for a field whose type depends on another. */
  raw(name: string): unknown {
    return this.object[name];
  }

  jsonRecord(name: string): Record<string, JsonValue> {
    const value = this.required(name);
    if (!isRecord(value)) {
      throw new Error(`${this.where}: field "${name}" must be an object`);
    }
    const entries: Array<[string, JsonValue]> = [];
    for (const [key, item] of Object.entries(value)) {
      if (!isJsonValue(item)) {
        throw new Error(`${this.where}: field "${name}.${key}" must be JSON`);
      }
      entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  }

  summaryPairs(name: string): Record<string, string | number> {
    const value = this.required(name);
    if (!isRecord(value)) {
      throw new Error(`${this.where}: field "${name}" must be an object`);
    }
    const entries: Array<[string, string | number]> = [];
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string" && typeof item !== "number") {
        throw new Error(
          `${this.where}: field "${name}.${key}" must be a string or a number`,
        );
      }
      entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  }

  reject(name: string, must: string): never {
    throw new Error(`${this.where}: field "${name}" must ${must}`);
  }
}

/** View `value` as an object at `where`, rejecting anything else. */
export function fieldsOf(value: unknown, where: string): Fields {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return new Fields(value, where);
}
