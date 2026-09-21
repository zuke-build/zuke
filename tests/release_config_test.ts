// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "../packages/core/tests/_assert.ts";
import { PACKAGES as PACKAGE_DIRS } from "../build/packages.ts";

// `build/packages.ts` is the single source of truth for workspace membership —
// `publishJsr` iterates it, so a package missing there is silently never
// published (that is what stranded the AI CLI wrappers on JSR). Deriving the
// `packages/`-prefixed paths from it, rather than keeping a second copy here,
// means the assertions below check the *other* membership lists against the
// real one instead of against a copy that can drift from both.
const PACKAGES = PACKAGE_DIRS.map((dir) => `packages/${dir}`);

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(path));
}

const CONFIG = ".release-please-config.json";

Deno.test("release-please config matches the workspace packages", async () => {
  const config = await readJson(CONFIG);
  const packages = config.packages;
  if (packages === null || typeof packages !== "object") {
    throw new Error("config.packages must be an object");
  }
  assertEquals(Object.keys(packages).sort(), [...PACKAGES].sort());
});

Deno.test("the config uses the simple release type", async () => {
  // release-please has no "deno" releaser; the version lives in each package's
  // deno.json, bumped via the simple releaser plus a json extra-files updater.
  const config = await readJson(CONFIG);
  assertEquals(config["release-type"], "simple");
});

Deno.test("manifest versions match each package deno.json", async () => {
  const manifest = await readJson(".release-please-manifest.json");
  for (const path of PACKAGES) {
    const pkg = await readJson(`${path}/deno.json`);
    assertEquals(
      manifest[path],
      pkg.version,
      `manifest ${path} must match ${path}/deno.json version`,
    );
  }
});

/** One extra-file and the lines in it carrying release-please's inline marker. */
interface MarkedFile {
  /** The package directory that lists the file, e.g. `packages/core`. */
  pkg: string;
  /** The file, repo-relative, for assertion messages. */
  path: string;
  /** Every line in it tagged `x-release-please-version`. */
  lines: string[];
}

/**
 * Every extra-file the release config lists, with its marked lines.
 *
 * Walked once and shared by the two tests below rather than each opening the
 * config for itself: they assert different properties of the same set of
 * lines, and a second copy of the walk is a second thing to keep in step with
 * the config's shape.
 */
async function markedFiles(): Promise<MarkedFile[]> {
  interface ReleaseConfig {
    packages: Record<string, { "extra-files"?: unknown }>;
  }
  const config: ReleaseConfig = JSON.parse(await Deno.readTextFile(CONFIG));
  const files: MarkedFile[] = [];
  for (const [pkg, entry] of Object.entries(config.packages)) {
    const extras = entry["extra-files"];
    if (!Array.isArray(extras)) continue;
    for (const extra of extras) {
      // Object entries are the json updaters, which target deno.json's
      // $.version; only the plain string paths carry an inline marker.
      if (typeof extra !== "string") continue;
      const path = `${pkg}/${extra}`;
      const text = await Deno.readTextFile(path);
      const lines = text.split("\n").filter((line) =>
        line.includes("x-release-please-version")
      );
      files.push({ pkg, path, lines });
    }
  }
  return files;
}

Deno.test("extra-file version markers match the manifest version", async () => {
  // A package may list files beyond its deno.json — @zuke/cli embeds its
  // version in src/version.ts so `zuke --version` can print it. release-please
  // rewrites the line tagged `x-release-please-version`, so a version set by
  // hand (a graduation, a bootstrap) has to update it too or the CLI reports a
  // version it no longer has.
  const manifest = await readJson(".release-please-manifest.json");
  for (const { pkg, path, lines } of await markedFiles()) {
    assertEquals(
      lines.length > 0,
      true,
      `${path} is a release-please extra-file but marks no line ` +
        `with x-release-please-version`,
    );
    for (const line of lines) {
      assertEquals(
        line.includes(`"${manifest[pkg]}"`),
        true,
        `${path} must carry version ${manifest[pkg]}; got: ` + line.trim(),
      );
    }
  }
});

Deno.test("a marked constant declares a widened type", async () => {
  // `export const VERSION = "1.2.3"` declares the *literal* type "1.2.3", and
  // `deno doc` records a declared type verbatim — so an exported one is copied
  // into llms-full.txt and the package README. release-please rewrites the
  // marked line when it cuts a release but cannot run `deno doc`, so those
  // generated files drift on the bump alone and apiDocsCheck fails on the
  // release PR itself. That is exactly how #632 broke: core started exporting
  // its version in #630, and the next release could not pass its own gate.
  //
  // The annotation is what keeps a bump a self-contained edit, so require it
  // on every marked constant rather than only on the ones exported today —
  // whether a package re-exports its version module is a decision that can
  // change later, quietly, and reintroduce this from a file nobody re-read.
  const declaration = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*([^=]*)=/;
  for (const { path, lines } of await markedFiles()) {
    for (const line of lines) {
      const match = declaration.exec(line);
      if (match === null) continue; // not a constant; nothing to widen.
      const [, name, annotation] = match;
      assertEquals(
        annotation.trim().startsWith(":"),
        true,
        `${path} declares ${name} with an inferred literal type; annotate it ` +
          `(\`export const ${name}: string = …\`) so a version bump cannot ` +
          `stale the generated API docs. Got: ${line.trim()}`,
      );
    }
  }
});

Deno.test("every package declares the MIT license", async () => {
  // Per-package license metadata so a published JSR artifact carries its own
  // license rather than relying solely on root inference. Keep it in lock-step
  // with the root LICENSE (MIT).
  for (const path of PACKAGES) {
    const pkg = await readJson(`${path}/deno.json`);
    assertEquals(
      pkg.license,
      "MIT",
      `${path}/deno.json must declare "license": "MIT"`,
    );
  }
});

Deno.test("the deno workspace lists exactly the configured packages", async () => {
  const root = await readJson("deno.json");
  const workspace = root.workspace;
  if (!Array.isArray(workspace)) {
    throw new Error("deno.json workspace must be an array");
  }
  assertEquals(workspace.map(String).sort(), [...PACKAGES].sort());
});

/** The `[\`@zuke/<name>\`](https://jsr.io/@zuke/<name>)` link that heads a matrix row. */
const MATRIX_ROW =
  /^\| \[`@zuke\/([a-z-]+)`\]\(https:\/\/jsr\.io\/@zuke\/\1\)/gm;

Deno.test("the docs package matrix lists exactly the workspace packages", async () => {
  // docs/packages.md is the human-facing catalogue; a package missing there is
  // invisible to anyone browsing the repo, and a row for a package that does
  // not exist (or listed twice) makes the stated count a lie. Enforce exact
  // membership so the lists (workspace, release-please config/manifest, the
  // build/packages.ts publish loop, and the matrix) never drift apart.
  const matrix = await Deno.readTextFile("docs/packages.md");
  const rows = [...matrix.matchAll(MATRIX_ROW)].map((m) => m[1]);
  assertEquals(
    rows.length,
    new Set(rows).size,
    "docs/packages.md lists a package more than once",
  );
  assertEquals([...rows].sort(), [...PACKAGE_DIRS].sort());
});

Deno.test("the README still reaches the package matrix", async () => {
  // The README names only the notable wrappers; the full catalogue lives in
  // docs/packages.md, so the README must keep linking to it or the catalogue
  // becomes unreachable from the landing page.
  const readme = await Deno.readTextFile("README.md");
  assertEquals(
    readme.includes("](./docs/packages.md)"),
    true,
    "README.md no longer links docs/packages.md",
  );
});

Deno.test("deno.lock captures release-please's full npm tree", async () => {
  // `zuke.ts`'s `release` target provisions release-please through a launcher
  // that runs `deno run --frozen npm:release-please@16.18.0` from the repository
  // root (see `installCli`), so the lock is what pins its transitive tree — and
  // `--frozen` fails the release outright if the specifier is missing from the
  // lock. Assert both the top-level pin and one of its transitive dependencies,
  // so a `deno.lock` regenerated without re-caching that specifier (dropping the
  // tree) is caught here rather than at release time.
  const lock = await Deno.readTextFile("deno.lock");
  if (!lock.includes('"npm:release-please@16.18.0"')) {
    throw new Error(
      'deno.lock is missing the "npm:release-please@16.18.0" specifier pin — ' +
        "run `deno cache npm:release-please@16.18.0` and commit the updated lock.",
    );
  }
  if (!lock.includes('"js-yaml@4.3.0"')) {
    throw new Error(
      "deno.lock is missing release-please's transitive npm tree " +
        '(expected "js-yaml@4.3.0") — run ' +
        "`deno cache npm:release-please@16.18.0` and commit the updated lock.",
    );
  }
});

/**
 * The files whose prose quotes the size of the workspace. The package *matrix*
 * is checked above; this is the number written in sentences ("the 58
 * packages", "a 58-package workspace", "(58 total)"), which drifted for months
 * because nothing compared it to the real list.
 */
const PACKAGE_COUNT_PROSE = [
  "README.md",
  "AGENTS.md",
  "RELEASING.md",
  "docs/versioning.md",
  "docs/comparison.md",
  "docs/getting-started.md",
];

/**
 * A number that states the workspace size: `58 packages`, `58 JSR packages`,
 * `58 independent JSR packages`, `58-package`, or `(58 total)`. A `50+`-style
 * lower bound has no trailing count keyword and is deliberately not matched.
 */
const PACKAGE_COUNT =
  /\b(\d+)(?=(?:-package\b| (?:independent )?(?:JSR )?packages\b| total\)))/g;

Deno.test("every prose mention of the package count matches the workspace", async () => {
  const expected = PACKAGE_DIRS.length;
  const wrong: string[] = [];
  for (const path of PACKAGE_COUNT_PROSE) {
    const text = await Deno.readTextFile(path);
    const counts = [...text.matchAll(PACKAGE_COUNT)].map((m) => Number(m[1]));
    assertEquals(
      counts.length > 0,
      true,
      `${path} no longer states the package count; drop it from the list`,
    );
    for (const count of counts) {
      if (count !== expected) wrong.push(`${path}: ${count}`);
    }
  }
  assertEquals(
    wrong,
    [],
    `package count is ${expected}; stale mentions: ${wrong.join(", ")}`,
  );
});
