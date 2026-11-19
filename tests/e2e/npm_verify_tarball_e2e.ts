// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `npmVerify` compares what npm installs, not what a tar reader of ours sees.
 * Two crafted tarballs, each carrying a clean `package.json` that core's `untar`
 * reads and an evil one (with a postinstall script) that npm unpacks, are put
 * through `verifyAll` with the real `npm install`: both must be a mismatch.
 *
 * The first has a lone zero block between the two files (core's reader stops
 * there, node-tar goes on); the second has the evil file first and a clean file
 * after it whose header checksum is wrong (core's reader ignores checksums and
 * takes the later file). The install is from a local tarball, so it needs npm
 * but no network; the tests are skipped where npm is not on the path.
 *
 * @module
 */

import { absolutePath, gunzip, gzip, untar } from "../../packages/core/mod.ts";
import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  type NpmProbe,
  type NpmSource,
  RELEASE_PROVENANCE,
  verifyAll,
} from "../../build/npm_verify.ts";
import { NpmTasks } from "@zuke/npm";

const SLSA = "https://slsa.dev/provenance/v1";
const enc = new TextEncoder();
const CLEAN = '{"name":"@zuke-build/x","version":"1.0.0"}';
const EVIL =
  '{"name":"@zuke-build/x","version":"1.0.0","scripts":{"postinstall":"echo pwned"}}';

function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  h.set(enc.encode(name), 0);
  h.set(enc.encode("0000644\0"), 100);
  h.set(enc.encode("0000000\0"), 108);
  h.set(enc.encode("0000000\0"), 116);
  h.set(enc.encode(size.toString(8).padStart(11, "0") + "\0"), 124);
  h.set(enc.encode("00000000000\0"), 136);
  h[156] = 0x30;
  h.set(enc.encode("ustar\0"), 257);
  h.set(enc.encode("00"), 263);
  h.fill(0x20, 148, 156);
  const sum = h.reduce((n, b) => n + b, 0);
  h.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  return h;
}

function file(text: string, breakChecksum = false): Uint8Array[] {
  const data = enc.encode(text);
  const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
  body.set(data);
  const head = header("package/package.json", data.length);
  if (breakChecksum) head[148] = 0x37;
  return [head, body];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const ZERO = new Uint8Array(512);
const variants: Record<string, Uint8Array[]> = {
  "a lone zero block hides the evil file from core's reader": [
    ...file(CLEAN),
    ZERO,
    ...file(EVIL),
    ZERO,
    ZERO,
  ],
  "a bad checksum on the clean file lets core's reader take it over the evil one":
    [
      ...file(EVIL),
      ...file(CLEAN, true),
      ZERO,
      ZERO,
    ],
};

function hasNpm(): boolean {
  try {
    return new Deno.Command(Deno.build.os === "windows" ? "npm.cmd" : "npm", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).outputSync().success;
  } catch {
    return false;
  }
}

for (const [name, parts] of Object.entries(variants)) {
  Deno.test({
    name: `verifyAll: ${name}`,
    ignore: !hasNpm(),
    fn: async () => {
      const dir = await Deno.makeTempDir();
      try {
        const tgz = await gzip(concat(parts));
        // The premise: core's reader sees the clean file, so reading the
        // tarball with it would have said "match".
        const seen = untar(await gunzip(tgz));
        assertEquals(
          seen.map((e) => new TextDecoder().decode(e.data)).includes(CLEAN),
          true,
        );
        const file = `${dir}/x.tgz`;
        await Deno.writeFile(file, tgz);
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-512", new Uint8Array(tgz)),
        );
        const integrity = "sha512-" + btoa(String.fromCharCode(...digest));
        const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
          .join("");
        const statement = {
          subject: [{ digest: { sha512: hex } }],
          predicate: {
            buildDefinition: {
              externalParameters: {
                workflow: RELEASE_PROVENANCE,
              },
              resolvedDependencies: [{ digest: { gitCommit: "c" } }],
            },
          },
        };
        const source: NpmSource = {
          document: () =>
            Promise.resolve({
              versions: {
                "1.0.0": {
                  dist: {
                    tarball: "t",
                    integrity,
                    attestations: {
                      url: "u",
                      provenance: { predicateType: SLSA },
                    },
                  },
                },
              },
            }),
          attestations: () =>
            Promise.resolve({
              attestations: [{
                predicateType: SLSA,
                bundle: {
                  dsseEnvelope: { payload: btoa(JSON.stringify(statement)) },
                },
              }],
            }),
          verifyBundle: () => Promise.resolve(),
        };
        // The real npm, from the local tarball in place of the registry.
        const npm: NpmProbe = {
          install: async (project) => {
            await NpmTasks.install((s) =>
              s.cwd(project).packages(`file:${file}`).ignoreScripts().noAudit()
                .noFund()
            );
          },
          auditSignatures: () => Promise.resolve(),
        };
        const results = await verifyAll(new Map([["x", "1.0.0"]]), {
          source,
          npm,
          project: absolutePath(dir)("consumer"),
          rebuilt: () =>
            Promise.resolve(new Map([["package.json", enc.encode(CLEAN)]])),
          skipReason: () => Promise.resolve(null),
          commitOf: () => Promise.resolve("c"),
          allowMissing: false,
          attempts: 1,
          wait: () => Promise.resolve(),
        });
        assertEquals(results.get("x"), {
          status: "mismatch",
          problems: ["package.json: differs from the rebuild."],
          version: "1.0.0",
        });
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
