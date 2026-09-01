// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertRejects } from "./_assert.ts";
import {
  findOutdated,
  formatOutdated,
  isBehind,
  lockedJsrSpecifiers,
} from "../src/outdated.ts";
import { withTemp } from "./_temp.ts";

/** A `fetch` that answers `meta.json` from a name → latest-version map. */
function registryFetch(
  latest: Record<string, string>,
  seen: string[] = [],
): typeof fetch {
  return (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const match = /\/(@[^/]+\/[^/]+)\/meta\.json$/.exec(url);
    const name = match === null ? undefined : match[1];
    const version = name === undefined ? undefined : latest[name];
    if (version === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ scope: "x", latest: version })),
    );
  };
}

/** Write a lock file carrying `specifiers` and return its path. */
async function lockWith(
  dir: string,
  specifiers: Record<string, unknown>,
): Promise<string> {
  const path = `${dir}/deno.lock`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({ version: "5", specifiers }, null, 2),
  );
  return path;
}

Deno.test("lockedJsrSpecifiers reads the jsr entries and skips the rest", () => {
  const text = JSON.stringify({
    specifiers: {
      "jsr:@zuke/git@^1": "1.5.0",
      "jsr:@std/yaml@^1.2.0": "1.2.0",
      "npm:typescript@^5": "5.9.2",
    },
  });
  assertEquals(lockedJsrSpecifiers(text), [
    { specifier: "jsr:@zuke/git@^1", name: "@zuke/git", resolved: "1.5.0" },
    { specifier: "jsr:@std/yaml@^1.2.0", name: "@std/yaml", resolved: "1.2.0" },
  ]);
});

Deno.test("lockedJsrSpecifiers yields nothing for a lock it cannot read", () => {
  // Every shape that is not "an object with a specifiers object of strings":
  // an unreadable lock reports no packages rather than throwing, and the
  // caller distinguishes that from "all current" by the count.
  assertEquals(lockedJsrSpecifiers("{ not json"), []);
  assertEquals(lockedJsrSpecifiers("null"), []);
  assertEquals(lockedJsrSpecifiers("[]").length, 0);
  assertEquals(lockedJsrSpecifiers(JSON.stringify({})), []);
  assertEquals(
    lockedJsrSpecifiers(JSON.stringify({ specifiers: "nope" })),
    [],
  );
  assertEquals(
    lockedJsrSpecifiers(JSON.stringify({ specifiers: { "jsr:@a/b@^1": 3 } })),
    [],
  );
  // A bare (unscoped) jsr specifier is not a package JSR can be asked about.
  assertEquals(
    lockedJsrSpecifiers(JSON.stringify({ specifiers: { "jsr:nope@^1": "1" } })),
    [],
  );
});

Deno.test("lockedJsrSpecifiers keeps a specifier written without a range", () => {
  assertEquals(
    lockedJsrSpecifiers(
      JSON.stringify({ specifiers: { "jsr:@zuke/git": "1.5.0" } }),
    ),
    [{ specifier: "jsr:@zuke/git", name: "@zuke/git", resolved: "1.5.0" }],
  );
});

Deno.test("isBehind orders versions numerically, not lexically", () => {
  assertEquals(isBehind("1.9.0", "1.10.0"), true); // the string sort's mistake
  assertEquals(isBehind("1.10.0", "1.9.0"), false);
  assertEquals(isBehind("1.5.0", "1.11.0"), true);
  assertEquals(isBehind("1.2.3", "1.2.3"), false);
  assertEquals(isBehind("1.2.3", "2.0.0"), true);
  assertEquals(isBehind("2.0.0", "1.99.99"), false);
  assertEquals(isBehind("1.2.3", "1.2.4"), true);
});

Deno.test("isBehind puts a prerelease behind the release it precedes", () => {
  assertEquals(isBehind("1.2.0-rc.1", "1.2.0"), true);
  assertEquals(isBehind("1.2.0", "1.2.0-rc.1"), false);
  // Two prereleases of the same core cannot be ordered by the numeric core
  // alone, so they are reported as not behind rather than guessed at.
  assertEquals(isBehind("1.2.0-rc.1", "1.2.0-rc.2"), false);
});

Deno.test("isBehind reports a version it cannot parse as not behind", () => {
  // Silence beats a wrong "you are behind", which would send someone bumping
  // a pin that is already current.
  assertEquals(isBehind("latest", "1.2.3"), false);
  assertEquals(isBehind("1.2.3", "unknown"), false);
  assertEquals(isBehind("1.2", "1.3"), false);
});

Deno.test("findOutdated reports only the packages that are behind", async () => {
  await withTemp(async (dir) => {
    const lockPath = await lockWith(dir, {
      "jsr:@zuke/git@^1": "1.5.0",
      "jsr:@zuke/core@^1": "1.42.1",
      "npm:typescript@^5": "5.9.2",
    });
    const seen: string[] = [];
    const behind = await findOutdated({
      lockPath,
      registry: "https://registry.test",
      fetch: registryFetch(
        { "@zuke/git": "1.11.0", "@zuke/core": "1.42.1" },
        seen,
      ),
    });
    assertEquals(behind, [{
      name: "@zuke/git",
      specifier: "jsr:@zuke/git@^1",
      resolved: "1.5.0",
      latest: "1.11.0",
    }]);
    // The npm specifier is never asked about, and each jsr package once.
    assertEquals(seen, [
      "https://registry.test/@zuke/git/meta.json",
      "https://registry.test/@zuke/core/meta.json",
    ]);
  });
});

Deno.test("findOutdated asks the registry once per package name", async () => {
  await withTemp(async (dir) => {
    // Two ranges resolving to different versions of one package: one request,
    // both stale specifiers reported, so the caller sees which pin to move.
    const lockPath = await lockWith(dir, {
      "jsr:@std/yaml@*": "1.1.1",
      "jsr:@std/yaml@^1.2.0": "1.2.0",
    });
    const seen: string[] = [];
    const behind = await findOutdated({
      lockPath,
      registry: "https://registry.test",
      fetch: registryFetch({ "@std/yaml": "1.3.0" }, seen),
    });
    assertEquals(seen.length, 1);
    assertEquals(behind.map((p) => p.resolved), ["1.1.1", "1.2.0"]);
    assertEquals(behind.every((p) => p.latest === "1.3.0"), true);
  });
});

Deno.test("findOutdated skips a package the registry cannot answer for", async () => {
  await withTemp(async (dir) => {
    // A private scope, a rename, or an offline runner. The report still speaks
    // for the packages it could reach.
    const lockPath = await lockWith(dir, {
      "jsr:@private/thing@^1": "1.0.0",
      "jsr:@zuke/git@^1": "1.5.0",
    });
    const behind = await findOutdated({
      lockPath,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.11.0" }),
    });
    assertEquals(behind.map((p) => p.name), ["@zuke/git"]);
  });
});

Deno.test("findOutdated skips a meta document with no usable latest", async () => {
  await withTemp(async (dir) => {
    const lockPath = await lockWith(dir, { "jsr:@zuke/git@^1": "1.5.0" });
    const bodies = ["null", "{}", JSON.stringify({ latest: 7 })];
    for (const body of bodies) {
      const behind = await findOutdated({
        lockPath,
        registry: "https://registry.test",
        fetch: () => Promise.resolve(new Response(body)),
      });
      assertEquals(behind, [], body);
    }
  });
});

Deno.test("findOutdated names the missing lock rather than reporting nothing", async () => {
  await withTemp(async (dir) => {
    // "Nothing is behind" and "I never read a lock" must not look the same.
    await assertRejects(
      () => findOutdated({ lockPath: `${dir}/absent.lock` }),
      Error,
      "no lock file at",
    );
  });
});

Deno.test("formatOutdated aligns the report and says how to refresh", () => {
  assertEquals(
    formatOutdated([]),
    "Every JSR package the lock resolves is at its latest release.",
  );
  const one = formatOutdated([
    {
      name: "@zuke/git",
      specifier: "jsr:@zuke/git@^1",
      resolved: "1.5.0",
      latest: "1.11.0",
    },
  ]);
  assertEquals(one.includes("@zuke/git  1.5.0  →  1.11.0"), true);
  assertEquals(one.includes("1 package is behind"), true);
  // The refresh hint is the part that is not obvious: --reload=jsr: hands back
  // the same versions from cached registry metadata.
  assertEquals(one.includes("--reload=jsr:"), true);

  const two = formatOutdated([
    {
      name: "@zuke/git",
      specifier: "jsr:@zuke/git@^1",
      resolved: "1.5.0",
      latest: "1.11.0",
    },
    {
      name: "@zuke/gcloud",
      specifier: "jsr:@zuke/gcloud@^1",
      resolved: "1.1.0",
      latest: "1.3.0",
    },
  ]);
  assertEquals(two.includes("2 packages are behind"), true);
  // Padded to the longest name, so the versions line up.
  assertEquals(two.includes("@zuke/git     1.5.0"), true);
});
