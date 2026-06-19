import { assertEquals, assertThrows } from "./_assert.ts";
import { manifestVersion, readVersion } from "../src/manifest.ts";

Deno.test("readVersion returns a valid version string", () => {
  assertEquals(readVersion({ version: "1.2.3" }), "1.2.3");
  assertEquals(readVersion({ name: "x", version: "0.0.0" }), "0.0.0");
});

Deno.test("readVersion rejects non-objects", () => {
  assertThrows(() => readVersion("nope"), Error, "must be a JSON object");
  assertThrows(() => readVersion(null), Error, "must be a JSON object");
});

Deno.test("readVersion rejects a missing version field", () => {
  assertThrows(
    () => readVersion({ name: "x" }),
    Error,
    'missing a "version" field',
  );
});

Deno.test("readVersion rejects a non-string version", () => {
  assertThrows(
    () => readVersion({ version: 3 }),
    Error,
    '"version" must be a string',
  );
});

Deno.test("manifestVersion reads and validates a deno.json file", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/deno.json`;
  await Deno.writeTextFile(path, JSON.stringify({ version: "4.5.6" }));
  assertEquals(await manifestVersion(path), "4.5.6");
  await Deno.remove(dir, { recursive: true });
});
