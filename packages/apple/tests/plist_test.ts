// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore frob

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { parsePlist } from "../src/plist.ts";

const doc = (body: string) =>
  `<?xml version="1.0"?><!-- a comment --><!DOCTYPE plist SYSTEM "x"><plist version="1.0">${body}</plist>`;

Deno.test("plist: every value type", () => {
  const value = parsePlist(doc(`<dict>
    <key>s</key><string>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &bogus;</string>
    <key>empty</key><string></string>
    <key>selfClosed</key><string/>
    <key>i</key><integer>-3</integer>
    <key>r</key><real>1.5</real>
    <key>e</key><real>-2e3</real>
    <key>t</key><true />
    <key>f</key><false/>
    <key>d</key><date>2026-01-02T03:04:05Z</date>
    <key>data</key><data>AAE C</data>
    <key>a</key><array><string>x</string><array/></array>
    <key>nested</key><dict><key>k</key><dict/></dict>
  </dict>`));
  assertEquals(value, {
    s: "a & b <c> \"d\" 'e' AB &bogus;",
    empty: "",
    selfClosed: "",
    i: -3,
    r: 1.5,
    e: -2000,
    t: true,
    f: false,
    d: new Date("2026-01-02T03:04:05Z"),
    data: new Uint8Array([0, 1, 2]),
    a: ["x", []],
    nested: { k: {} },
  });
});

Deno.test("plist: malformed documents are refused with a reason", () => {
  const cases: Array<[string, string]> = [
    ["<dict>", "no <plist> element"],
    ["<plist><dict><key>a</key>", "unexpected end"],
    [doc("<dict><key>a</key>"), "unsupported element </plist>"],
    [doc("<frob/>"), "unsupported element <frob/>"],
    [doc("<integer>x</integer>"), "<integer> is not a number"],
    [doc("<date>soon</date>"), "bad <date>"],
    [doc("<string><b>x</b></string>"), "<b> inside <string>"],
    [doc("<dict><string>x</string></dict>"), "expected <key>"],
    [doc("<string>x</string><string>y</string>"), "expected </plist>"],
    ["<plist>text</plist>", "text outside an element"],
    [doc("<integer>0x10</integer>"), "<integer> is not a number"],
    [doc("<integer></integer>"), "<integer> is not a number"],
    [doc("<real>1.5.2</real>"), "<real> is not a number"],
    [doc("<data>!!</data>"), "<data> is not base64"],
    [
      doc("<dict><key>a</key><true/><key>a</key><false/></dict>"),
      'the key "a" repeats',
    ],
    [doc("<true/>") + "<true/>", "content after </plist>"],
    // A comment is skipped where it stands, not cut out: removing it must not
    // join "<str" and "ing>" into a tag.
    [doc("<str<!-- x -->ing>a</string>"), "unsupported element"],
  ];
  for (const [xml, reason] of cases) {
    assertThrows(() => parsePlist(xml), Error, reason);
  }
});
