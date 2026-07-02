import {
  box,
  isStyleName,
  line,
  pad,
  paint,
  SGR,
  sgrCodes,
  stripAnsi,
  type Style,
  stylize,
  table,
  visibleWidth,
} from "../src/render.ts";
import { assertEquals } from "./_assert.ts";

const plain: Style = { github: false, color: false, width: 20 };
const colored: Style = { github: false, color: true, width: 20 };

Deno.test("isStyleName recognises known styles and rejects others", () => {
  assertEquals(isStyleName("red"), true);
  assertEquals(isStyleName("bold"), true);
  assertEquals(isStyleName("chartreuse"), false);
});

Deno.test("sgrCodes concatenates the named escape codes", () => {
  assertEquals(sgrCodes(["red", "bold"]), SGR.red + SGR.bold);
  assertEquals(sgrCodes([]), "");
});

Deno.test("paint wraps only when colour is enabled", () => {
  assertEquals(paint(true, SGR.red, "x"), `${SGR.red}x${SGR.reset}`);
  assertEquals(paint(false, SGR.red, "x"), "x");
});

Deno.test("stylize paints named styles conditionally", () => {
  assertEquals(stylize(true, ["green"], "ok"), `${SGR.green}ok${SGR.reset}`);
  assertEquals(stylize(false, ["green"], "ok"), "ok");
});

Deno.test("stripAnsi and visibleWidth ignore colour codes", () => {
  const decorated = `${SGR.red}${SGR.bold}hi${SGR.reset}`;
  assertEquals(stripAnsi(decorated), "hi");
  assertEquals(visibleWidth(decorated), 2);
  assertEquals(stripAnsi("plain"), "plain");
});

Deno.test("pad aligns left and right, and never truncates", () => {
  assertEquals(pad("a", 4), "a   ");
  assertEquals(pad("a", 4, "right"), "   a");
  assertEquals(pad("overflow", 3), "overflow");
  // Padding is measured on visible text, so painted cells still align.
  assertEquals(visibleWidth(pad(`${SGR.red}a${SGR.reset}`, 4)), 4);
});

Deno.test("line repeats a rule across the style width", () => {
  assertEquals(line(plain, { width: 5 }), "═════");
  assertEquals(line(colored, { width: 3 }), `${SGR.dim}═══${SGR.reset}`);
  assertEquals(line(plain, { char: "-", width: 4 }), "----");
  // A multi-character rule floors the repeat count to the available width.
  assertEquals(line(plain, { char: "ab", width: 5 }), "abab");
  // An empty rule character yields an empty line rather than looping forever.
  assertEquals(line(plain, { char: "", width: 5 }), "");
  assertEquals(line(plain, { width: 4, style: ["bold"] }), "════");
});

Deno.test("box frames content with an optional title", () => {
  assertEquals(box(plain, "hi", { padding: 1 }), [
    "┌────┐",
    "│ hi │",
    "└────┘",
  ]);
  assertEquals(box(plain, ["a", "bbb"], { title: "T" }), [
    "┌─ T ─┐",
    "│ a   │",
    "│ bbb │",
    "└─────┘",
  ]);
  // A string splits on newlines; padding 0 hugs the content.
  assertEquals(box(plain, "a\nbb", { padding: 0 }), [
    "┌──┐",
    "│a │",
    "│bb│",
    "└──┘",
  ]);
});

Deno.test("box honours a forced width and paints its border", () => {
  const wide = box(plain, "x", { width: 6, padding: 1 });
  assertEquals(wide[0], "┌──────┐");
  assertEquals(wide[1], "│ x    │");
  const painted = box(colored, "x", { padding: 1, border: ["red"] });
  assertEquals(painted[0].includes(SGR.red), true);
});

Deno.test("table aligns columns with a header divider", () => {
  const out = table(
    plain,
    [{ header: "Name" }, { header: "N", align: "right" }],
    [["lint", "1"], ["test", "20"]],
  );
  assertEquals(out, [
    "Name   N",
    "────────",
    "lint   1",
    "test  20",
  ]);
});

Deno.test("table can drop the divider and pads short rows", () => {
  const out = table(
    plain,
    [{ header: "A" }, { header: "B" }],
    [["x"]],
    { divider: false },
  );
  assertEquals(out, ["A  B", "x"]);
});

Deno.test("table paints its header when colour is on", () => {
  const out = table(colored, [{ header: "H" }], [["v"]], { divider: false });
  assertEquals(out[0], `${SGR.bold}H${SGR.reset}`);
});
