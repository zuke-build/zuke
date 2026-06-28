import { assertEquals } from "../../core/tests/_assert.ts";
import type { AssessmentFinding } from "../src/types.ts";
import {
  findingFingerprint,
  Suppressions,
  suppressions,
} from "../src/suppress.ts";

/** A minimal finding, overridable per-test. */
function finding(over: Partial<AssessmentFinding> = {}): AssessmentFinding {
  return { title: "SQL injection", severity: "high", ...over };
}

/** A reader seam that always returns the same in-memory body (no real fs). */
function reads(body: string | undefined): (path: string) => Promise<
  string | undefined
> {
  return () => Promise.resolve(body);
}

Deno.test("findingFingerprint is deterministic for the same inputs", () => {
  const a = findingFingerprint("security", finding({ file: "a.ts" }));
  const b = findingFingerprint("security", finding({ file: "a.ts" }));
  assertEquals(a, b);
});

Deno.test("findingFingerprint normalises the title (case and whitespace)", () => {
  const plain = findingFingerprint(
    "security",
    finding({ title: "SQL injection" }),
  );
  const noisy = findingFingerprint(
    "security",
    finding({ title: "  sql   INJECTION \n" }),
  );
  assertEquals(noisy, plain); // trimmed, lowercased, collapsed whitespace
});

Deno.test("findingFingerprint is sensitive to the file", () => {
  const a = findingFingerprint("security", finding({ file: "a.ts" }));
  const b = findingFingerprint("security", finding({ file: "b.ts" }));
  assertEquals(a === b, false);
});

Deno.test("findingFingerprint is sensitive to the assessment kind", () => {
  const sec = findingFingerprint("security", finding({ file: "a.ts" }));
  const cor = findingFingerprint("correctness", finding({ file: "a.ts" }));
  assertEquals(sec === cor, false);
});

Deno.test("findingFingerprint treats a missing file as the empty string", () => {
  const missing = findingFingerprint("security", finding());
  const empty = findingFingerprint("security", finding({ file: "" }));
  assertEquals(missing, empty);
});

Deno.test("findingFingerprint ignores the line number", () => {
  const at10 = findingFingerprint(
    "security",
    finding({ file: "a.ts", line: 10 }),
  );
  const at99 = findingFingerprint(
    "security",
    finding({ file: "a.ts", line: 99 }),
  );
  assertEquals(at10, at99);
});

Deno.test("load_ reads a bare JSON array of fingerprints", async () => {
  const set = await new Suppressions()
    .reader(reads(JSON.stringify(["abc", "def"])))
    .load_();
  assertEquals([...set].sort(), ["abc", "def"]);
});

Deno.test("load_ reads a { fingerprints: [...] } wrapper", async () => {
  const set = await new Suppressions()
    .reader(reads(JSON.stringify({ fingerprints: ["abc", "def"] })))
    .load_();
  assertEquals([...set].sort(), ["abc", "def"]);
});

Deno.test("load_ ignores non-string elements in an array", async () => {
  const set = await new Suppressions()
    .reader(reads('["abc", 7, null, "def", true]'))
    .load_();
  assertEquals([...set].sort(), ["abc", "def"]);
});

Deno.test("load_ ignores non-string elements in a wrapper", async () => {
  const set = await new Suppressions()
    .reader(reads('{"fingerprints": ["abc", 7, "def"]}'))
    .load_();
  assertEquals([...set].sort(), ["abc", "def"]);
});

Deno.test("load_ yields an empty set on malformed JSON", async () => {
  const set = await new Suppressions()
    .reader(reads("{ not json"))
    .load_();
  assertEquals(set.size, 0);
});

Deno.test("load_ yields an empty set when the JSON is a number", async () => {
  const set = await new Suppressions().reader(reads("42")).load_();
  assertEquals(set.size, 0);
});

Deno.test("load_ yields an empty set when the JSON is null", async () => {
  const set = await new Suppressions().reader(reads("null")).load_();
  assertEquals(set.size, 0);
});

Deno.test("load_ yields an empty set when fingerprints is the wrong type", async () => {
  const set = await new Suppressions()
    .reader(reads('{"fingerprints": "abc"}'))
    .load_();
  assertEquals(set.size, 0);
});

Deno.test("load_ yields an empty set when the object has no fingerprints key", async () => {
  const set = await new Suppressions().reader(reads("{}")).load_();
  assertEquals(set.size, 0);
});

Deno.test("load_ unions inline .add fingerprints with the file's", async () => {
  const set = await new Suppressions()
    .add("inline1", "inline2")
    .reader(reads(JSON.stringify(["from-file"])))
    .load_();
  assertEquals([...set].sort(), ["from-file", "inline1", "inline2"]);
});

Deno.test("load_ de-duplicates a fingerprint present both inline and in the file", async () => {
  const set = await new Suppressions()
    .add("dup")
    .reader(reads(JSON.stringify(["dup", "other"])))
    .load_();
  assertEquals([...set].sort(), ["dup", "other"]);
});

Deno.test("load_ uses inline fingerprints when the reader returns undefined", async () => {
  const set = await new Suppressions()
    .add("only-inline")
    .reader(reads(undefined))
    .load_();
  assertEquals([...set], ["only-inline"]);
});

Deno.test("load_ is empty for a missing file and no inline fingerprints", async () => {
  const set = await new Suppressions().reader(reads(undefined)).load_();
  assertEquals(set.size, 0);
});

Deno.test("the default reader returns an empty set for a missing file", async () => {
  // Exercises the real readTextOrUndefined seam without a configured reader.
  const set = await new Suppressions()
    .file(".zuke/does-not-exist-ai-suppress.json")
    .load_();
  assertEquals(set.size, 0);
});

Deno.test("the default reader reads a real suppress file (.file path)", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/ai-suppress.json`;
  try {
    await Deno.writeTextFile(path, JSON.stringify(["on-disk"]));
    const set = await new Suppressions().file(path).load_();
    assertEquals([...set], ["on-disk"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("suppressions() with no lambda returns a plain instance", async () => {
  const s = suppressions();
  assertEquals(s instanceof Suppressions, true);
  const set = await s.reader(reads(undefined)).load_();
  assertEquals(set.size, 0);
});

Deno.test("suppressions() applies the configure lambda", async () => {
  const set = await suppressions((s) =>
    s.add("configured").reader(reads(undefined))
  ).load_();
  assertEquals([...set], ["configured"]);
});
