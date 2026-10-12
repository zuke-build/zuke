// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for parsing `brew info --json=v2`, against a document shaped like
 * the one Homebrew prints, and for the field-naming failures.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { parseBrewInfo } from "../src/brew_info.ts";

/** A trimmed `brew info --json=v2 --formula jq app` document. */
const DOCUMENT = JSON.stringify({
  formulae: [
    {
      name: "jq",
      full_name: "jq",
      tap: "homebrew/core",
      oldnames: [],
      desc: "Lightweight and flexible command-line JSON processor",
      license: "MIT",
      homepage: "https://jqlang.github.io/jq/",
      versions: { stable: "1.7.1", head: "HEAD", bottle: true },
      installed: [
        { version: "1.7", used_options: [], built_as_bottle: true },
        { version: "1.7.1", used_options: [], built_as_bottle: true },
      ],
      linked_keg: "1.7.1",
      outdated: false,
    },
    {
      name: "app",
      full_name: "acme/tap/app",
      tap: "acme/tap",
      desc: null,
      homepage: "https://example.com",
      versions: { stable: "1.2.3", head: null, bottle: false },
      installed: [],
      linked_keg: null,
      outdated: true,
    },
  ],
  casks: [],
});

Deno.test("brew info: formulae, versions and installed versions are typed", () => {
  assertEquals(parseBrewInfo(DOCUMENT), {
    formulae: [
      {
        name: "jq",
        fullName: "jq",
        tap: "homebrew/core",
        desc: "Lightweight and flexible command-line JSON processor",
        homepage: "https://jqlang.github.io/jq/",
        versions: { stable: "1.7.1", head: "HEAD", bottle: true },
        installed: ["1.7", "1.7.1"],
        linkedKeg: "1.7.1",
        outdated: false,
      },
      {
        name: "app",
        fullName: "acme/tap/app",
        tap: "acme/tap",
        desc: null,
        homepage: "https://example.com",
        versions: { stable: "1.2.3", head: null, bottle: false },
        installed: [],
        linkedKeg: null,
        outdated: true,
      },
    ],
  });
});

Deno.test("brew info: a document of another shape names the field", () => {
  const entry = {
    name: "app",
    full_name: "app",
    versions: { stable: "1" },
    installed: [],
  };
  const cases: Array<[unknown, string]> = [
    [{}, "formulae is missing"],
    [[], "formulae is missing"],
    [{ formulae: [1] }, "formulae[] is missing"],
    [{ formulae: [{ ...entry, name: 1 }] }, "name is missing"],
    [
      { formulae: [{ ...entry, full_name: undefined }] },
      "full_name is missing",
    ],
    [{ formulae: [{ ...entry, versions: [] }] }, "versions is missing"],
    [{ formulae: [{ ...entry, installed: {} }] }, "installed is missing"],
    [{ formulae: [{ ...entry, installed: ["1"] }] }, "installed[] is missing"],
    [{ formulae: [{ ...entry, tap: 3 }] }, "tap is missing"],
    [
      { formulae: [{ ...entry, versions: { stable: 1 } }] },
      "stable is missing",
    ],
  ];
  for (const [document, message] of cases) {
    assertThrows(
      () => parseBrewInfo(JSON.stringify(document)),
      Error,
      message,
    );
  }
  // Absent optional fields read as null and false.
  assertEquals(parseBrewInfo(JSON.stringify({ formulae: [entry] })), {
    formulae: [{
      name: "app",
      fullName: "app",
      tap: null,
      desc: null,
      homepage: null,
      versions: { stable: "1", head: null, bottle: false },
      installed: [],
      linkedKeg: null,
      outdated: false,
    }],
  });
});

Deno.test("brew info: output that is not JSON is reported with a prefix of it", () => {
  assertThrows(
    () => parseBrewInfo("Error: No available formula with the name"),
    Error,
    "not JSON: Error: No available formula",
  );
});
