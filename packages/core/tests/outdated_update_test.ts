// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `src/outdated_update.ts` — dropping lock entries so the next
 * resolution moves them, and reporting what actually moved.
 *
 * Hermetic: the registry is a fake `fetch` and the re-resolution is injected,
 * so nothing here touches the network or spawns `deno`.
 */

import {
  dropLockEntries,
  formatUpdate,
  updateOutdated,
} from "../src/outdated_update.ts";
import { assertEquals, assertStringIncludes } from "./_assert.ts";

/** A lock resolving two JSR packages, one of them pinned exactly. */
function lockText(git = "1.2.0", yaml = "1.0.5"): string {
  return JSON.stringify(
    {
      version: "5",
      specifiers: {
        "jsr:@zuke/git@^1": git,
        "jsr:@std/yaml@1.0.5": yaml,
      },
      jsr: {
        [`@zuke/git@${git}`]: { integrity: "aaa" },
        [`@std/yaml@${yaml}`]: { integrity: "bbb" },
      },
    },
    null,
    2,
  );
}

/** A registry whose `latest` is taken from `latest`, keyed by package name. */
function registryFetch(latest: Record<string, string>): typeof fetch {
  return (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const name = decodeURIComponent(
      url.pathname.replace(/^\//, "").replace(/\/meta\.json$/, ""),
    );
    const version = latest[name];
    if (version === undefined) {
      return Promise.resolve(new Response("no", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ latest: version }), { status: 200 }),
    );
  };
}

/** Run `fn` with a temporary lock file, returning its final text. */
async function withLock(
  text: string,
  fn: (path: string) => Promise<void>,
): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "zuke-lock-" });
  const path = `${dir}/deno.lock`;
  try {
    await Deno.writeTextFile(path, text);
    await fn(path);
    return await Deno.readTextFile(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("dropLockEntries removes the named package's specifier and integrity", () => {
  const out = JSON.parse(dropLockEntries(lockText(), ["@zuke/git"]));
  assertEquals(Object.keys(out.specifiers), ["jsr:@std/yaml@1.0.5"]);
  assertEquals(Object.keys(out.jsr), ["@std/yaml@1.0.5"]);
});

Deno.test("dropLockEntries leaves a package it was not asked about alone", () => {
  const out = JSON.parse(dropLockEntries(lockText(), ["@zuke/git"]));
  assertEquals(out.specifiers["jsr:@std/yaml@1.0.5"], "1.0.5");
});

Deno.test("dropLockEntries matches on the package name, not the key prefix", () => {
  // `@zuke/git-lfs` starts with `@zuke/git`; dropping one must not drop it.
  const text = JSON.stringify({
    specifiers: {
      "jsr:@zuke/git@^1": "1.2.0",
      "jsr:@zuke/git-lfs@^1": "1.0.0",
    },
    jsr: { "@zuke/git@1.2.0": {}, "@zuke/git-lfs@1.0.0": {} },
  });
  const out = JSON.parse(dropLockEntries(text, ["@zuke/git"]));
  assertEquals(Object.keys(out.specifiers), ["jsr:@zuke/git-lfs@^1"]);
  assertEquals(Object.keys(out.jsr), ["@zuke/git-lfs@1.0.0"]);
});

Deno.test("dropLockEntries refuses a lock it did not understand", () => {
  // Strict where the reporting path is tolerant: this one overwrites the file.
  for (const bad of ["not json", "[]", '{"no":"specifiers"}']) {
    let threw = false;
    try {
      dropLockEntries(bad, ["@zuke/git"]);
    } catch {
      threw = true;
    }
    assertEquals(threw, true, `should have refused: ${bad}`);
  }
});

Deno.test("updateOutdated moves a package whose range admits the release", async () => {
  const final = await withLock(lockText(), async (path) => {
    const report = await updateOutdated({
      lockPath: path,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.9.0", "@std/yaml": "1.0.5" }),
      // Stand in for `deno install`: resolve the dropped entry to the latest.
      resolve: async (p) => {
        const lock = JSON.parse(await Deno.readTextFile(p));
        lock.specifiers["jsr:@zuke/git@^1"] = "1.9.0";
        await Deno.writeTextFile(p, JSON.stringify(lock, null, 2));
      },
    });
    assertEquals(report.updated, [
      { name: "@zuke/git", from: "1.2.0", to: "1.9.0" },
    ]);
    assertEquals(report.held, []);
  });
  assertEquals(JSON.parse(final).specifiers["jsr:@zuke/git@^1"], "1.9.0");
});

Deno.test("updateOutdated reports a package its specifier pins as held", async () => {
  await withLock(lockText(), async (path) => {
    const report = await updateOutdated({
      lockPath: path,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.2.0", "@std/yaml": "1.3.0" }),
      // An exact specifier resolves to the same version however often you ask,
      // so re-resolution puts the entry back exactly as it was.
      resolve: async (p) => {
        const lock = JSON.parse(await Deno.readTextFile(p));
        lock.specifiers["jsr:@std/yaml@1.0.5"] = "1.0.5";
        await Deno.writeTextFile(p, JSON.stringify(lock, null, 2));
      },
    });
    assertEquals(report.updated, []);
    assertEquals(report.held, [{
      name: "@std/yaml",
      resolved: "1.0.5",
      latest: "1.3.0",
      specifier: "jsr:@std/yaml@1.0.5",
    }]);
  });
});

Deno.test("updateOutdated restores the lock when re-resolution fails", async () => {
  // The failure mode that matters: a half-dropped lock fails every --frozen
  // run, so a failed update must not leave one behind.
  const before = lockText();
  let failed = false;
  const final = await withLock(before, async (path) => {
    try {
      await updateOutdated({
        lockPath: path,
        registry: "https://registry.test",
        fetch: registryFetch({ "@zuke/git": "1.9.0", "@std/yaml": "1.0.5" }),
        resolve: () => Promise.reject(new Error("network down")),
      });
    } catch (error) {
      failed = true;
      assertStringIncludes(String(error), "network down");
    }
  });
  assertEquals(failed, true);
  assertEquals(final, before);
});

Deno.test("updateOutdated narrows to the named packages", async () => {
  await withLock(lockText(), async (path) => {
    const report = await updateOutdated({
      lockPath: path,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.9.0", "@std/yaml": "1.3.0" }),
      only: ["@zuke/git"],
      resolve: async (p) => {
        const lock = JSON.parse(await Deno.readTextFile(p));
        lock.specifiers["jsr:@zuke/git@^1"] = "1.9.0";
        await Deno.writeTextFile(p, JSON.stringify(lock, null, 2));
      },
    });
    assertEquals(report.updated.map((p) => p.name), ["@zuke/git"]);
    // @std/yaml is behind too, but was not asked for.
    assertEquals(report.held, []);
  });
});

Deno.test("updateOutdated rejects a name the lock does not resolve", async () => {
  await withLock(lockText(), async (path) => {
    let message = "";
    try {
      await updateOutdated({
        lockPath: path,
        registry: "https://registry.test",
        fetch: registryFetch({ "@zuke/git": "1.9.0", "@std/yaml": "1.0.5" }),
        only: ["@zuke/nope"],
        resolve: () => Promise.resolve(),
      });
    } catch (error) {
      message = String(error);
    }
    assertStringIncludes(message, "@zuke/nope");
  });
});

Deno.test("updateOutdated does nothing when nothing is behind", async () => {
  const before = lockText();
  const final = await withLock(before, async (path) => {
    const report = await updateOutdated({
      lockPath: path,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.2.0", "@std/yaml": "1.0.5" }),
      resolve: () => Promise.reject(new Error("must not re-resolve")),
    });
    assertEquals(report, { updated: [], held: [], unchecked: [] });
  });
  assertEquals(final, before);
});

Deno.test("formatUpdate names what moved and what held it back", () => {
  const text = formatUpdate({
    updated: [{ name: "@zuke/git", from: "1.2.0", to: "1.9.0" }],
    held: [{
      name: "@std/yaml",
      resolved: "1.0.5",
      latest: "1.3.0",
      specifier: "jsr:@std/yaml@1.0.5",
    }],
    unchecked: [],
  });
  assertStringIncludes(text, "@zuke/git");
  assertStringIncludes(text, "1.2.0");
  assertStringIncludes(text, "1.9.0");
  assertStringIncludes(text, "jsr:@std/yaml@1.0.5");
  assertStringIncludes(text, "widen the range");
});

Deno.test("formatUpdate says so when there was nothing to do", () => {
  assertEquals(
    formatUpdate({ updated: [], held: [], unchecked: [] }),
    "Nothing to update.",
  );
});

Deno.test("formatUpdate still reports packages it could not check", () => {
  const text = formatUpdate({
    updated: [],
    held: [],
    unchecked: [{ name: "@private/x", resolved: "1.0.0", reason: "404" }],
  });
  assertStringIncludes(text, "@private/x");
  assertStringIncludes(text, "404");
});

Deno.test("updateOutdated restores the lock if re-resolution loses an entry", async () => {
  // The success-path twin of the failure case above: re-resolution is what
  // puts a dropped entry back, so one that returns without doing so would
  // leave the lock incomplete, and every --frozen run fails on that.
  const before = lockText();
  let message = "";
  const final = await withLock(before, async (path) => {
    try {
      await updateOutdated({
        lockPath: path,
        registry: "https://registry.test",
        fetch: registryFetch({ "@zuke/git": "1.9.0", "@std/yaml": "1.0.5" }),
        resolve: () => Promise.resolve(), // returns, but writes nothing back
      });
    } catch (error) {
      message = String(error);
    }
  });
  assertStringIncludes(message, "@zuke/git");
  assertStringIncludes(message, "restored unchanged");
  assertEquals(final, before);
});

Deno.test("updateOutdated accepts a resolver that normalises the specifier", async () => {
  // Deno rewrites the range it records — a dropped `jsr:@zuke/git@^1.0.0`
  // comes back as `jsr:@zuke/git@1` — so the entry is matched by package name.
  // Keyed on the old specifier, this would report the package as lost and roll
  // a perfectly good update back.
  const text = JSON.stringify({
    version: "5",
    specifiers: { "jsr:@zuke/git@^1.0.0": "1.2.0" },
    jsr: { "@zuke/git@1.2.0": { integrity: "aaa" } },
  });
  await withLock(text, async (path) => {
    const report = await updateOutdated({
      lockPath: path,
      registry: "https://registry.test",
      fetch: registryFetch({ "@zuke/git": "1.9.0" }),
      resolve: async (p) => {
        const lock = JSON.parse(await Deno.readTextFile(p));
        lock.specifiers["jsr:@zuke/git@1"] = "1.9.0";
        await Deno.writeTextFile(p, JSON.stringify(lock, null, 2));
      },
    });
    assertEquals(report.updated, [
      { name: "@zuke/git", from: "1.2.0", to: "1.9.0" },
    ]);
  });
});
