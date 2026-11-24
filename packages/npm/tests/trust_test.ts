// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { NpmTrustSettings } from "../mod.ts";

const argv = (s: NpmTrustSettings) => s.argv().slice(1);

test("trust github renders every flag after the package", () => {
  assertEquals(
    argv(
      new NpmTrustSettings().github("@s/app", "release.yml").repo("o/app")
        .environment("npm").allowPublish().allowStagePublish().yes(),
    ),
    [
      "trust",
      "github",
      "@s/app",
      "--file=release.yml",
      "--repo=o/app",
      "--environment=npm",
      "--allow-publish",
      "--allow-stage-publish",
      "--yes",
    ],
  );
});

test("trust gitlab and circleci take the file as a setter too", () => {
  assertEquals(argv(new NpmTrustSettings().gitlab().file("ci.yml")), [
    "trust",
    "gitlab",
    "--file=ci.yml",
  ]);
  assertEquals(argv(new NpmTrustSettings().circleci("app")), [
    "trust",
    "circleci",
    "app",
  ]);
});

test("trust lists by default and revokes by id", () => {
  assertEquals(argv(new NpmTrustSettings()), ["trust", "list"]);
  assertEquals(argv(new NpmTrustSettings().list("app")), [
    "trust",
    "list",
    "app",
  ]);
  assertEquals(argv(new NpmTrustSettings().revoke("abc", "app")), [
    "trust",
    "revoke",
    "app",
    "--id=abc",
  ]);
});

test("trust list after revoke drops the id", () => {
  assertEquals(argv(new NpmTrustSettings().revoke("abc").list()), [
    "trust",
    "list",
  ]);
});

test("trust carries the otp in the environment, not argv", () => {
  const s = new NpmTrustSettings().list().otp("123456");
  assertEquals(argv(s), ["trust", "list"]);
});
