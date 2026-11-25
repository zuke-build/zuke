// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { Build, FileTasks, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { CONFIG_FILE } from "../src/config.ts";
import {
  defaultGraphHost,
  graphCommand,
  openInBrowser,
} from "../src/graph_view.ts";
import { FakeGraphHost } from "../../../tests/_fakes.ts";

class Demo extends Build {
  clean = target().executes(() => {});
  build = target().dependsOn(this.clean).executes(() => {});
}

const targets = () => discoverTargets(new Demo());

test("openInBrowser invokes the spawner with the resolved command", async () => {
  const calls: Array<[string, string[]]> = [];
  await openInBrowser("g.html", "linux", (cmd, args) => {
    calls.push([cmd, args]);
    return Promise.resolve();
  });
  assertEquals(calls, [["xdg-open", ["g.html"]]]);
});

test("openInBrowser swallows a missing opener", async () => {
  await openInBrowser(
    "g.html",
    "darwin",
    () => Promise.reject(new Error("no")),
  );
  // No throw == pass.
});

test("graphCommand writes under the repo root's .zuke and opens it", async () => {
  const host = new FakeGraphHost("/repo/pkg", [`/repo/${CONFIG_FILE}`]);
  const code = await graphCommand(targets(), { open: true }, host);
  assertEquals(code, 0);
  const out = "/repo/.zuke/graph.html";
  assertEquals(host.dirs, ["/repo/.zuke"]);
  assertEquals(host.files.get(out)?.startsWith("<!doctype html>"), true);
  assertEquals(host.opened, [out]);
  assertEquals(host.logs.some((l) => l.includes(out)), true);
});

test("graphCommand falls back to the cwd when no config is found", async () => {
  const host = new FakeGraphHost("/work", []);
  await graphCommand(targets(), { open: false }, host);
  assertEquals(host.files.has("/work/.zuke/graph.html"), true);
  assertEquals(host.opened, []);
  assertEquals(host.logs.some((l) => l.includes("Open it in a browser")), true);
});

test("defaultGraphHost performs real filesystem effects", async () => {
  const dir = await FileTasks.makeTempDirectory();
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => void logs.push(args.join(" "));
  try {
    assertEquals(typeof defaultGraphHost.cwd(), "string");
    assertEquals(defaultGraphHost.exists(dir), true);
    assertEquals(defaultGraphHost.exists(`${dir}/nope`), false);
    await defaultGraphHost.mkdir(`${dir}/.zuke`);
    await defaultGraphHost.writeText(`${dir}/.zuke/graph.html`, "<html>");
    assertEquals(await FileTasks.readText(`${dir}/.zuke/graph.html`), "<html>");
    defaultGraphHost.log("hello");
    assertEquals(logs, ["hello"]);
  } finally {
    console.log = origLog;
    await FileTasks.remove(dir, { recursive: true });
  }
});
