// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import {
  DENO_INSTALL_DOCS,
  launcherBash,
  launcherPwsh,
} from "../src/launcher.ts";
import {
  DENO_PIN,
  type DenoPin,
  denoReleaseTag,
  POSIX_TARGETS,
  WINDOWS_TARGETS,
} from "../src/deno_pin.ts";

const BOOTSTRAP = { bootstrapDeno: true };
const PLAIN = { bootstrapDeno: false };

/** A well-formed lowercase 64-character hex SHA-256. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** A pin with recognisable, obviously fake values. */
const FAKE_PIN: DenoPin = {
  version: "9.9.9",
  checksums: {
    "x86_64-unknown-linux-gnu": "a".repeat(64),
    "aarch64-unknown-linux-gnu": "b".repeat(64),
    "x86_64-apple-darwin": "c".repeat(64),
    "aarch64-apple-darwin": "d".repeat(64),
    "x86_64-pc-windows-msvc": "e".repeat(64),
    "aarch64-pc-windows-msvc": "f".repeat(64),
  },
};

Deno.test("the pin carries a well-formed checksum for every target", () => {
  assertEquals(denoReleaseTag(DENO_PIN), `v${DENO_PIN.version}`);
  assertEquals(/^\d+\.\d+\.\d+$/.test(DENO_PIN.version), true);
  const targets = Object.keys(DENO_PIN.checksums).sort();
  // The two launchers between them cover every pinned target, exactly once.
  assertEquals(targets, [...POSIX_TARGETS, ...WINDOWS_TARGETS].sort());
  for (const [target, hash] of Object.entries(DENO_PIN.checksums)) {
    assertEquals(SHA256_RE.test(hash), true, `${target}: "${hash}"`);
  }
});

Deno.test("both variants carry a shebang, the license header, and run zuke.ts", () => {
  for (const options of [BOOTSTRAP, PLAIN]) {
    const bash = launcherBash(options);
    assertEquals(bash.startsWith("#!/usr/bin/env bash\n# Copyright"), true);
    assertStringIncludes(bash, "# SPDX-License-Identifier: MIT");
    assertStringIncludes(bash, "run -A zuke.ts");
    const pwsh = launcherPwsh(options);
    assertEquals(pwsh.startsWith("#!/usr/bin/env pwsh\n# Copyright"), true);
    assertStringIncludes(pwsh, "# SPDX-License-Identifier: MIT");
    assertStringIncludes(pwsh, "zuke.ts");
  }
});

Deno.test("the plain launchers fail closed when Deno is missing", () => {
  // No install script, no download: report the missing Deno and point at the
  // one command to run. This is the variant for a project that must never
  // fetch a tool from its build entry point.
  for (const script of [launcherBash(PLAIN), launcherPwsh(PLAIN)]) {
    assertEquals(script.includes("deno.land/install"), false);
    assertEquals(script.includes("| sh"), false);
    assertEquals(script.includes("Invoke-Expression"), false);
    assertEquals(script.includes("Invoke-WebRequest"), false);
    assertEquals(script.includes("curl"), false);
    assertEquals(script.includes("DEFAULT_DENO_VERSION"), false);
    assertEquals(script.includes("DefaultDenoVersion"), false);
    assertStringIncludes(script, "Deno not found on PATH");
    assertStringIncludes(script, DENO_INSTALL_DOCS);
  }
});

Deno.test("the bootstrap bash launcher pins the release and every POSIX checksum", () => {
  const bash = launcherBash(BOOTSTRAP);
  assertStringIncludes(
    bash,
    `DEFAULT_DENO_VERSION="${denoReleaseTag(DENO_PIN)}"`,
  );
  for (const target of POSIX_TARGETS) {
    assertStringIncludes(
      bash,
      `    ${target})\n      echo "${DENO_PIN.checksums[target]}" ;;`,
    );
  }
  for (const target of WINDOWS_TARGETS) {
    assertEquals(bash.includes(DENO_PIN.checksums[target]), false);
  }
  // Download from the release page, verify, never run an install script.
  assertStringIncludes(
    bash,
    "https://github.com/denoland/deno/releases/download/",
  );
  assertEquals(bash.includes("deno.land/install"), false);
  assertEquals(bash.includes("| sh"), false);
  assertStringIncludes(bash, "DENO_VERSION=latest is not supported");
  assertStringIncludes(bash, `if [ "$actual_sha256" != "$expected_sha256" ]`);
  // The bootstrapped Deno goes on PATH for the tools the build provisions.
  assertStringIncludes(bash, 'export PATH="$(dirname "$deno_bin"):$PATH"');
});

Deno.test("the bootstrap PowerShell launcher pins the release and every Windows checksum", () => {
  const pwsh = launcherPwsh(BOOTSTRAP);
  assertStringIncludes(pwsh, `$DefaultDenoVersion = "${DENO_PIN.version}"`);
  for (const target of WINDOWS_TARGETS) {
    assertStringIncludes(
      pwsh,
      `"${target}"`,
    );
    assertStringIncludes(pwsh, `= "${DENO_PIN.checksums[target]}"`);
  }
  for (const target of POSIX_TARGETS) {
    assertEquals(pwsh.includes(DENO_PIN.checksums[target]), false);
  }
  assertEquals(pwsh.includes("deno.land/install"), false);
  assertEquals(pwsh.includes("Invoke-Expression"), false);
  assertStringIncludes(pwsh, `if ($denoVersion -eq "latest")`);
  assertStringIncludes(pwsh, "DENO_VERSION=latest is not supported");
  assertStringIncludes(pwsh, "Get-FileHash -Path $archive -Algorithm SHA256");
  // PowerShell sources are kept ASCII: no em dash anywhere in the script.
  assertEquals(pwsh.includes("—"), false);
});

Deno.test("the launchers render whatever pin they are given", () => {
  // The pin is a parameter, so a Deno bump is a data change and the rendered
  // scripts follow it — no hash or version is baked into the template text.
  const bash = launcherBash(BOOTSTRAP, FAKE_PIN);
  assertStringIncludes(bash, 'DEFAULT_DENO_VERSION="v9.9.9"');
  assertStringIncludes(bash, `echo "${"a".repeat(64)}" ;;`);
  assertStringIncludes(bash, "(e.g. v9.9.9)");
  assertEquals(bash.includes(DENO_PIN.version), false);
  const pwsh = launcherPwsh(BOOTSTRAP, FAKE_PIN);
  assertStringIncludes(pwsh, '$DefaultDenoVersion = "9.9.9"');
  assertStringIncludes(pwsh, `= "${"f".repeat(64)}"`);
  assertEquals(pwsh.includes(DENO_PIN.version), false);
});

Deno.test("launchers pass --frozen only once a deno.lock exists", () => {
  // A fresh scaffold has no lockfile, and `deno run --frozen` against a
  // missing one fails outright rather than writing it — so an unconditional
  // --frozen breaks the very first `./zuke` the CLI tells the user to run.
  // Every --frozen must therefore sit behind a lockfile check, with a
  // plain (lock-writing) invocation as the other branch.
  for (const options of [BOOTSTRAP, PLAIN]) {
    const bash = launcherBash(options);
    const check = bash.indexOf("if [ -f deno.lock ]; then");
    assertEquals(check > 0, true);
    const tail = bash.slice(check);
    assertEquals(tail.split("run -A --frozen zuke.ts").length - 1, 1);
    assertEquals(tail.split(`run -A zuke.ts "$@"`).length - 1, 1);
    // The frozen branch comes first, the lock-writing branch after the `else`.
    assertEquals(tail.indexOf("--frozen") < tail.indexOf("else\n"), true);
    assertEquals(
      tail.indexOf("else\n") < tail.indexOf(`run -A zuke.ts "$@"`),
      true,
    );
    // No invocation outside that check passes --frozen.
    assertEquals(bash.split("--frozen zuke.ts").length - 1, 1);

    const pwsh = launcherPwsh(options);
    assertStringIncludes(pwsh, `Test-Path (Join-Path $dir "deno.lock")`);
    assertEquals(pwsh.split(`$denoArgs += "--frozen"`).length - 1, 1);
    // --frozen is only ever appended inside that check, never in the base argv.
    assertStringIncludes(pwsh, `@("run", "-A")`);
  }
});

Deno.test("the unfrozen branch says so, so a deleted lockfile is not silent", () => {
  // Skipping --frozen is correct on a fresh scaffold, but the same branch is
  // taken if someone removes deno.lock later — which drops integrity
  // verification. Both launchers must announce that on stderr rather than
  // quietly running unverified.
  for (const options of [BOOTSTRAP, PLAIN]) {
    const bash = launcherBash(options);
    const notice = bash.indexOf("without lockfile verification");
    assertEquals(notice > 0, true);
    // On stderr, and only in the branch that skips --frozen.
    assertEquals(notice > bash.indexOf("if [ -f deno.lock ]; then"), true);
    assertEquals(notice > bash.lastIndexOf("else\n"), true);
    assertStringIncludes(bash.slice(notice), ">&2");

    const pwsh = launcherPwsh(options);
    assertStringIncludes(pwsh, "without lockfile verification");
    assertStringIncludes(pwsh, "Write-Warning");
  }
});

Deno.test("the bash launcher execs Deno so the script is not read after it starts", () => {
  // `./zuke launcherSync` rewrites the very file bash is executing. `exec`
  // replaces the shell with Deno before that target runs, so there is no
  // shell left to read a half-rewritten script.
  for (const options of [BOOTSTRAP, PLAIN]) {
    const bash = launcherBash(options);
    assertStringIncludes(bash, `exec "$deno_bin" run -A --frozen zuke.ts "$@"`);
    assertStringIncludes(bash, `exec "$deno_bin" run -A zuke.ts "$@"`);
  }
});
