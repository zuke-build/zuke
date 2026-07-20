import { assertEquals } from "./_assert.ts";
import { targetMatcher, timingSafeEqual } from "../src/mcp/authz.ts";

Deno.test("targetMatcher: undefined patterns match every target", () => {
  const match = targetMatcher(undefined);
  assertEquals(match("deploy"), true);
  assertEquals(match("release.publish"), true);
});

Deno.test("targetMatcher: exact names and globs, spanning dots", () => {
  const match = targetMatcher(["deploy", "checks*"]);
  assertEquals(match("deploy"), true);
  assertEquals(match("deployToProd"), false); // 'deploy' is exact-anchored
  assertEquals(match("checks"), true);
  assertEquals(match("checks.lint"), true); // '*' spans the dot
  assertEquals(match("promote"), false);
});

Deno.test("targetMatcher: an empty list matches nothing", () => {
  const match = targetMatcher([]);
  assertEquals(match("deploy"), false);
});

// `timingSafeEqual` is the constant-time bearer-token comparison used by the
// MCP HTTP transport. For two equal-length inputs the loop always visits every
// character (it accumulates the XOR diff with no early `return`), so a partial
// prefix match leaks no timing signal about how many characters were correct —
// the property that stops a byte-at-a-time token guess. The one deliberate leak
// is the initial `a.length !== b.length` short-circuit: it reveals only the
// length, not the contents, which is an accepted trade-off (a token's length is
// not the secret). These cases pin the value semantics; the constant-time
// property is a structural guarantee of the implementation, not timed here.
Deno.test("timingSafeEqual compares by value, length first", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "ab"), false); // length mismatch
  assertEquals(timingSafeEqual("", ""), true);
});
