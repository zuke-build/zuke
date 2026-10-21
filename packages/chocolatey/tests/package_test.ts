// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit tests for `ChocolateyTasks.package`: the exact files it renders, that
 * re-rendering is byte-identical, that no value can leave its XML element or
 * its PowerShell string, and that every invalid value is refused with the
 * setter named.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import type { Configure } from "@zuke/core/tooling";
import { type ChocolateyPackageSettings, ChocolateyTasks } from "../mod.ts";

const SHA = "ab".repeat(32);
const URL64 =
  "https://github.com/acme/app/releases/download/v1.2.3/app-x86_64-pc-windows-msvc.zip";
const DESCRIPTION = "Command-line tool that builds and ships widgets";

/** A minimal valid package, then `extra`. */
function minimal(
  extra: Configure<ChocolateyPackageSettings> = (s) => s,
): Configure<ChocolateyPackageSettings> {
  return (s) =>
    extra(
      s.id("app").version("1.2.3").authors("Acme")
        .projectUrl("https://example.com").description(DESCRIPTION)
        .url64bit(URL64).checksum64(SHA),
    );
}

const FULL_NUSPEC = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>app</id>
    <version>1.2.3</version>
    <packageSourceUrl>https://github.com/acme/app</packageSourceUrl>
    <owners>acme, jane</owners>
    <title>App (Portable)</title>
    <authors>Acme Corp, Jane Doe</authors>
    <projectUrl>https://example.com</projectUrl>
    <iconUrl>https://example.com/icon.png</iconUrl>
    <copyright>Copyright (c) 2026 Acme Corp</copyright>
    <licenseUrl>https://example.com/LICENSE</licenseUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <docsUrl>https://example.com/docs</docsUrl>
    <bugTrackerUrl>https://github.com/acme/app/issues</bugTrackerUrl>
    <tags>cli widgets</tags>
    <summary>Widgets, built and shipped</summary>
    <description>Command-line tool that builds and ships widgets

- fast
- small</description>
    <releaseNotes>https://github.com/acme/app/releases/tag/v1.2.3</releaseNotes>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
`;

const INSTALL_SCRIPT = `$ErrorActionPreference = 'Stop'
$toolsDir = $(Split-Path -parent $MyInvocation.MyCommand.Definition)

$packageArgs = @{
  packageName    = 'app'
  unzipLocation  = $toolsDir
  url64bit       = '${URL64}'
  checksum64     = '${SHA}'
  checksumType64 = 'sha256'
}

Install-ChocolateyZipPackage @packageArgs
`;

/** Every optional field set. */
const full: Configure<ChocolateyPackageSettings> = (s) =>
  s.id("app").version("1.2.3").title("App (Portable)")
    .authors("Acme Corp", "Jane Doe").owners("acme", "jane")
    .projectUrl("https://example.com")
    .licenseUrl("https://example.com/LICENSE")
    .iconUrl("https://example.com/icon.png")
    .copyright("Copyright (c) 2026 Acme Corp")
    .packageSourceUrl("https://github.com/acme/app")
    .docsUrl("https://example.com/docs")
    .bugTrackerUrl("https://github.com/acme/app/issues")
    .tags("cli", "widgets").summary("Widgets, built and shipped")
    .description(`${DESCRIPTION}\n\n- fast\n- small`)
    .releaseNotes("https://github.com/acme/app/releases/tag/v1.2.3")
    .url64bit(URL64).checksum64(SHA.toUpperCase());

Deno.test("package: every field renders, in the nuspec's order", () => {
  const pkg = ChocolateyTasks.package(full);
  assertEquals(pkg.id, "app");
  assertEquals(pkg.version, "1.2.3");
  assertEquals(Object.keys(pkg.files), [
    "app.nuspec",
    "tools/chocolateyinstall.ps1",
  ]);
  assertEquals(pkg.files["app.nuspec"], FULL_NUSPEC);
  // The checksum is written lowercase, whatever case it was given in.
  assertEquals(pkg.files["tools/chocolateyinstall.ps1"], INSTALL_SCRIPT);
});

Deno.test("package: optional fields are left out when unset", () => {
  const nuspec = ChocolateyTasks.package(minimal()).files["app.nuspec"];
  assertEquals(
    nuspec,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>app</id>
    <version>1.2.3</version>
    <authors>Acme</authors>
    <projectUrl>https://example.com</projectUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <description>${DESCRIPTION}</description>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
`,
  );
});

Deno.test("package: rendering is deterministic", () => {
  assertEquals(
    JSON.stringify(ChocolateyTasks.package(full)),
    JSON.stringify(ChocolateyTasks.package(full)),
  );
});

Deno.test("package: no value can close its XML element", () => {
  const nuspec = ChocolateyTasks.package(
    minimal((s) =>
      s.title(`</title><dependencies><dependency id="evil"/></dependencies>`)
        .summary(`Tom & Jerry's "best" <tool>`)
        .releaseNotes("a\r\nb]]><!--")
    ),
  ).files["app.nuspec"];
  assertStringIncludes(
    nuspec,
    "<title>&lt;/title&gt;&lt;dependencies&gt;&lt;dependency id=&quot;" +
      "evil&quot;/&gt;&lt;/dependencies&gt;</title>",
  );
  assertStringIncludes(
    nuspec,
    "<summary>Tom &amp; Jerry&apos;s &quot;best&quot; &lt;tool&gt;</summary>",
  );
  // The carriage return survives a parser's line-ending normalisation.
  assertStringIncludes(
    nuspec,
    "<releaseNotes>a&#xD;\nb]]&gt;&lt;!--</releaseNotes>",
  );
  assertEquals(nuspec.includes("<dependencies>"), false);
  assertEquals(nuspec.includes('id="evil"'), false);
});

Deno.test("package: invisible characters are written as references", () => {
  const nuspec = ChocolateyTasks.package(
    minimal((s) =>
      s.description(`${DESCRIPTION} \u202e\u200b\u2028\u0085\ufeff end`)
    ),
  ).files["app.nuspec"];
  assertStringIncludes(
    nuspec,
    `${DESCRIPTION} &#x202E;&#x200B;&#x2028;&#x85;&#xFEFF; end`,
  );
});

Deno.test("package: characters XML cannot hold are refused", () => {
  for (const bad of ["\u0000", "\u0008", "\u001b", "\ud800", "\uffff"]) {
    assertThrows(
      () =>
        ChocolateyTasks.package(
          minimal((s) => s.releaseNotes(`notes ${bad} here`)),
        ),
      Error,
      "the nuspec <releaseNotes> holds the character U+",
    );
  }
});

Deno.test("package: the install script's strings cannot be escaped", () => {
  // Every value in the script is validated first, so a quote cannot get
  // there through the settings; the URL may legitimately hold one.
  const url = "https://example.com/a'b/app.zip";
  const script = ChocolateyTasks.package(minimal((s) => s.url64bit(url)))
    .files["tools/chocolateyinstall.ps1"];
  assertStringIncludes(
    script,
    "  url64bit       = 'https://example.com/a''b/app.zip'",
  );
});

Deno.test("package: a required field is named when it is missing", () => {
  const cases: Array<[Configure<ChocolateyPackageSettings>, string]> = [
    [(s) => s, ".id(...)"],
    [(s) => s.id("app"), ".version(...)"],
    [(s) => s.id("app").version("1.0.0"), ".authors(...)"],
    [(s) => s.id("app").version("1.0.0").authors("A"), ".projectUrl(...)"],
    [
      (s) =>
        s.id("app").version("1.0.0").authors("A")
          .projectUrl("https://example.com"),
      ".description(...)",
    ],
    [(s) => minimal()(s).url64bit(""), "url64bit"],
  ];
  for (const [configure, message] of cases) {
    assertThrows(() => ChocolateyTasks.package(configure), Error, message);
  }
  assertThrows(
    () =>
      ChocolateyTasks.package((s) => {
        const settings = minimal()(s);
        settings.url64bit_ = undefined;
        return settings;
      }),
    Error,
    "requires .url64bit(...)",
  );
  assertThrows(
    () =>
      ChocolateyTasks.package((s) => {
        const settings = minimal()(s);
        settings.checksum64_ = undefined;
        return settings;
      }),
    Error,
    "requires .checksum64(...)",
  );
});

Deno.test("package: ids are lowercase names that cannot become paths", () => {
  for (
    const id of ["App", "../app", "app/x", "a..b", "-app", "app-", "", "a b"]
  ) {
    assertThrows(
      () => ChocolateyTasks.package(minimal((s) => s.id(id))),
      Error,
      "invalid package id",
    );
  }
  assertThrows(
    () => ChocolateyTasks.package(minimal((s) => s.id("a".repeat(101)))),
    Error,
    "at most 100",
  );
  for (const id of ["app", "app-cli", "app.portable", "app_2", "7zip"]) {
    assertEquals(ChocolateyTasks.package(minimal((s) => s.id(id))).id, id);
  }
});

Deno.test("package: versions are NuGet versions", () => {
  for (
    const version of ["1", "1.02.3", "v1.2.3", "1.2.3.4.5", "1.2.3-", "1.2 .3"]
  ) {
    assertThrows(
      () => ChocolateyTasks.package(minimal((s) => s.version(version))),
      Error,
      "invalid package version",
    );
  }
  for (
    const version of ["0.1", "1.2.3", "1.2.3.4", "1.2.3-beta.1", "1.2.3+sha.5"]
  ) {
    assertEquals(
      ChocolateyTasks.package(minimal((s) => s.version(version))).version,
      version,
    );
  }
});

Deno.test("package: URLs must be https, plain ASCII, with no credentials", () => {
  const cases: Array<[Configure<ChocolateyPackageSettings>, string]> = [
    [(s) => s.projectUrl("http://example.com"), "not http://"],
    [(s) => s.projectUrl("not a url"), "well-formed https://"],
    [(s) => s.url64bit("https://example.com/a b.zip"), "well-formed"],
    [(s) => s.url64bit("https://example.com/\u2019.zip"), "printable ASCII"],
    [(s) => s.url64bit("https://example.com/a\n.zip"), "well-formed"],
    [(s) => s.iconUrl("ftp://example.com/i.png"), "not ftp://"],
    [(s) => s.licenseUrl("javascript:alert(1)"), ".licenseUrl(...)"],
    [(s) => s.docsUrl("http://example.com"), ".docsUrl(...)"],
    [(s) => s.bugTrackerUrl("http://example.com"), ".bugTrackerUrl(...)"],
    [(s) => s.packageSourceUrl("http://x.y"), ".packageSourceUrl(...)"],
  ];
  for (const [configure, message] of cases) {
    assertThrows(
      () => ChocolateyTasks.package(minimal(configure)),
      Error,
      message,
    );
  }
  const error = assertThrows(
    () =>
      ChocolateyTasks.package(
        minimal((s) => s.url64bit("https://user:hunter2@example.com/app.zip")),
      ),
    Error,
    "must not carry a user name or password",
  );
  // The credential is never echoed.
  assertEquals(String(error).includes("hunter2"), false);
});

Deno.test("package: the checksum must be a SHA-256", () => {
  for (const sha of ["", "ab".repeat(31), "zz".repeat(32), `${SHA}\n`]) {
    assertThrows(
      () => ChocolateyTasks.package(minimal((s) => s.checksum64(sha))),
      Error,
      ".checksum64(...) must be a SHA-256",
    );
  }
});

Deno.test("package: the description is held to the community length rules", () => {
  assertThrows(
    () => ChocolateyTasks.package(minimal((s) => s.description("Too short"))),
    Error,
    "at least 30 characters",
  );
  assertThrows(
    () =>
      ChocolateyTasks.package(minimal((s) => s.description(` ${DESCRIPTION}`))),
    Error,
    "no leading or trailing whitespace",
  );
  assertThrows(
    () =>
      ChocolateyTasks.package(minimal((s) => s.description("x".repeat(4001)))),
    Error,
    "4001 characters",
  );
  ChocolateyTasks.package(minimal((s) => s.description("x".repeat(4000))));
});

Deno.test("package: one-line fields refuse line breaks and controls", () => {
  const cases: Array<[Configure<ChocolateyPackageSettings>, string]> = [
    [(s) => s.title("App\n<injected>"), ".title("],
    [(s) => s.summary("a\tb"), ".summary("],
    [(s) => s.summary("   "), ".summary("],
    [(s) => s.copyright("Acme\n<injected>"), ".copyright("],
    [(s) => s.authors("Acme\r\n"), ".authors("],
    [(s) => s.owners(""), ".owners("],
  ];
  for (const [configure, message] of cases) {
    assertThrows(
      () => ChocolateyTasks.package(minimal(configure)),
      Error,
      message,
    );
  }
  assertThrows(
    () => ChocolateyTasks.package(minimal((s) => s.authors("Acme, Inc"))),
    Error,
    "must not contain a comma",
  );
});

Deno.test("package: tags are single words", () => {
  for (const tag of ["two words", "", "tab\tbed", "line\nbreak"]) {
    assertThrows(
      () => ChocolateyTasks.package(minimal((s) => s.tags(tag))),
      Error,
      "must be one word",
    );
  }
});
