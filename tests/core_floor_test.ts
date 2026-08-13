// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import {
  CORE_PACKAGE,
  type CoreFloor,
  exactFloorSpecifier,
  floorConfig,
  formatFloorFailures,
  isAllowedSpecifier,
  readCoreFloor,
} from "../build/core_floor.ts";

/** A `readText` stand-in serving one package's config from memory. */
function reader(contents: Record<string, string>): (path: string) => string {
  return (path) => {
    const text = contents[path];
    if (text === undefined) throw new Deno.errors.NotFound(path);
    return text;
  };
}

Deno.test("readCoreFloor: extracts the declared specifier and imports", () => {
  const floor = readCoreFloor(
    "gh",
    reader({
      "packages/gh/deno.json": JSON.stringify({
        name: "@zuke/gh",
        imports: { "@zuke/core": "jsr:@zuke/core@^1.31.0" },
      }),
    }),
  );
  assertEquals(floor?.package, "gh");
  assertEquals(floor?.specifier, "jsr:@zuke/core@^1.31.0");
  assertEquals(floor?.imports[CORE_PACKAGE], "jsr:@zuke/core@^1.31.0");
});

Deno.test("readCoreFloor: keeps a package's other imports", () => {
  const floor = readCoreFloor(
    "docs",
    reader({
      "packages/docs/deno.json": JSON.stringify({
        imports: {
          "@zuke/core": "jsr:@zuke/core@^1.25.0",
          "@zuke/deno": "jsr:@zuke/deno@^0.4.0",
        },
      }),
    }),
  );
  assertEquals(floor?.imports["@zuke/deno"], "jsr:@zuke/deno@^0.4.0");
});

Deno.test("readCoreFloor: no core dependency means nothing to verify", () => {
  // Core itself: it has no self-dependency, so it is skipped rather than failed.
  assertEquals(
    readCoreFloor(
      "core",
      reader({ "packages/core/deno.json": JSON.stringify({ imports: {} }) }),
    ),
    undefined,
  );
  assertEquals(
    readCoreFloor(
      "core",
      reader({ "packages/core/deno.json": JSON.stringify({ name: "x" }) }),
    ),
    undefined,
  );
});

Deno.test("readCoreFloor: a config it cannot parse is skipped, not thrown", () => {
  assertEquals(
    readCoreFloor("bad", reader({ "packages/bad/deno.json": "{ not json" })),
    undefined,
  );
  assertEquals(readCoreFloor("missing", reader({})), undefined);
  assertEquals(
    readCoreFloor("null", reader({ "packages/null/deno.json": "null" })),
    undefined,
  );
  assertEquals(
    readCoreFloor(
      "arr",
      reader({ "packages/arr/deno.json": '{"imports": []}' }),
    ),
    undefined,
  );
});

Deno.test("readCoreFloor: a non-string import value is dropped", () => {
  const floor = readCoreFloor(
    "odd",
    reader({
      "packages/odd/deno.json":
        '{"imports": {"@zuke/core": "jsr:@zuke/core@^1.25.0", "bad": 7}}',
    }),
  );
  assertEquals(floor?.imports["bad"], undefined);
  assertEquals(floor?.specifier, "jsr:@zuke/core@^1.25.0");
});

Deno.test("exactFloorSpecifier: pins the minimum of each range operator", () => {
  // The point of the whole check: a caret range would otherwise resolve to the
  // newest matching version and never exercise the declared floor.
  assertEquals(
    exactFloorSpecifier("jsr:@zuke/core@^1.25.0"),
    "jsr:@zuke/core@1.25.0",
  );
  assertEquals(
    exactFloorSpecifier("jsr:@zuke/core@~1.31.2"),
    "jsr:@zuke/core@1.31.2",
  );
  assertEquals(
    exactFloorSpecifier("jsr:@zuke/core@>=1.30.0"),
    "jsr:@zuke/core@1.30.0",
  );
  assertEquals(
    exactFloorSpecifier("jsr:@zuke/core@1.32.1"),
    "jsr:@zuke/core@1.32.1",
  );
  assertEquals(
    exactFloorSpecifier("jsr:@zuke/core@^2.0.0-rc.1"),
    "jsr:@zuke/core@2.0.0-rc.1",
  );
});

Deno.test("exactFloorSpecifier: an ambiguous range has no single minimum", () => {
  // Reported rather than guessed at — a wrong guess would silently check the
  // wrong version and claim the floor verified.
  assertEquals(exactFloorSpecifier("jsr:@zuke/core@*"), undefined);
  assertEquals(exactFloorSpecifier("jsr:@zuke/core@^1"), undefined);
  assertEquals(exactFloorSpecifier("jsr:@zuke/core@1.x"), undefined);
  assertEquals(exactFloorSpecifier("jsr:@zuke/core@>=1.0.0 <2.0.0"), undefined);
  assertEquals(exactFloorSpecifier("jsr:@zuke/core@"), undefined);
  assertEquals(exactFloorSpecifier("no-at-sign"), undefined);
  assertEquals(exactFloorSpecifier("@leading-only"), undefined);
});

Deno.test("floorConfig: pins core, keeps siblings, declares no workspace", () => {
  const floor: CoreFloor = {
    package: "docs",
    specifier: "jsr:@zuke/core@^1.25.0",
    imports: {
      "@zuke/core": "jsr:@zuke/core@^1.25.0",
      "@zuke/deno": "jsr:@zuke/deno@^0.4.0",
    },
  };
  const parsed = JSON.parse(floorConfig(floor, "jsr:@zuke/core@1.25.0"));
  assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@1.25.0");
  assertEquals(parsed.imports["@zuke/deno"], "jsr:@zuke/deno@^0.4.0");
  assertEquals(Object.keys(parsed.imports).length, 2);
  // No workspace field is the mechanism: with one, Deno would substitute the
  // local packages/core member and the check would prove nothing.
  assertEquals("workspace" in parsed, false);
  // Zeroed so a core published in the last day is not refused, which would fail
  // every fresh floor for a day after each release.
  assertEquals(parsed.minimumDependencyAge, 0);
});

Deno.test("isAllowedSpecifier: only workspace registry specifiers pass", () => {
  assertEquals(isAllowedSpecifier("jsr:@zuke/core@^1.25.0"), true);
  assertEquals(isAllowedSpecifier("jsr:@other/pkg@1.0.0"), false);
  assertEquals(isAllowedSpecifier("https://evil.example/payload.ts"), false);
  assertEquals(isAllowedSpecifier("npm:left-pad@1.0.0"), false);
  assertEquals(isAllowedSpecifier("./local.ts"), false);
  // Not a prefix match on a lookalike scope.
  assertEquals(isAllowedSpecifier("jsr:@zuke-evil/core@1.0.0"), false);
});

Deno.test("floorConfig: drops a specifier the check must not fetch", () => {
  // A pull request controls this file, and the check runs with no lockfile, so
  // an arbitrary URL here would make CI fetch it. Only @zuke/* survives.
  const floor: CoreFloor = {
    package: "evil",
    specifier: "jsr:@zuke/core@^1.25.0",
    imports: {
      "@zuke/core": "jsr:@zuke/core@^1.25.0",
      "@zuke/deno": "jsr:@zuke/deno@^0.4.0",
      exfiltrate: "https://evil.example/payload.ts",
      "left-pad": "npm:left-pad@1.0.0",
    },
  };
  const parsed = JSON.parse(floorConfig(floor, "jsr:@zuke/core@1.25.0"));
  assertEquals(parsed.imports["exfiltrate"], undefined);
  assertEquals(parsed.imports["left-pad"], undefined);
  assertEquals(parsed.imports["@zuke/deno"], "jsr:@zuke/deno@^0.4.0");
  assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@1.25.0");
});

Deno.test("floorConfig: the pinned core always wins over the declared range", () => {
  const floor: CoreFloor = {
    package: "gh",
    specifier: "jsr:@zuke/core@^1.31.0",
    imports: { "@zuke/core": "jsr:@zuke/core@^1.31.0" },
  };
  const parsed = JSON.parse(floorConfig(floor, "jsr:@zuke/core@1.31.0"));
  assertEquals(parsed.imports["@zuke/core"], "jsr:@zuke/core@1.31.0");
});

Deno.test("formatFloorFailures: silent when every package passes", () => {
  assertEquals(formatFloorFailures([]), []);
  assertEquals(
    formatFloorFailures([
      { package: "gh", specifier: "jsr:@zuke/core@^1.31.0", ok: true },
    ]),
    [],
  );
});

Deno.test("formatFloorFailures: names the package, its range, and the error", () => {
  const lines = formatFloorFailures([
    { package: "gh", specifier: "jsr:@zuke/core@^1.31.0", ok: true },
    {
      package: "cli",
      specifier: "jsr:@zuke/core@^1.25.0",
      ok: false,
      detail: "TS2305 [ERROR]: has no exported member 'splitShellArgs'.",
    },
  ]);
  const text = lines.join("\n");
  assertEquals(lines[0].includes("1 package(s)"), true);
  assertEquals(
    text.includes("packages/cli declares jsr:@zuke/core@^1.25.0"),
    true,
  );
  assertEquals(text.includes("splitShellArgs"), true);
  // The passing package is not mentioned.
  assertEquals(text.includes("packages/gh"), false);
  // And the guidance explains why a local gate cannot catch this.
  assertEquals(text.includes("workspace resolution"), true);
});

Deno.test("formatFloorFailures: tolerates a failure with no detail", () => {
  const lines = formatFloorFailures([
    { package: "cli", specifier: "jsr:@zuke/core@^1.25.0", ok: false },
  ]);
  assertEquals(lines.some((l) => l.includes("packages/cli")), true);
});
