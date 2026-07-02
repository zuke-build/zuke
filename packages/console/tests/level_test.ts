import { isLogLevel, LEVEL_ORDER, resolveLevel } from "../src/level.ts";
import { assertEquals } from "../../core/tests/_assert.ts";

Deno.test("isLogLevel recognises the severity ladder", () => {
  assertEquals(isLogLevel("trace"), true);
  assertEquals(isLogLevel("silent"), true);
  assertEquals(isLogLevel("verbose"), false);
});

Deno.test("LEVEL_ORDER is monotonic from trace to silent", () => {
  assertEquals(LEVEL_ORDER.trace < LEVEL_ORDER.debug, true);
  assertEquals(LEVEL_ORDER.info < LEVEL_ORDER.warn, true);
  assertEquals(LEVEL_ORDER.error < LEVEL_ORDER.silent, true);
});

Deno.test("resolveLevel reads ZUKE_LOG_LEVEL case-insensitively", () => {
  assertEquals(
    resolveLevel((n) => (n === "ZUKE_LOG_LEVEL" ? "DEBUG" : undefined)),
    "debug",
  );
  assertEquals(
    resolveLevel((n) => (n === "ZUKE_LOG_LEVEL" ? "error" : undefined)),
    "error",
  );
});

Deno.test("resolveLevel defaults to info when unset or invalid", () => {
  assertEquals(resolveLevel(() => undefined), "info");
  assertEquals(resolveLevel(() => "chatty"), "info");
});
