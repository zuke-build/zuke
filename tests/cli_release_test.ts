// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for the CLI's standalone release: names, checksums, the formula, the
 * plan that decides what a run owes, packaging, and step outputs.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import { gunzip, sha256Hex, untar } from "@zuke/core";
import {
  archiveName,
  attestationName,
  CHECKSUMS,
  checksumsText,
  CLI_TARGETS,
  cliFormula,
  type CliReleaseProbe,
  cliReleaseTag,
  fetchChecksums,
  FIRST_BINARY_VERSION,
  httpCliReleaseProbe,
  MACOS_TARGETS,
  parseChecksums,
  planCliRelease,
  releaseAssetUrl,
} from "../build/cli_release.ts";
import { binaryPath, packageCliArchives } from "../build/cli_package.ts";
import { writeStepOutputs } from "../build/step_outputs.ts";

const VERSION = "1.14.0";

/** A digest per archive of {@link VERSION}, distinct so a mix-up shows. */
function sums(): Map<string, string> {
  return new Map(
    CLI_TARGETS.map((target, i) => [
      archiveName(VERSION, target),
      String(i).repeat(64),
    ]),
  );
}

Deno.test("release names follow the tag release-please cuts", () => {
  assertEquals(cliReleaseTag(VERSION), "cli-v1.14.0");
  assertEquals(
    archiveName(VERSION, CLI_TARGETS[0]),
    "zuke-1.14.0-aarch64-apple-darwin.tar.gz",
  );
  assertEquals(attestationName(VERSION), "zuke-1.14.0.sigstore.json");
  assertEquals(
    releaseAssetUrl(VERSION, CHECKSUMS),
    "https://github.com/zuke-build/zuke/releases/download/cli-v1.14.0/SHA256SUMS",
  );
  // Every platform Homebrew runs on, and only those: the macOS pair is what
  // gets signed.
  assertEquals(CLI_TARGETS.map((t) => `${t.os}/${t.arch}`), [
    "macos/arm",
    "macos/intel",
    "linux/arm",
    "linux/intel",
  ]);
  assertEquals(MACOS_TARGETS.map((t) => t.triple), [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]);
});

Deno.test("checksumsText is sha256sum's format, sorted, and parseChecksums reads it back", () => {
  const text = checksumsText([
    { name: "b.tar.gz", sha256: "b".repeat(64) },
    { name: "a.tar.gz", sha256: "a".repeat(64) },
  ]);
  assertEquals(
    text,
    `${"a".repeat(64)}  a.tar.gz\n${"b".repeat(64)}  b.tar.gz\n`,
  );
  assertEquals(
    [...parseChecksums(text)],
    [["a.tar.gz", "a".repeat(64)], ["b.tar.gz", "b".repeat(64)]],
  );
  // sha256sum's binary-mode marker reads the same.
  assertEquals(
    parseChecksums(`${"c".repeat(64)} *c.tar.gz`).get("c.tar.gz"),
    "c".repeat(64),
  );
});

Deno.test("parseChecksums refuses what it cannot read rather than skipping it", () => {
  for (
    const bad of [
      "not a checksum",
      `${"A".repeat(64)}  upper.tar.gz`,
      `${"a".repeat(63)}  short.tar.gz`,
      `${"a".repeat(64)}  ../escape.tar.gz`,
      `${"a".repeat(64)}  dir/nested.tar.gz`,
      `${"a".repeat(64)}  two words`,
    ]
  ) {
    assertThrows(() => parseChecksums(bad), Error, "not a checksum line");
  }
  assertThrows(
    () =>
      parseChecksums(
        `${"a".repeat(64)}  x.tar.gz\n${"b".repeat(64)}  x.tar.gz`,
      ),
    Error,
    "listed twice",
  );
});

Deno.test("cliFormula pins every archive to its digest, with no version line", () => {
  const formula = cliFormula(VERSION, sums());
  assertStringIncludes(formula, "class Zuke < Formula");
  for (const [i, target] of CLI_TARGETS.entries()) {
    assertStringIncludes(
      formula,
      `url "${releaseAssetUrl(VERSION, archiveName(VERSION, target))}"`,
    );
    assertStringIncludes(formula, `sha256 "${String(i).repeat(64)}"`);
  }
  assertStringIncludes(formula, 'bin.install "zuke"');
  assertStringIncludes(formula, "assert_match version.to_s");
  // The version is detected from the URLs; `brew audit` refuses a line that
  // repeats it.
  assertEquals(/^\s*version "/m.test(formula), false);
});

Deno.test("cliFormula refuses checksums missing an archive", () => {
  const partial = sums();
  partial.delete(archiveName(VERSION, CLI_TARGETS[2]));
  assertThrows(
    () => cliFormula(VERSION, partial),
    Error,
    "lists no zuke-1.14.0-aarch64-unknown-linux-gnu.tar.gz",
  );
});

/** A probe answering from fixed facts, recording what was asked. */
function probe(
  facts: { release: boolean; sums: boolean; tap?: string },
  asked: string[] = [],
): CliReleaseProbe {
  return {
    releaseExists: () => {
      asked.push("release");
      return Promise.resolve(facts.release);
    },
    checksumsPublished: () => {
      asked.push("sums");
      return Promise.resolve(facts.sums);
    },
    tapFormula: () => {
      asked.push("tap");
      return Promise.resolve(facts.tap);
    },
  };
}

Deno.test("planCliRelease owes nothing for a version older than the first binary release", async () => {
  // 1.13.0 predates the CLI's own Homebrew support: its upgrade would put a
  // JSR zuke beside the brewed one, so it must never reach the tap.
  for (const old of ["1.13.0", "1.13.9", "0.9.0"]) {
    const asked: string[] = [];
    const plan = await planCliRelease(
      old,
      probe({ release: true, sums: false }, asked),
    );
    assertEquals([plan.build, plan.tap], [false, false], old);
    assertStringIncludes(
      plan.reason,
      `first binary release (${FIRST_BINARY_VERSION})`,
    );
    assertEquals(asked, [], old);
  }
  const first = await planCliRelease(
    FIRST_BINARY_VERSION,
    probe({ release: true, sums: false }),
  );
  assertEquals(first.build, true);
});

Deno.test("planCliRelease owes nothing before release-please cuts the version", async () => {
  const asked: string[] = [];
  const plan = await planCliRelease(
    VERSION,
    probe({ release: false, sums: false }, asked),
  );
  assertEquals([plan.build, plan.tap], [false, false]);
  assertStringIncludes(plan.reason, "not released yet");
  assertEquals(asked, ["release"]);
});

Deno.test("planCliRelease owes everything while the release lacks SHA256SUMS", async () => {
  const plan = await planCliRelease(
    VERSION,
    probe({ release: true, sums: false }),
  );
  assertEquals([plan.build, plan.tap], [true, true]);
  assertStringIncludes(plan.reason, "no SHA256SUMS");
});

Deno.test("planCliRelease owes only the tap when its formula points elsewhere", async () => {
  for (const tap of [undefined, 'url ".../cli-v1.13.0/zuke-1.13.0-x.tar.gz"']) {
    const plan = await planCliRelease(
      VERSION,
      probe({ release: true, sums: true, tap }),
    );
    assertEquals([plan.build, plan.tap], [false, true], String(tap));
  }
  // A version that merely starts with this one's digits is another release.
  const longer = await planCliRelease(
    "1.14.1",
    probe({ release: true, sums: true, tap: ".../cli-v1.14.10/..." }),
  );
  assertEquals(longer.tap, true);
});

Deno.test("planCliRelease owes nothing once the formula points at the release", async () => {
  const plan = await planCliRelease(
    VERSION,
    probe({
      release: true,
      sums: true,
      tap: `url "${releaseAssetUrl(VERSION, "zuke.tar.gz")}"`,
    }),
  );
  assertEquals([plan.build, plan.tap], [false, false]);
});

/** A fetch answering by URL, recording each request's method and URL. */
function fakeFetch(
  routes: Record<string, Response | (() => Response)>,
  seen: string[] = [],
): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes[url];
    if (route === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(typeof route === "function" ? route() : route);
  };
}

Deno.test("httpCliReleaseProbe reads presence from status codes, without a token", async () => {
  const seen: string[] = [];
  const http = httpCliReleaseProbe(
    VERSION,
    fakeFetch({
      "https://github.com/zuke-build/zuke/releases/tag/cli-v1.14.0":
        new Response(
          null,
          { status: 200 },
        ),
      [releaseAssetUrl(VERSION, CHECKSUMS)]: new Response(null, {
        status: 302,
      }),
      "https://raw.githubusercontent.com/zuke-build/homebrew-tap/main/Formula/zuke.rb":
        new Response("class Zuke < Formula\nend\n"),
    }, seen),
  );
  assertEquals(await http.releaseExists(), true);
  assertEquals(await http.checksumsPublished(), true);
  assertEquals(await http.tapFormula(), "class Zuke < Formula\nend\n");
  // The presence checks never follow the redirect to the asset's storage.
  assertEquals(seen.slice(0, 2).every((r) => r.startsWith("HEAD ")), true);

  const absent = httpCliReleaseProbe(VERSION, fakeFetch({}));
  assertEquals(await absent.releaseExists(), false);
  assertEquals(await absent.checksumsPublished(), false);
  assertEquals(await absent.tapFormula(), undefined);
});

Deno.test("httpCliReleaseProbe fails on an answer that is neither present nor absent", async () => {
  const broken = () => new Response("oops", { status: 500 });
  const http = httpCliReleaseProbe(
    VERSION,
    fakeFetch({
      "https://github.com/zuke-build/zuke/releases/tag/cli-v1.14.0": broken,
      "https://raw.githubusercontent.com/zuke-build/homebrew-tap/main/Formula/zuke.rb":
        broken,
    }),
  );
  await assertRejects(() => http.releaseExists(), Error, "answered 500");
  await assertRejects(() => http.tapFormula(), Error, "answered 500");
});

Deno.test("fetchChecksums parses the published manifest and fails on a missing one", async () => {
  const text = checksumsText([{ name: "a.tar.gz", sha256: "a".repeat(64) }]);
  const read = await fetchChecksums(
    VERSION,
    fakeFetch({ [releaseAssetUrl(VERSION, CHECKSUMS)]: new Response(text) }),
  );
  assertEquals(read.get("a.tar.gz"), "a".repeat(64));
  await assertRejects(
    () => fetchChecksums(VERSION, fakeFetch({})),
    Error,
    "answered 404",
  );
});

Deno.test("packageCliArchives packs each binary executable, with matching checksums", async () => {
  await withTemp(async (dir) => {
    for (const target of CLI_TARGETS) {
      await Deno.mkdir(`${dir}/bin/${target.triple}`, { recursive: true });
      await Deno.writeTextFile(
        binaryPath(`${dir}/bin`, target.triple),
        `binary for ${target.triple}`,
      );
    }
    const out = `${dir}/release`;
    const packed = await packageCliArchives(VERSION, `${dir}/bin`, out);
    assertEquals(
      packed.map((p) => p.name),
      CLI_TARGETS.map((t) => archiveName(VERSION, t)),
    );
    const manifest = parseChecksums(
      await Deno.readTextFile(`${out}/${CHECKSUMS}`),
    );
    for (const { name, sha256 } of packed) {
      const bytes = await Deno.readFile(`${out}/${name}`);
      assertEquals(await sha256Hex(bytes), sha256);
      assertEquals(manifest.get(name), sha256);
      const [entry, ...rest] = untar(await gunzip(bytes));
      assertEquals(rest, []);
      assertEquals(entry.name, "zuke");
      assertStringIncludes(new TextDecoder().decode(entry.data), "binary for");
      // mode 0755 sits in the header's 7 octal digits at offset 100.
      const header = await gunzip(bytes);
      assertEquals(
        new TextDecoder().decode(header.slice(100, 107)),
        "0000755",
      );
    }
    // The same binaries pack to the same bytes.
    const again = await packageCliArchives(VERSION, `${dir}/bin`, `${dir}/2`);
    assertEquals(again, packed);
  });
});

Deno.test("packageCliArchives refuses a release missing a platform", async () => {
  await withTemp(async (dir) => {
    await assertRejects(
      () => packageCliArchives(VERSION, `${dir}/bin`, `${dir}/out`),
      Error,
      "no aarch64-apple-darwin binary to package",
    );
  });
});

Deno.test("writeStepOutputs appends name=value lines, and does nothing off Actions", async () => {
  await withTemp(async (dir) => {
    const file = `${dir}/output`;
    await Deno.writeTextFile(file, "earlier=1\n");
    await writeStepOutputs({ build: "true", version: VERSION }, file);
    assertEquals(
      await Deno.readTextFile(file),
      "earlier=1\nbuild=true\nversion=1.14.0\n",
    );
    await writeStepOutputs({ build: "true" }, undefined);
    await writeStepOutputs({ build: "true" }, "");
  });
});

Deno.test("writeStepOutputs refuses a value that could forge another output", async () => {
  await withTemp(async (dir) => {
    const file = `${dir}/output`;
    const forged: Record<string, string>[] = [
      { build: "true\ntap=true" },
      { build: "x\rtap=true" },
      { "bad name": "x" },
      { "a=b": "x" },
    ];
    for (const values of forged) {
      await assertRejects(
        () => writeStepOutputs(values, file),
        Error,
        "single line",
      );
    }
    assertEquals(await Deno.readTextFile(file).catch(() => ""), "");
  });
});
