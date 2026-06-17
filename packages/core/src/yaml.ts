/**
 * A tiny, dependency-free YAML emitter for the structured subset Zuke needs to
 * generate CI configuration: mappings, sequences, and scalars (strings,
 * numbers, booleans, null), with block-literal output for multi-line strings.
 *
 * It is deliberately minimal — there is no parser and no support for anchors,
 * tags, or flow collections beyond empty `{}`/`[]`. Strings are emitted as plain
 * scalars when unambiguous and double-quoted (JSON-escaped) otherwise, so YAML
 * 1.1 pitfalls — a bare `on` or `no` becoming a boolean, a bare `1.20` becoming
 * a number — are quoted away.
 *
 * @module
 */

/** A scalar value emittable as YAML. */
export type YamlScalar = string | number | boolean | null;

/** Any value emittable as YAML: a scalar, a sequence, or a mapping. */
export type YamlValue =
  | YamlScalar
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue | undefined };

/** YAML 1.1 words a plain scalar would be misread as. */
const RESERVED = new Set([
  "true",
  "false",
  "null",
  "yes",
  "no",
  "on",
  "off",
  "~",
]);

/** Whether `s` must be quoted to round-trip as the intended string. */
function needsQuote(s: string): boolean {
  if (s === "") return true;
  if (s.trim() !== s) return true; // leading/trailing whitespace
  if (RESERVED.has(s.toLowerCase())) return true;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return true; // would parse as a number
  return !/^[A-Za-z0-9_./@][A-Za-z0-9_./@ -]*$/.test(s);
}

/** Render a string/key, quoting (JSON-escaped) only when necessary. */
function quoted(s: string): string {
  return needsQuote(s) ? JSON.stringify(s) : s;
}

/** Render an inline scalar token (used after `key:` and `- `). */
function token(value: YamlScalar): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return quoted(value);
}

/** Type guard: a YAML sequence (works around `Array.isArray` + `readonly`). */
function isSeq(value: YamlValue): value is readonly YamlValue[] {
  return Array.isArray(value);
}

/** Type guard: a YAML mapping. */
function isMap(
  value: YamlValue,
): value is { readonly [key: string]: YamlValue | undefined } {
  return typeof value === "object" && value !== null && !isSeq(value);
}

const pad = (indent: number): string => "  ".repeat(indent);

/** Render the lines of a mapping at the given indent level. */
function renderMap(
  map: { readonly [key: string]: YamlValue | undefined },
  indent: number,
): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (value === undefined) continue;
    lines.push(...renderEntry(name, value, indent));
  }
  return lines;
}

/** Render a single `key: value` entry, recursing for containers. */
function renderEntry(name: string, value: YamlValue, indent: number): string[] {
  const prefix = `${pad(indent)}${quoted(name)}:`;
  if (typeof value === "string" && value.includes("\n")) {
    const child = pad(indent + 1);
    const body = value.split("\n").map((l) => l === "" ? "" : child + l);
    return [`${prefix} |`, ...body];
  }
  if (isSeq(value)) {
    return value.length === 0
      ? [`${prefix} []`]
      : [prefix, ...renderSeq(value, indent + 1)];
  }
  if (isMap(value)) {
    const inner = renderMap(value, indent + 1);
    return inner.length === 0 ? [`${prefix} {}`] : [prefix, ...inner];
  }
  return [`${prefix} ${token(value)}`];
}

/** Render the lines of a sequence at the given indent level. */
function renderSeq(seq: readonly YamlValue[], indent: number): string[] {
  const lines: string[] = [];
  for (const item of seq) {
    if (isSeq(item)) {
      lines.push(`${pad(indent)}-`, ...renderSeq(item, indent + 1));
    } else if (isMap(item)) {
      const block = renderMap(item, indent + 1);
      if (block.length === 0) {
        lines.push(`${pad(indent)}- {}`);
      } else {
        // Hang the first key off the dash: "- key: value".
        block[0] = `${pad(indent)}- ${block[0].slice((indent + 1) * 2)}`;
        lines.push(...block);
      }
    } else {
      lines.push(`${pad(indent)}- ${token(item)}`);
    }
  }
  return lines;
}

/** Serialize `value` to a YAML document string (trailing newline included). */
export function toYaml(value: YamlValue): string {
  const lines = isSeq(value)
    ? renderSeq(value, 0)
    : isMap(value)
    ? renderMap(value, 0)
    : [token(value)];
  return lines.join("\n") + "\n";
}
