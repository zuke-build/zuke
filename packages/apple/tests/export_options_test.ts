// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { ExportOptionsSettings, XcodebuildTasks } from "../mod.ts";

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
  '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n<dict>\n';

Deno.test("export options: every key renders, in the order set", () => {
  const plist = new ExportOptionsSettings().method("app-store-connect")
    .teamId("ABCDE12345").signingStyle("manual")
    .signingCertificate("Apple Distribution")
    .provisioningProfile("com.example.app", "App Store & Co <prod>")
    .provisioningProfile("com.example.app.widget", "Widget")
    .destination("upload").uploadSymbols(true)
    .manageAppVersionAndBuildNumber(false).stripSwiftSymbols(true)
    .testFlightInternalTestingOnly(false).render();
  assertEquals(
    plist,
    HEAD +
      "\t<key>method</key>\n\t<string>app-store-connect</string>\n" +
      "\t<key>teamID</key>\n\t<string>ABCDE12345</string>\n" +
      "\t<key>signingStyle</key>\n\t<string>manual</string>\n" +
      "\t<key>signingCertificate</key>\n\t<string>Apple Distribution</string>\n" +
      "\t<key>provisioningProfiles</key>\n\t<dict>\n" +
      "\t\t<key>com.example.app</key>\n" +
      "\t\t<string>App Store &amp; Co &lt;prod&gt;</string>\n" +
      "\t\t<key>com.example.app.widget</key>\n\t\t<string>Widget</string>\n" +
      "\t</dict>\n" +
      "\t<key>destination</key>\n\t<string>upload</string>\n" +
      "\t<key>uploadSymbols</key>\n\t<true/>\n" +
      "\t<key>manageAppVersionAndBuildNumber</key>\n\t<false/>\n" +
      "\t<key>stripSwiftSymbols</key>\n\t<true/>\n" +
      "\t<key>testFlightInternalTestingOnly</key>\n\t<false/>\n" +
      "</dict>\n</plist>\n",
  );
});

Deno.test("export options: a value cannot close its element", () => {
  const plist = new ExportOptionsSettings().method("debugging")
    .teamId("</string><key>method</key><string>enterprise").render();
  assertEquals(plist.match(/<key>method<\/key>/g)?.length, 1);
  assertEquals(
    plist.includes(
      "&lt;/string&gt;&lt;key&gt;method&lt;/key&gt;&lt;string&gt;enterprise",
    ),
    true,
  );
});

Deno.test("export options: method is required and control characters are refused", () => {
  assertThrows(
    () => new ExportOptionsSettings().teamId("X").render(),
    Error,
    "ExportOptions: .method() is required.",
  );
  assertThrows(
    () =>
      new ExportOptionsSettings().method("debugging").teamId("A\u0001")
        .render(),
    Error,
    "ExportOptions: teamID holds a character",
  );
  assertThrows(
    () =>
      new ExportOptionsSettings().method("debugging").teamId("a\uD800b")
        .render(),
    Error,
    "ExportOptions: teamID holds a character",
  );
  assertThrows(
    () =>
      new ExportOptionsSettings().method("debugging")
        .provisioningProfile("com.x\u0007", "P").render(),
    Error,
    "ExportOptions: a key holds a character",
  );
});

Deno.test("writeExportOptions writes the rendered plist", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-export-options-" });
  try {
    const path = `${dir}/ExportOptions.plist`;
    await XcodebuildTasks.writeExportOptions(
      path,
      (o) => o.method("release-testing"),
    );
    assertEquals(
      await Deno.readTextFile(path),
      HEAD + "\t<key>method</key>\n\t<string>release-testing</string>\n" +
        "</dict>\n</plist>\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
