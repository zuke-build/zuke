// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import {
  NO_BANNER_ENV,
  PLAIN_ENV,
  resolveOutputMode,
} from "../src/output_mode.ts";

/** A reader over a fixed environment, so nothing ambient leaks in. */
function env(
  vars: Record<string, string> = {},
): (name: string) => string | undefined {
  return (name) => vars[name];
}

const tty = () => true;
const pipe = () => false;

Deno.test("an interactive terminal off CI is rich, coloured, and keeps the banner", () => {
  assertEquals(resolveOutputMode({ readEnv: env(), isTerminal: tty }), {
    plain: false,
    rich: true,
    color: true,
    banner: true,
  });
});

Deno.test("piped output is not rich, but nobody asked for plain, so the banner stays", () => {
  assertEquals(resolveOutputMode({ readEnv: env(), isTerminal: pipe }), {
    plain: false,
    rich: false,
    color: false,
    banner: true,
  });
});

Deno.test("CI drops the decoration and keeps the banner, even on a terminal", () => {
  const cases: Array<Record<string, string>> = [
    { CI: "true" },
    { GITHUB_ACTIONS: "true" },
  ];
  for (const vars of cases) {
    const mode = resolveOutputMode({ readEnv: env(vars), isTerminal: tty });
    assertEquals(mode.rich, false, JSON.stringify(vars));
    assertEquals(mode.plain, false);
    assertEquals(mode.banner, true);
  }
});

Deno.test("ZUKE_PLAIN is one level above ZUKE_NO_BANNER: plain, colourless, no banner", () => {
  const mode = resolveOutputMode({
    readEnv: env({ [PLAIN_ENV]: "1" }),
    isTerminal: tty,
  });
  assertEquals(mode, { plain: true, rich: false, color: false, banner: false });
});

Deno.test("ZUKE_PLAIN's conventional off values mean not plain", () => {
  for (const value of ["", "0", "false", "no", "FALSE"]) {
    const mode = resolveOutputMode({
      readEnv: env({ [PLAIN_ENV]: value }),
      isTerminal: tty,
    });
    assertEquals(mode.plain, false, value);
    assertEquals(mode.rich, true, value);
  }
});

Deno.test("an explicit --plain wins over ZUKE_PLAIN in both directions", () => {
  const off = resolveOutputMode({
    plain: false,
    readEnv: env({ [PLAIN_ENV]: "1" }),
    isTerminal: tty,
  });
  assertEquals(off.rich, true);
  const on = resolveOutputMode({
    plain: true,
    readEnv: env({ [PLAIN_ENV]: "0" }),
    isTerminal: tty,
  });
  assertEquals(on.plain, true);
  assertEquals(on.banner, false);
});

Deno.test("ZUKE_NO_BANNER removes only the banner", () => {
  const mode = resolveOutputMode({
    readEnv: env({ [NO_BANNER_ENV]: "1" }),
    isTerminal: tty,
  });
  assertEquals(mode, { plain: false, rich: true, color: true, banner: false });
});

Deno.test("an explicit banner choice beats ZUKE_NO_BANNER, but never plain", () => {
  const kept = resolveOutputMode({
    banner: true,
    readEnv: env({ [NO_BANNER_ENV]: "1" }),
    isTerminal: tty,
  });
  assertEquals(kept.banner, true);
  const plain = resolveOutputMode({
    banner: true,
    plain: true,
    readEnv: env(),
    isTerminal: tty,
  });
  assertEquals(plain.banner, false);
});

Deno.test("NO_COLOR keeps rich decoration and drops only the colour", () => {
  const mode = resolveOutputMode({
    readEnv: env({ NO_COLOR: "1" }),
    isTerminal: tty,
  });
  assertEquals(mode.rich, true);
  assertEquals(mode.color, false);
  // An empty NO_COLOR is unset, by that convention's own definition.
  const empty = resolveOutputMode({
    readEnv: env({ NO_COLOR: "" }),
    isTerminal: tty,
  });
  assertEquals(empty.color, true);
});

Deno.test("the defaults read the real process without throwing", () => {
  // Under `deno test` stdout is not a terminal, so nothing is rich.
  const mode = resolveOutputMode();
  assertEquals(mode.rich, false);
  assertEquals(mode.color, false);
});
