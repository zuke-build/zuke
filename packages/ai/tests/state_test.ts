import { assertEquals } from "../../core/tests/_assert.ts";
import {
  aliasIndex,
  decodeState,
  dismissedOf,
  encodeState,
  MAX_ALIASES,
  mergeAliases,
  type ReviewState,
} from "../src/state.ts";

const STATE: ReviewState = {
  findings: [
    {
      id: "abc123",
      title: "SQL injection in query builder",
      severity: "high",
      status: "dismissed",
      file: "src/db.ts",
      rationale: "parameterised upstream",
      author: "maintainer",
    },
    {
      id: "def456",
      title: "Missing await",
      severity: "medium",
      status: "open",
    },
    {
      id: "ghi789",
      title: "Weak hash",
      severity: "low",
      status: "upheld",
      rationale: "rebuttal did not address the collision path",
    },
  ],
};

Deno.test("state round-trips through the hidden comment block", () => {
  const block = encodeState(STATE);
  // The block is a single hidden HTML comment — inert in rendered Markdown.
  assertEquals(block.startsWith("<!-- zuke-ai-state:"), true);
  assertEquals(block.endsWith(" -->"), true);
  const decoded = decodeState(`## report\n\nsome text\n${block}`);
  assertEquals(decoded, STATE);
});

Deno.test("state content cannot break out of the hidden block", () => {
  // A title embedding `-->` (and marker-ish text) must not terminate the HTML
  // comment early — base64 makes the payload inert by construction.
  const hostile: ReviewState = {
    findings: [{
      id: "x",
      title: "evil --> <script>alert(1)</script> <!-- zuke-ai-state:AAAA -->",
      severity: "low",
      status: "dismissed",
    }],
  };
  const block = encodeState(hostile);
  assertEquals(block.includes("script"), false);
  assertEquals(
    decodeState(block)?.findings[0].title,
    hostile.findings[0].title,
  );
});

Deno.test("decodeState is best-effort on garbage", () => {
  assertEquals(decodeState("no block here"), undefined);
  assertEquals(
    decodeState("<!-- zuke-ai-state:!!!not-base64!!! -->"),
    undefined,
  );
  // Valid base64, invalid JSON.
  assertEquals(
    decodeState(`<!-- zuke-ai-state:${btoa("not json")} -->`),
    undefined,
  );
  // Valid JSON, wrong shape.
  assertEquals(
    decodeState(`<!-- zuke-ai-state:${btoa('{"findings":"nope"}')} -->`),
    undefined,
  );
});

Deno.test("decodeState skips malformed entries but keeps valid ones", () => {
  const mixed = JSON.stringify({
    findings: [
      { id: "ok1", title: "kept", severity: "high", status: "open" },
      { id: 42, title: "bad id", severity: "high", status: "open" },
      { id: "bad-status", title: "t", severity: "high", status: "muted" },
      {
        id: "ok2",
        title: "odd severity",
        severity: "wild",
        status: "dismissed",
      },
      "not an object",
    ],
  });
  const decoded = decodeState(`<!-- zuke-ai-state:${btoa(mixed)} -->`);
  assertEquals(decoded?.findings.length, 2);
  assertEquals(decoded?.findings[0].id, "ok1");
  // An unknown severity degrades to "low" rather than dropping the record.
  assertEquals(decoded?.findings[1], {
    id: "ok2",
    title: "odd severity",
    severity: "low",
    status: "dismissed",
  });
});

Deno.test("state survives non-ASCII titles", () => {
  const unicode: ReviewState = {
    findings: [{
      id: "u1",
      title: "naïve — “smart” quotes 🧨",
      severity: "medium",
      status: "dismissed",
    }],
  };
  assertEquals(decodeState(encodeState(unicode)), unicode);
});

Deno.test("fixed findings round-trip, and the per-status views select correctly", async () => {
  const { fixedOf, openOf } = await import("../src/state.ts");
  const state: ReviewState = {
    findings: [
      { id: "a", title: "open one", severity: "high", status: "open" },
      { id: "b", title: "upheld one", severity: "medium", status: "upheld" },
      { id: "c", title: "done", severity: "high", status: "fixed" },
      { id: "d", title: "refuted", severity: "low", status: "dismissed" },
    ],
  };
  assertEquals(decodeState(encodeState(state)), state);
  // openOf: awaiting action — open AND upheld; fixedOf: only fixed.
  assertEquals([...openOf(state).keys()], ["a", "b"]);
  assertEquals([...fixedOf(state).keys()], ["c"]);
  assertEquals(fixedOf(undefined).size, 0);
  assertEquals(openOf(undefined).size, 0);
});

Deno.test("dismissedOf keys only the dismissed findings", () => {
  const dismissed = dismissedOf(STATE);
  assertEquals(dismissed.size, 1);
  assertEquals(dismissed.get("abc123")?.author, "maintainer");
  assertEquals(dismissedOf(undefined).size, 0);
});

Deno.test("aliases round-trip through the state block", () => {
  const state = {
    findings: [{
      id: "abc1",
      title: "Eval of user input",
      severity: "high" as const,
      status: "dismissed" as const,
      aliases: ["def2", "0a9f"],
    }],
  };
  assertEquals(decodeState(encodeState(state)), state);
});

Deno.test("a state written before aliases existed round-trips unchanged", () => {
  // Old comments carry no `aliases` key, and a new one must not sprout an
  // empty list: that would churn every state block on the first new run.
  const state = {
    findings: [{
      id: "abc1",
      title: "Eval of user input",
      severity: "high" as const,
      status: "open" as const,
    }],
  };
  const decoded = decodeState(encodeState(state));
  assertEquals(decoded, state);
  assertEquals("aliases" in (decoded?.findings[0] ?? {}), false);
});

Deno.test("a malformed alias list is dropped, never the record", () => {
  const entry = {
    id: "abc1",
    title: "t",
    severity: "high",
    status: "dismissed",
  };
  const cases: unknown[] = [
    "not-a-list",
    [["nested"], 42, null],
    ["NOT BASE36!", "../etc/passwd"],
    ["abc1"], // its own id — an entry cannot be an alias of itself
  ];
  for (const aliases of cases) {
    const encoded = encodeState(
      // deno-lint-ignore no-explicit-any -- a hand-edited/corrupt state block
      { findings: [{ ...entry, aliases }] } as any,
    );
    const decoded = decodeState(encoded);
    assertEquals(decoded?.findings.length, 1); // the finding survives
    assertEquals(decoded?.findings[0].id, "abc1");
    assertEquals(decoded?.findings[0].aliases ?? [], []);
  }
  // A well-formed entry among the junk is still kept.
  const mixed = encodeState(
    // deno-lint-ignore no-explicit-any -- a partially corrupt alias list
    { findings: [{ ...entry, aliases: ["0c12", 42] }] } as any,
  );
  assertEquals(decodeState(mixed)?.findings[0].aliases, ["0c12"]);
});

Deno.test("an alias list is capped so the state block cannot grow forever", () => {
  const many = ["a1", "b2", "c3", "d4", "e5", "f6", "a7"];
  const merged = mergeAliases(many, ["9ee1"], "own");
  assertEquals(merged.length, MAX_ALIASES);
  assertEquals(merged[0], "9ee1"); // newest survives the cap, oldest is dropped
});

Deno.test("mergeAliases de-duplicates and never records the entry's own id", () => {
  assertEquals(mergeAliases(["aa"], ["aa"], "own"), ["aa"]);
  assertEquals(mergeAliases(["own"], ["own"], "own"), []);
  assertEquals(mergeAliases(undefined, ["bb"], "own"), ["bb"]);
});

Deno.test("aliasIndex maps every alias to its owner across statuses", () => {
  const state = {
    findings: [
      {
        id: "aa11",
        title: "dismissed one",
        severity: "high" as const,
        status: "dismissed" as const,
        aliases: ["bb22"],
      },
      {
        id: "cc33",
        title: "fixed one",
        severity: "low" as const,
        status: "fixed" as const,
        aliases: ["dd44"],
      },
      {
        id: "ee55",
        title: "open one",
        severity: "low" as const,
        status: "open" as const,
        aliases: ["ff66"],
      },
    ],
  };
  const index = aliasIndex(state);
  assertEquals(index.get("bb22")?.id, "aa11");
  assertEquals(index.get("dd44")?.id, "cc33");
  // Open entries count too: a reopened finding would otherwise re-pay for the
  // same rewording on every later round.
  assertEquals(index.get("ff66")?.id, "ee55");
  assertEquals(aliasIndex(undefined).size, 0);
});

Deno.test("an alias never shadows a real finding's identity", () => {
  const state = {
    findings: [
      {
        id: "aa11",
        title: "claims the other's id as its alias",
        severity: "high" as const,
        status: "dismissed" as const,
        aliases: ["bb22"],
      },
      {
        id: "bb22",
        title: "a live finding",
        severity: "high" as const,
        status: "open" as const,
      },
    ],
  };
  assertEquals(aliasIndex(state).has("bb22"), false);
});

Deno.test("aliases do not leak into the status maps", () => {
  // dismissedOf/openOf/fixedOf are consumed by `.values()` for the prompt's
  // prior-findings block and the fixed table; an alias key would duplicate
  // every one of those lines.
  const state = {
    findings: [{
      id: "aa11",
      title: "one finding",
      severity: "high" as const,
      status: "dismissed" as const,
      aliases: ["bb22", "cc33"],
    }],
  };
  assertEquals(dismissedOf(state).size, 1);
});
