// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The launchers of a build another SDK hosts. The rendered text is checked
 * on every OS; on Linux and macOS the bash launcher is also run, against a
 * release served on loopback whose archive holds a fake `zuke` script, so
 * the download, the checksum and the cache are proven without the network.
 * The PowerShell launcher runs for real in the e2e suite, against a compiled
 * `zuke` on Windows (`tests/e2e/embedded_engine_e2e.ts`).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { withTemp } from "../../core/tests/_temp.ts";
import { gzip, sha256Hex, tar } from "@zuke/core";
import {
  BINARY_LAUNCHER_MARKER,
  binaryLauncherBash,
  binaryLauncherPwsh,
} from "../src/binary_launcher.ts";
import {
  BINARY_INSTALL_DOCS,
  BINARY_POSIX_TARGETS,
  type BinaryPin,
} from "../src/binary_pin.ts";
import { testPin } from "./_fakes.ts";

const DOWNLOAD = { download: true };
const PLAIN = { download: false };

Deno.test("both binary launchers name no tool outside the project's own stack", () => {
  for (const options of [DOWNLOAD, PLAIN]) {
    for (
      const script of [
        binaryLauncherBash(options, testPin()),
        binaryLauncherPwsh(options, testPin()),
      ]
    ) {
      assertEquals(/deno|node|npm/i.test(script), false, script);
      assertStringIncludes(script, BINARY_LAUNCHER_MARKER);
      assertStringIncludes(script, "# SPDX-License-Identifier: MIT");
    }
  }
});

Deno.test("the download launchers pin the release and each platform's digest", () => {
  const pin = testPin("2.4.0");
  const bash = binaryLauncherBash(DOWNLOAD, pin);
  assertStringIncludes(bash, 'ZUKE_VERSION="2.4.0"');
  for (const target of BINARY_POSIX_TARGETS) {
    assertStringIncludes(
      bash,
      `    ${target})\n      echo "${pin.checksums[target]}" ;;`,
    );
  }
  assertStringIncludes(bash, "/cli-v${ZUKE_VERSION}/${asset}");
  const pwsh = binaryLauncherPwsh(DOWNLOAD, pin);
  assertStringIncludes(pwsh, '$ZukeVersion = "2.4.0"');
  assertStringIncludes(
    pwsh,
    `$ZukeSha256 = "${pin.checksums["x86_64-pc-windows-msvc"]}"`,
  );
  // Neither trusts a moving target or an unverified download.
  for (const script of [bash, pwsh]) {
    assertEquals(script.includes("latest"), false);
  }
});

Deno.test("both launchers hand zuke the forwarding switch and their own root", () => {
  for (const options of [DOWNLOAD, PLAIN]) {
    const bash = binaryLauncherBash(options, testPin());
    assertStringIncludes(
      bash,
      'dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"',
    );
    assertStringIncludes(
      bash,
      'export ZUKE_FORWARDED=1\nexport ZUKE_LAUNCHER_ROOT="$dir"\nexec "$zuke_bin" "$@"\n',
    );
    const pwsh = binaryLauncherPwsh(options, testPin());
    assertStringIncludes(
      pwsh,
      '$env:ZUKE_FORWARDED = "1"\n$env:ZUKE_LAUNCHER_ROOT = $dir\n& $zuke @args\nexit $LASTEXITCODE\n',
    );
  }
});

Deno.test("the plain launchers fail closed, naming where to get zuke", () => {
  const bash = binaryLauncherBash(PLAIN, testPin());
  assertStringIncludes(bash, "if ! command -v zuke >/dev/null 2>&1; then");
  assertStringIncludes(bash, BINARY_INSTALL_DOCS);
  assertEquals(bash.includes("curl"), false);
  const pwsh = binaryLauncherPwsh(PLAIN, testPin());
  assertStringIncludes(pwsh, BINARY_INSTALL_DOCS);
  assertEquals(pwsh.includes("Invoke-WebRequest"), false);
});

/** The fake `zuke`: prints its arguments, and the two switches it was handed. */
const FAKE_ZUKE = `#!/bin/sh
echo "args:$*"
echo "forwarded:$ZUKE_FORWARDED"
echo "root:$ZUKE_LAUNCHER_ROOT"
`;

/**
 * Serve `archive` as `zuke` `version`'s archive for this platform on
 * loopback, run `fn` with the release base URL, and stop serving.
 */
async function withRelease(
  version: string,
  archive: Uint8Array,
  fn: (base: string, hits: () => number) => Promise<void>,
): Promise<void> {
  let hits = 0;
  const wanted = `/cli-v${version}/zuke-${version}-${Deno.build.target}.tar.gz`;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      if (new URL(request.url).pathname !== wanted) {
        return new Response("not found", { status: 404 });
      }
      hits++;
      return new Response(new Uint8Array(archive));
    },
  );
  try {
    await fn(`http://127.0.0.1:${server.addr.port}`, () => hits);
  } finally {
    await server.shutdown();
  }
}

/** A pin whose every POSIX digest is `sha256`, so this platform's is too. */
function pinFor(version: string, sha256: string): BinaryPin {
  return {
    ...testPin(version),
    checksums: {
      "aarch64-apple-darwin": sha256,
      "x86_64-apple-darwin": sha256,
      "aarch64-unknown-linux-gnu": sha256,
      "x86_64-unknown-linux-gnu": sha256,
      "x86_64-pc-windows-msvc": sha256,
    },
  };
}

/** Run the bash launcher in `dir` with `args`, under `env` on top of this process's. */
async function runLauncher(
  dir: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; out: string; err: string }> {
  const { code, stdout, stderr } = await new Deno.Command("bash", {
    args: [`${dir}/zuke`, ...args],
    cwd: dir,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code, out: decode(stdout), err: decode(stderr) };
}

const POSIX = Deno.build.os !== "windows";

Deno.test({
  name:
    "the bash launcher downloads the pinned release once, verified, then runs it",
  ignore: !POSIX,
  fn: () =>
    withTemp(async (dir) => {
      const archive = await gzip(tar([{
        name: "zuke",
        data: new TextEncoder().encode(FAKE_ZUKE),
        mode: 0o755,
      }]));
      const pin = pinFor("2.4.0", await sha256Hex(archive));
      const project = await Deno.realPath(await Deno.makeTempDir({ dir }));
      await Deno.writeTextFile(
        `${project}/zuke`,
        binaryLauncherBash(DOWNLOAD, pin),
      );
      await withRelease("2.4.0", archive, async (base, hits) => {
        const env = { ZUKE_INSTALL: `${dir}/install`, ZUKE_RELEASES_URL: base };
        const first = await runLauncher(project, ["ci", "--list"], env);
        assertEquals(first.code, 0, first.err);
        assertStringIncludes(first.err, "zuke 2.4.0 is not here yet");
        assertStringIncludes(first.out, "args:ci --list\n");
        assertStringIncludes(first.out, "forwarded:1\n");
        assertStringIncludes(first.out, `root:${project}\n`);
        // Kept, so the second run downloads nothing and says nothing.
        const second = await runLauncher(project, ["test"], env);
        assertEquals(second.code, 0, second.err);
        assertEquals(second.err, "");
        assertStringIncludes(second.out, "args:test\n");
        assertEquals(hits(), 1);
      });
    }, { prefix: "zuke-binary-launcher-" }),
});

Deno.test({
  name:
    "the bash launcher refuses an archive whose digest is not the pinned one, and keeps nothing",
  ignore: !POSIX,
  fn: () =>
    withTemp(async (dir) => {
      const archive = await gzip(tar([{
        name: "zuke",
        data: new TextEncoder().encode(FAKE_ZUKE),
        mode: 0o755,
      }]));
      const project = await Deno.realPath(await Deno.makeTempDir({ dir }));
      await Deno.writeTextFile(
        `${project}/zuke`,
        binaryLauncherBash(DOWNLOAD, pinFor("2.4.0", "f".repeat(64))),
      );
      await withRelease("2.4.0", archive, async (base) => {
        const ran = await runLauncher(project, ["ci"], {
          ZUKE_INSTALL: `${dir}/install`,
          ZUKE_RELEASES_URL: base,
        });
        assertEquals(ran.code, 1);
        assertStringIncludes(ran.err, "checksum mismatch");
        assertEquals(ran.out, "");
      });
      let kept = true;
      try {
        await Deno.stat(`${dir}/install/releases/2.4.0/zuke`);
      } catch {
        kept = false;
      }
      assertEquals(kept, false);
    }, { prefix: "zuke-binary-launcher-" }),
});

Deno.test({
  name: "the plain bash launcher runs the zuke on PATH, or exits 1 without one",
  ignore: !POSIX,
  fn: () =>
    withTemp(async (dir) => {
      const project = await Deno.realPath(await Deno.makeTempDir({ dir }));
      await Deno.writeTextFile(
        `${project}/zuke`,
        binaryLauncherBash(PLAIN, testPin()),
      );
      const bin = `${dir}/bin`;
      await Deno.mkdir(bin);
      // dirname, and the shell the fake runs on, from the system's own PATH.
      const system = "/usr/bin:/bin";
      const missing = await runLauncher(project, ["ci"], {
        PATH: `${bin}:${system}`,
      });
      assertEquals(missing.code, 1);
      assertStringIncludes(missing.err, "the zuke command is not on PATH");
      await Deno.writeTextFile(`${bin}/zuke`, FAKE_ZUKE, { mode: 0o755 });
      const found = await runLauncher(project, ["ci"], {
        PATH: `${bin}:${system}`,
      });
      assertEquals(found.code, 0, found.err);
      assertStringIncludes(found.out, "args:ci\nforwarded:1\n");
    }, { prefix: "zuke-binary-launcher-" }),
});
