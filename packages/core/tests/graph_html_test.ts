import { assertEquals } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { TargetBuilder } from "../src/target.ts";
import {
  clientModel,
  type GraphData,
  graphData,
  renderGraphHtml,
  toMermaid,
} from "../src/graph_html.ts";

class Demo extends Build {
  clean = target().description("Clean").executes(() => {});
  build = target().description("Build").dependsOn(this.clean).executes(
    () => {},
  );
}

Deno.test("graphData yields a node per target and an edge per dependency", () => {
  const data = graphData(discoverTargets(new Demo()));
  assertEquals(data.nodes, [
    { name: "clean", description: "Clean" },
    { name: "build", description: "Build" },
  ]);
  assertEquals(data.edges, [["clean", "build"]]);
});

Deno.test("graphData skips edges to undiscovered or unnamed dependencies", () => {
  const orphan = new TargetBuilder(); // never discovered, so name_ is undefined
  const ghost = new TargetBuilder();
  ghost.name_ = "ghost"; // named, but not present in the map
  const a = new TargetBuilder();
  a.name_ = "a";
  a.dependsOn(orphan, ghost);
  const targets = new Map<string, TargetBuilder>([["a", a]]);
  const data = graphData(targets);
  assertEquals(data.nodes, [{ name: "a", description: "" }]);
  assertEquals(data.edges, []);
});

Deno.test("toMermaid renders synthetic ids, edges, and escapes quotes", () => {
  const data: GraphData = {
    nodes: [{ name: 'a"b', description: "" }, { name: "c", description: "" }],
    edges: [['a"b', "c"]],
  };
  assertEquals(
    toMermaid(data),
    [
      "flowchart TD",
      '  n0["a&quot;b"]',
      '  n1["c"]',
      "  n0 --> n1",
    ].join("\n"),
  );
});

Deno.test("toMermaid renders a placeholder for an empty graph", () => {
  assertEquals(
    toMermaid({ nodes: [], edges: [] }),
    'flowchart TD\n  empty["No targets defined"]',
  );
});

Deno.test("clientModel records ids and both-direction adjacency", () => {
  const model = clientModel(graphData(discoverTargets(new Demo())));
  assertEquals(model.edges, [["n0", "n1"]]);
  const clean = model.nodes[0];
  const build = model.nodes[1];
  assertEquals([clean.id, clean.dependents, clean.deps], ["n0", ["n1"], []]);
  assertEquals([build.id, build.deps, build.dependents], ["n1", ["n0"], []]);
});

Deno.test("renderGraphHtml embeds the diagram, model, and CDN import", () => {
  const html = renderGraphHtml(graphData(discoverTargets(new Demo())));
  assertEquals(html.startsWith("<!doctype html>"), true);
  assertEquals(html.includes("cdn.jsdelivr.net/npm/mermaid@"), true);
  assertEquals(html.includes("flowchart TD"), true);
  assertEquals(html.includes('"name":"build"'), true);
  assertEquals(html.includes("Zuke build graph"), true);
});

Deno.test("renderGraphHtml accepts a custom title", () => {
  const html = renderGraphHtml({ nodes: [], edges: [] }, "My Graph");
  assertEquals(html.includes("<title>My Graph</title>"), true);
});
