import { assertEquals } from "./_assert.ts";
import { REDACTED, Redactor } from "../src/redact.ts";

Deno.test("Redactor masks a registered secret anywhere in a line", () => {
  const r = new Redactor();
  r.add("s3cr3t");
  assertEquals(
    r.redact("token=s3cr3t sent to s3cr3t-host"),
    `token=${REDACTED} sent to ${REDACTED}-host`,
  );
});

Deno.test("Redactor ignores empty strings and de-duplicates", () => {
  const r = new Redactor();
  r.add("");
  r.add("abc");
  r.add("abc");
  assertEquals(r.size, 1);
  // An empty secret must not turn every position into the placeholder.
  assertEquals(r.redact("nothing here"), "nothing here");
});

Deno.test("Redactor leaves lines without a secret untouched", () => {
  const r = new Redactor();
  r.add("hunter2");
  assertEquals(r.redact("plain output"), "plain output");
});

Deno.test("Redactor masks the longest overlapping secret whole", () => {
  const r = new Redactor();
  // Registered short-first, but a value containing another must still be
  // masked as one unit, not leave the outer part exposed.
  r.add("abc");
  r.add("abcdef");
  assertEquals(r.redact("value abcdef here"), `value ${REDACTED} here`);
});

Deno.test("Redactor treats regex-significant secrets literally", () => {
  const r = new Redactor();
  r.add("a.c*");
  assertEquals(r.redact("literal a.c* only"), `literal ${REDACTED} only`);
  // A line that would match the pattern as a regex, but does not contain it
  // literally, is left untouched.
  assertEquals(r.redact("nothing to mask"), "nothing to mask");
});
