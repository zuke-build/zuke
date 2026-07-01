import { consoleRenderer, createConsoleRenderer } from "../src/renderer.ts";
import { defaultTheme, type Theme } from "../src/theme.ts";
import { defaultRenderer, type TargetReport } from "@zuke/core";
import { SGR, type Style } from "@zuke/core/render";
import { assertEquals } from "../../core/tests/_assert.ts";

const plain: Style = { github: false, color: false, width: 10 };
const colored: Style = { github: false, color: true, width: 10 };
const actions: Style = { github: true, color: false, width: 10 };

Deno.test("consoleRenderer draws a ruled, themed target header", () => {
  assertEquals(consoleRenderer.targetHeader(plain, "build"), [
    "═".repeat(10),
    "build",
    "═".repeat(10),
  ]);
});

Deno.test("consoleRenderer opens a group under GitHub Actions", () => {
  assertEquals(consoleRenderer.targetHeader(actions, "build"), [
    "::group::build",
  ]);
});

Deno.test("the header colour comes from the theme's info token", () => {
  const green: Theme = { ...defaultTheme, info: ["green"] };
  const renderer = createConsoleRenderer(green);
  const [, label] = renderer.targetHeader(colored, "t");
  assertEquals(label, `${SGR.bold}${SGR.green}t${SGR.reset}`);
});

Deno.test("footers and summary delegate to Zuke's default renderer", () => {
  const reports: TargetReport[] = [{ name: "lint", status: "passed", ms: 500 }];
  assertEquals(
    consoleRenderer.targetPassFooter(plain, "lint", 500),
    defaultRenderer.targetPassFooter(plain, "lint", 500),
  );
  assertEquals(
    consoleRenderer.targetDryRunFooter(plain, "lint"),
    defaultRenderer.targetDryRunFooter(plain, "lint"),
  );
  assertEquals(
    consoleRenderer.targetFailFooter(plain, "lint", 500, new Error("x")),
    defaultRenderer.targetFailFooter(plain, "lint", 500, new Error("x")),
  );
  assertEquals(
    consoleRenderer.summaryBlock(plain, reports, 500, true),
    defaultRenderer.summaryBlock(plain, reports, 500, true),
  );
  assertEquals(
    consoleRenderer.jobSummaryMarkdown(reports, 500, true),
    defaultRenderer.jobSummaryMarkdown(reports, 500, true),
  );
});
