import { assertEquals } from "../../core/tests/_assert.ts";
import {
  decodeState,
  dismissedOf,
  encodeState,
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
