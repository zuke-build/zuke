// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `HomebrewTasks.formula`: the full rendered Ruby (golden),
 * the deterministic platform order, the test block, every validation, and
 * hostile values in every field that reaches the Ruby.
 *
 * @module
 */

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { type FormulaSettings, HomebrewTasks } from "../mod.ts";

/** A valid SHA-256 for each platform, distinct so the order is visible. */
const SHA = {
  macArm: "1".repeat(64),
  macIntel: "2".repeat(64),
  linuxArm: "3".repeat(64),
  linuxIntel: "4".repeat(64),
};

/** Base URL of the release the archives come from. */
const RELEASE = "https://github.com/acme/app/releases/download/v1.2.3";

/** A complete formula, binaries declared in the reverse of render order. */
function complete(s: FormulaSettings): FormulaSettings {
  return s.name("app").description("Command-line tool for widgets")
    .homepage("https://example.com/app").license("MIT")
    .binary((b) =>
      b.os("linux").arch("intel").url(`${RELEASE}/app-x86_64-linux.tar.gz`)
        .sha256(SHA.linuxIntel)
    )
    .binary((b) =>
      b.os("linux").arch("arm").url(`${RELEASE}/app-aarch64-linux.tar.gz`)
        .sha256(SHA.linuxArm)
    )
    .binary((b) =>
      b.os("macos").arch("intel").url(`${RELEASE}/app-x86_64-darwin.tar.gz`)
        .sha256(SHA.macIntel)
    )
    .binary((b) =>
      b.os("macos").arch("arm").url(`${RELEASE}/app-aarch64-darwin.tar.gz`)
        .sha256(SHA.macArm)
    )
    .install("app")
    .test((t) => t.command("--version").expectVersion());
}

/** The golden rendering of {@link complete}. */
const GOLDEN = `class App < Formula
  desc "Command-line tool for widgets"
  homepage "https://example.com/app"
  license "MIT"

  on_macos do
    on_arm do
      url "${RELEASE}/app-aarch64-darwin.tar.gz"
      sha256 "${SHA.macArm}"
    end

    on_intel do
      url "${RELEASE}/app-x86_64-darwin.tar.gz"
      sha256 "${SHA.macIntel}"
    end
  end

  on_linux do
    on_arm do
      url "${RELEASE}/app-aarch64-linux.tar.gz"
      sha256 "${SHA.linuxArm}"
    end

    on_intel do
      url "${RELEASE}/app-x86_64-linux.tar.gz"
      sha256 "${SHA.linuxIntel}"
    end
  end

  def install
    bin.install "app"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/app --version")
  end
end
`;

Deno.test("formula: the full rendering, macOS before Linux and ARM before Intel", () => {
  assertEquals(HomebrewTasks.formula(complete), GOLDEN);
});

Deno.test("formula: the rendering is deterministic whatever order binaries are declared in", () => {
  const forward = HomebrewTasks.formula((s) => {
    const base = s.name("app").description("Command-line tool for widgets")
      .homepage("https://example.com/app").license("MIT");
    for (
      const [os, arch, sha] of [
        ["macos", "arm", SHA.macArm],
        ["macos", "intel", SHA.macIntel],
        ["linux", "arm", SHA.linuxArm],
        ["linux", "intel", SHA.linuxIntel],
      ] as const
    ) {
      const file = `app-${arch === "arm" ? "aarch64" : "x86_64"}-${
        os === "macos" ? "darwin" : "linux"
      }.tar.gz`;
      base.binary((b) =>
        b.os(os).arch(arch).url(`${RELEASE}/${file}`).sha256(sha)
      );
    }
    return base.install("app").test((t) =>
      t.command("--version").expectVersion()
    );
  });
  assertEquals(forward, GOLDEN);
  assertEquals(
    HomebrewTasks.formula(complete),
    HomebrewTasks.formula(complete),
  );
});

Deno.test("formula: a URL that carries the version gets no version line, so brew audit does not call it redundant", () => {
  // Finding 3 of the adversarial review: brew audit's ResourceAuditor rejects
  // a `version` that repeats the one Version.detect scans from the URL, which
  // every GitHub release asset URL carries. Unset, no line is rendered — and
  // `expectVersion()` still renders, matching the scanned version.
  const ruby = HomebrewTasks.formula(complete);
  assertEquals(ruby.includes("\n  version "), false);
  assertEquals(ruby.includes("/releases/download/v1.2.3/"), true);
  assertEquals(ruby.includes("assert_match version.to_s"), true);
});

Deno.test("formula: a single platform, no license, several binaries, caveats and a plain test", () => {
  const ruby = HomebrewTasks.formula((s) =>
    s.name("app-cli@2").description("Widget tool, version 2")
      .homepage("https://example.com").version("2.0.0-rc.1")
      .binary((b) =>
        b.os("linux").arch("intel").url("https://example.com/a.tgz")
          .sha256(SHA.linuxIntel)
      )
      .install("app", "app-helper")
      .caveats("Run `app init` first.\nThen #{edit} the config.")
      .test((t) => t.binary("app-helper").command("--help"))
  );
  assertEquals(
    ruby,
    `class AppCliAT2 < Formula
  desc "Widget tool, version 2"
  homepage "https://example.com"
  version "2.0.0-rc.1"

  on_linux do
    on_intel do
      url "https://example.com/a.tgz"
      sha256 "${SHA.linuxIntel}"
    end
  end

  def install
    bin.install "app"
    bin.install "app-helper"
  end

  def caveats
    "Run \`app init\` first.\\nThen \\#{edit} the config."
  end

  test do
    system bin/"app-helper", "--help"
  end
end
`,
  );
});

Deno.test("formula: an output expectation, and arguments that need shell quoting", () => {
  const ruby = HomebrewTasks.formula((s) =>
    complete(s).test((t) =>
      t.command("greet", "it's me", "$(id)").expectOutput('Hello, "it\'s me"')
    )
  );
  const line = ruby.split("\n").find((l) => l.includes("assert_match"));
  assertEquals(
    line,
    `    assert_match "Hello, \\"it's me\\"", ` +
      `shell_output("#{bin}/app greet 'it'\\\\''s me' '$(id)'")`,
  );
});

Deno.test("formula: hostile values stay inside their literals", () => {
  const ruby = HomebrewTasks.formula((s) =>
    complete(s)
      .description('Evil" ; system("id") ; "')
      .caveats('"\nend\nsystem("id")\nclass X\n#{`id`}')
      .test((t) => t.command('"; system("id"); "').expectOutput("#{`id`}"))
  );
  // Nothing but the formula's own structure starts a line.
  const statements = ruby.split("\n").map((line) => line.trim().split(" ")[0]);
  for (const word of statements) {
    assertEquals(
      [
        "",
        "class",
        "desc",
        "homepage",
        "version",
        "license",
        "on_macos",
        "on_linux",
        "on_arm",
        "on_intel",
        "url",
        "sha256",
        "end",
        "def",
        "bin.install",
        "test",
        "assert_match",
        '"Run',
        '"\\"\\nend\\nsystem(\\"id\\")\\nclass',
      ].includes(word),
      true,
      `unexpected statement ${JSON.stringify(word)}`,
    );
  }
  assertEquals(ruby.includes('desc "Evil\\" ; system(\\"id\\") ; \\""'), true);
  assertEquals(/[^\\]#\{(?!bin\})/.test(ruby), false);
});

Deno.test("formula: each missing field is named", () => {
  const sha = SHA.macArm;
  const cases: Array<[(s: FormulaSettings) => FormulaSettings, string]> = [
    [(s) => s, ".name(...)"],
    [(s) => s.name("app"), ".description(...)"],
    [(s) => s.name("app").description("Widget tool"), ".homepage(...)"],
    [
      (s) => s.name("app").description("Widget tool").homepage("https://e.com"),
      "at least one .binary(",
    ],
    [
      (s) =>
        s.name("app").description("Widget tool").homepage("https://e.com")
          .binary((b) =>
            b.os("macos").arch("arm").url("https://e.com/a").sha256(sha)
          ),
      '.install("<binary>")',
    ],
  ];
  for (const [configure, message] of cases) {
    assertThrows(() => HomebrewTasks.formula(configure), Error, message);
  }
});

Deno.test("formula: binary fields are validated and named", () => {
  const binary = (
    configure: Parameters<FormulaSettings["binary"]>[0],
  ) =>
  () =>
    HomebrewTasks.formula((s) =>
      s.name("app").description("Widget tool").homepage("https://e.com")
        .version("1").install("app").binary(configure)
    );
  const sha = SHA.macArm;
  assertThrows(binary((b) => b), Error, ".os(...)");
  assertThrows(binary((b) => b.os("macos")), Error, ".arch(...)");
  assertThrows(binary((b) => b.os("macos").arch("arm")), Error, ".url(...)");
  assertThrows(
    binary((b) => b.os("macos").arch("arm").url("https://e.com/a")),
    Error,
    ".sha256(...)",
  );
  for (const bad of ["A".repeat(64), "1".repeat(63), "g".repeat(64), ""]) {
    assertThrows(
      binary((b) =>
        b.os("macos").arch("arm").url("https://e.com/a").sha256(bad)
      ),
      Error,
      "64 lowercase hex",
    );
  }
  assertThrows(
    binary((b) => b.os("macos").arch("arm").url("http://e.com/a").sha256(sha)),
    Error,
    "must be an https:// URL, not http:",
  );
  for (const bad of ["not a url", "https://e.com/a b", "https://e.com/a\n"]) {
    assertThrows(
      binary((b) => b.os("macos").arch("arm").url(bad).sha256(sha)),
      Error,
      "macos/arm binary .url(...) must be a well-formed https:// URL",
    );
  }
});

Deno.test("formula: a URL carrying a credential is refused without echoing it", () => {
  const error = assertThrows(
    () =>
      HomebrewTasks.formula((s) =>
        complete(s).binary((b) =>
          b.os("linux").arch("arm").url("https://user:hunter2@e.com/a").sha256(
            SHA.linuxArm,
          )
        )
      ),
    Error,
    "must not carry a user name or password",
  );
  assertEquals(error.message.includes("hunter2"), false);
  const ftp = assertThrows(
    () =>
      HomebrewTasks.formula((s) =>
        complete(s).homepage("ftp://user:hunter2@e.com")
      ),
    Error,
    "formula .homepage(...) must be an https:// URL",
  );
  assertEquals(ftp.message.includes("hunter2"), false);
});

Deno.test("formula: a platform declared twice is refused", () => {
  assertThrows(
    () =>
      HomebrewTasks.formula((s) =>
        complete(s).binary((b) =>
          b.os("macos").arch("arm").url("https://e.com/b").sha256(SHA.macArm)
        )
      ),
    Error,
    "two macos/arm binaries",
  );
});

Deno.test("formula: the description is held to brew audit's rules", () => {
  const cases: Array<[string, string]> = [
    ["x".repeat(81).replace(/^x/, "X"), "is 81 characters"],
    ["lowercase start", "must start with a capital letter"],
    ["A tool for widgets", "must not start with an article"],
    ["An app for widgets", "must not start with an article"],
    ["The widget tool", "must not start with an article"],
    ["App for widgets", "must not start with the formula's name"],
    ["APP: widgets", "must not start with the formula's name"],
    ["Widget tool.", "must not end with a period"],
    [" Widget tool", "must not start or end with whitespace"],
  ];
  for (const [description, message] of cases) {
    assertThrows(
      () => HomebrewTasks.formula((s) => complete(s).description(description)),
      Error,
      message,
    );
  }
  // An exactly-80-character description, a word that merely begins with an
  // article, and one that merely begins with the name are all fine.
  for (
    const description of [
      "W" + "x".repeat(79),
      "Anvil-grade widget tool",
      "Application widget tool",
      "3D widget tool",
    ]
  ) {
    HomebrewTasks.formula((s) => complete(s).description(description));
  }
});

Deno.test("formula: version, license and install names are validated", () => {
  for (const version of ["", "1 2", "-1", "1\n", '1#{system("id")}']) {
    assertThrows(
      () => HomebrewTasks.formula((s) => complete(s).version(version)),
      Error,
      ".version(",
    );
  }
  for (const license of ["", "MIT OR Apache-2.0", 'MIT"']) {
    assertThrows(
      () => HomebrewTasks.formula((s) => complete(s).license(license)),
      Error,
      ".license(",
    );
  }
  for (const file of ["../app", "bin/app", ".", "..", ".hidden", "a b"]) {
    assertThrows(
      () => HomebrewTasks.formula((s) => complete(s).install(file)),
      Error,
      "must be a plain file name",
    );
  }
});

Deno.test("formula: the test must run a binary the formula installs", () => {
  assertThrows(
    () =>
      HomebrewTasks.formula((s) =>
        complete(s).test((t) => t.binary("other").command("--version"))
      ),
    Error,
    'formula test .binary("other") is not one of the binaries',
  );
});

Deno.test("formula: an invalid name is refused before anything renders", () => {
  assertThrows(
    () => HomebrewTasks.formula((s) => complete(s).name("../evil")),
    Error,
    "invalid formula name",
  );
});
