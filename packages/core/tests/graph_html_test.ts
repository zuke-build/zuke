import { assertEquals } from "./_assert.ts";
import { Build, group, target } from "../mod.ts";
import { discoverGroups, discoverTargets } from "../src/build.ts";
import { TargetBuilder } from "../src/target.ts";
import {
  type CyElement,
  cytoscapeElements,
  type GraphData,
  graphData,
  renderGraphHtml,
} from "../src/graph_html.ts";

class Demo extends Build {
  clean = target().description("Clean").executes(() => {});
  build = target().description("Build").dependsOn(this.clean).executes(
    () => {},
  );
}

/** Find an element by id in a Cytoscape element list. */
function byId(elements: CyElement[], id: string): CyElement | undefined {
  return elements.find((e) => e.data.id === id);
}

Deno.test("graphData yields a node per target and an edge per dependency", () => {
  const data = graphData(discoverTargets(new Demo()));
  assertEquals(data.nodes, [
    { name: "clean", description: "Clean" },
    { name: "build", description: "Build" },
  ]);
  assertEquals(data.edges, [["clean", "build"]]);
});

Deno.test("graphData records group membership and cytoscapeElements nests it in a compound node", () => {
  class Grouped extends Build {
    checks = group();
    clean = target().executes(() => {});
    lint = target().dependsOn(this.clean).partOf(this.checks).executes(
      () => {},
    );
    format = target().dependsOn(this.clean).partOf(this.checks).executes(
      () => {},
    );
  }
  const b = new Grouped();
  discoverTargets(b);
  discoverGroups(b); // names the group so it can be labelled

  const data = graphData(discoverTargets(b));
  assertEquals(data.nodes.find((n) => n.name === "lint")?.group, "checks");
  assertEquals(data.nodes.find((n) => n.name === "clean")?.group, undefined);

  const elements = cytoscapeElements(data);
  // The group becomes a compound parent box...
  assertEquals(byId(elements, "g0")?.data.label, "checks");
  assertEquals(byId(elements, "g0")?.classes, "group");
  // ...and grouped targets reference it as their parent; ungrouped ones don't.
  const lint = elements.find((e) => e.data.label === "lint");
  const clean = elements.find((e) => e.data.label === "clean");
  assertEquals(lint?.data.parent, "g0");
  assertEquals(clean?.data.parent, undefined);
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

Deno.test("cytoscapeElements renders synthetic ids, descriptions, and edges", () => {
  const data: GraphData = {
    nodes: [
      { name: "a", description: "first" },
      { name: "c", description: "" },
    ],
    edges: [["a", "c"]],
  };
  assertEquals(cytoscapeElements(data), [
    { data: { id: "n0", label: "a", description: "first" }, classes: "target" },
    { data: { id: "n1", label: "c" }, classes: "target" },
    { data: { id: "e0", source: "n0", target: "n1" } },
  ]);
});

Deno.test("cytoscapeElements renders a placeholder for an empty graph", () => {
  assertEquals(cytoscapeElements({ nodes: [], edges: [] }), [
    { data: { id: "empty", label: "No targets defined" }, classes: "target" },
  ]);
});

Deno.test("renderGraphHtml embeds the elements and Cytoscape CDN import", () => {
  const html = renderGraphHtml(graphData(discoverTargets(new Demo())));
  assertEquals(html.startsWith("<!doctype html>"), true);
  assertEquals(html.includes("cdn.jsdelivr.net/npm/cytoscape@"), true);
  assertEquals(html.includes("cytoscape-dagre@"), true);
  assertEquals(html.includes('"label":"build"'), true);
  assertEquals(html.includes("Zuke build graph"), true);
});

Deno.test("renderGraphHtml accepts a custom title", () => {
  const html = renderGraphHtml({ nodes: [], edges: [] }, "My Graph");
  assertEquals(html.includes("<title>My Graph</title>"), true);
});
