// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tests for publishing a CLI release: the upload's order and idempotence, the
 * formula the verify and tap stages build from the published checksums, the
 * macOS signature check, and the tap write — against a fake GitHub.
 *
 * @module
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../packages/core/tests/_assert.ts";
import { withTemp } from "../packages/core/tests/_temp.ts";
import { gzip, tar } from "@zuke/core";
import { CommandOutput } from "@zuke/core/shell";
import {
  type CodesignDisplay,
  CodesignDisplaySettings,
  CodesignVerifySettings,
} from "@zuke/apple";
import { HomebrewVerifySettings } from "@zuke/homebrew";
import {
  publishCliFormula,
  type SignatureTools,
  uploadCliRelease,
  verifyCliFormula,
  verifyMacSignature,
  writeCliFormula,
} from "../build/cli_publish.ts";
import {
  archiveName,
  CHECKSUMS,
  checksumsText,
  CLI_TARGETS,
  MACOS_TARGETS,
  releaseAssetUrl,
  windowsArchiveName,
} from "../build/cli_release.ts";

const VERSION = "1.14.0";

/** A manifest with a distinct digest per archive. */
function manifest(): string {
  return checksumsText(
    CLI_TARGETS.map((target, i) => ({
      name: archiveName(VERSION, target),
      sha256: String(i).repeat(64),
    })),
  );
}

/** A request as the fake saw it. */
interface Seen {
  method: string;
  url: string;
  body?: string;
}

/** A fake fetch: `answer` decides each response, every request is recorded. */
function fakeFetch(
  answer: (request: Seen) => Response,
  seen: Seen[] = [],
): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const request = { method: init?.method ?? "GET", url, body };
    seen.push(request);
    return await Promise.resolve(answer(request));
  };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.test("uploadCliRelease uploads the archives and attestation, and SHA256SUMS last", async () => {
  await withTemp(async (dir) => {
    for (const target of CLI_TARGETS) {
      await Deno.writeTextFile(`${dir}/${archiveName(VERSION, target)}`, "a");
    }
    await Deno.writeTextFile(`${dir}/${windowsArchiveName(VERSION)}`, "a");
    await Deno.writeTextFile(`${dir}/${CHECKSUMS}`, manifest());
    await Deno.writeTextFile(`${dir}/bundle.json`, "{}");
    const seen: Seen[] = [];
    await uploadCliRelease({
      version: VERSION,
      dir,
      attestation: `${dir}/bundle.json`,
      token: "ghs_token",
      fetch: fakeFetch((request) => {
        if (request.method === "GET") {
          return json({
            id: 7,
            tag_name: "cli-v1.14.0",
            upload_url:
              "https://uploads.github.com/repos/zuke-build/zuke/releases/7/assets{?name,label}",
            assets: [],
          });
        }
        return json({ browser_download_url: "https://example" }, 201);
      }, seen),
    });
    const uploads = seen.filter((r) => r.method === "POST").map((r) =>
      new URL(r.url).searchParams.get("name")
    );
    assertEquals(uploads, [
      ...CLI_TARGETS.map((t) => archiveName(VERSION, t)),
      "zuke-1.14.0-x86_64-pc-windows-msvc.zip",
      "zuke-1.14.0.sigstore.json",
      CHECKSUMS,
    ]);
    // Every lookup names this release, in this repository.
    for (const get of seen.filter((r) => r.method === "GET")) {
      assertEquals(
        get.url,
        "https://api.github.com/repos/zuke-build/zuke/releases/tags/cli-v1.14.0",
      );
    }
  });
});

Deno.test("uploadCliRelease fails when the release does not exist", async () => {
  await withTemp(async (dir) => {
    await Deno.writeTextFile(`${dir}/bundle.json`, "{}");
    await assertRejects(
      () =>
        uploadCliRelease({
          version: VERSION,
          dir,
          attestation: `${dir}/bundle.json`,
          token: "ghs_token",
          fetch: fakeFetch(() => json({ message: "Not Found" }, 404)),
        }),
      Error,
      "404",
    );
  });
});

/** A fetch serving the release's published manifest. */
function serving(text: string, seen: Seen[] = []): typeof fetch {
  return fakeFetch(
    (request) =>
      request.url === releaseAssetUrl(VERSION, CHECKSUMS)
        ? new Response(text)
        : new Response("", { status: 404 }),
    seen,
  );
}

Deno.test("writeCliFormula renders the formula from the published checksums", async () => {
  await withTemp(async (dir) => {
    const path = `${dir}/zuke.rb`;
    const formula = await writeCliFormula(VERSION, path, serving(manifest()));
    assertEquals(await Deno.readTextFile(path), formula);
    assertStringIncludes(formula, `sha256 "${"3".repeat(64)}"`);
  });
});

Deno.test("verifyCliFormula installs the published formula, checking signatures only on macOS", async () => {
  await withTemp(async (dir) => {
    const systems: Array<typeof Deno.build.os> = ["linux", "darwin"];
    for (const os of systems) {
      const verified: string[][] = [];
      const signatures: string[] = [];
      await verifyCliFormula(VERSION, `${dir}/zuke.rb`, {
        homebrew: {
          verify: (configure) => {
            const settings = configure(new HomebrewVerifySettings());
            verified.push([
              settings.formulaFile_ ?? "",
              settings.name_ ?? "",
            ]);
            return Promise.resolve();
          },
        },
        signatures: (version) => {
          signatures.push(version);
          return Promise.resolve();
        },
        fetch: serving(manifest()),
        os,
      });
      assertEquals(verified, [[`${dir}/zuke.rb`, "zuke"]], os);
      assertEquals(signatures, os === "darwin" ? [VERSION] : [], os);
    }
  });
});

/** A published macOS archive whose `zuke` holds `text`. */
async function archiveOf(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await gzip(
    tar([{ name: "zuke", data: new TextEncoder().encode(text), mode: 0o755 }]),
  );
  return new Uint8Array(bytes);
}

/** Fake `codesign` reporting `authorities` for every binary. */
function codesign(
  authorities: string[],
  verified: string[] = [],
): SignatureTools {
  return {
    verify: (configure) => {
      verified.push(configure(new CodesignVerifySettings()).argv().join(" "));
      return Promise.resolve();
    },
    display: (configure) => {
      configure(new CodesignDisplaySettings());
      const display: CodesignDisplay = {
        authorities,
        text: "",
        output: new CommandOutput(0, "", ""),
      };
      return Promise.resolve(display);
    },
  };
}

/** A fetch serving each macOS archive. */
async function servingArchives(): Promise<typeof fetch> {
  const archives = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const target of MACOS_TARGETS) {
    archives.set(
      releaseAssetUrl(VERSION, archiveName(VERSION, target)),
      await archiveOf(target.triple),
    );
  }
  return fakeFetch((request) => {
    const body = archives.get(request.url);
    return body === undefined
      ? new Response("", { status: 404 })
      : new Response(body);
  });
}

Deno.test("verifyMacSignature checks each published macOS binary's Developer ID signature", async () => {
  const verified: string[] = [];
  await verifyMacSignature(
    VERSION,
    await servingArchives(),
    codesign(["Developer ID Application: Zuke (TEAM123456)"], verified),
  );
  assertEquals(verified.length, MACOS_TARGETS.length);
  for (const line of verified) assertStringIncludes(line, "--verify --strict");
});

Deno.test("verifyMacSignature refuses a binary not signed with a Developer ID", async () => {
  for (const authorities of [[], ["Apple Development: someone (ABC)"]]) {
    await assertRejects(
      () =>
        verifyMacSignature(
          VERSION,
          fakeFetch(() => new Response("", { status: 404 })),
          codesign(authorities),
        ),
      Error,
      "answered 404",
    );
    await assertRejects(
      async () =>
        verifyMacSignature(
          VERSION,
          await servingArchives(),
          codesign(authorities),
        ),
      Error,
      "not signed with a Developer ID",
    );
  }
});

Deno.test("verifyMacSignature refuses an archive without a zuke binary", async () => {
  const empty = new Uint8Array(await gzip(tar([])));
  await assertRejects(
    () =>
      verifyMacSignature(
        VERSION,
        fakeFetch(() => new Response(empty)),
        codesign(["Developer ID Application: Zuke (TEAM123456)"]),
      ),
    Error,
    "holds no zuke",
  );
});

Deno.test("publishCliFormula writes Formula/zuke.rb to the tap's main branch", async () => {
  const seen: Seen[] = [];
  const github = fakeFetch((request) => {
    if (request.url === releaseAssetUrl(VERSION, CHECKSUMS)) {
      return new Response(manifest());
    }
    if (request.method === "GET") return json({ message: "Not Found" }, 404);
    return json({ commit: { sha: "c0de" }, content: { sha: "b10b" } }, 201);
  }, seen);
  await publishCliFormula(VERSION, "ghs_tap", github);
  const put = seen.find((r) => r.method === "PUT");
  assertEquals(
    put?.url,
    "https://api.github.com/repos/zuke-build/homebrew-tap/contents/Formula/zuke.rb",
  );
  const body: unknown = JSON.parse(put?.body ?? "{}");
  assertEquals(
    typeof body === "object" && body !== null && "branch" in body &&
      "message" in body
      ? [body.branch, body.message]
      : [],
    ["main", "zuke 1.14.0"],
  );
});
