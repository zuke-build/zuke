/**
 * Render a build's dependency graph as an interactive
 * [Cytoscape](https://js.cytoscape.org/) diagram embedded in a self-contained
 * HTML page.
 *
 * Everything here is pure: {@link graphData} extracts nodes and edges from the
 * discovered targets, {@link cytoscapeElements} renders the diagram's element
 * model, and {@link renderGraphHtml} wraps it in a page whose nodes are
 * clickable — selecting a target highlights every other target it connects to.
 * The effectful parts (writing the file, opening a browser) live in
 * `graph_view.ts`.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";

/** Pinned Cytoscape build loaded by the generated page (needs network to view). */
const CYTOSCAPE_CDN =
  "https://cdn.jsdelivr.net/npm/cytoscape@3.30.3/dist/cytoscape.esm.min.mjs";
/**
 * Pinned dagre layout extension. Loaded from esm.sh, which bundles dagre's
 * CommonJS dependency tree (including `graphlib`) correctly — jsDelivr's `+esm`
 * transform leaves dagre's internal `require("graphlib")` undefined, so the
 * extension throws on load there.
 */
const CYTOSCAPE_DAGRE_CDN = "https://esm.sh/cytoscape-dagre@2.5.0";

/** A target in the visualised graph. */
export interface GraphNode {
  /** The target's name. */
  name: string;
  /** The target's description, or `""` if none. */
  description: string;
  /** The name of the parallel group this target belongs to, if any. */
  group?: string;
}

/** The nodes and dependency edges of a build graph. */
export interface GraphData {
  /** Targets in declaration order. */
  nodes: GraphNode[];
  /** Edges as `[dependency, dependent]` — the dependency runs first. */
  edges: Array<[string, string]>;
}

/**
 * Extract the {@link GraphData} from discovered targets: one node per target
 * and one edge per hard `dependsOn` reference (between known targets only).
 */
export function graphData(targets: Map<string, TargetBuilder>): GraphData {
  const nodes: GraphNode[] = [];
  const edges: Array<[string, string]> = [];
  for (const [name, t] of targets) {
    const node: GraphNode = { name, description: t.description_ ?? "" };
    const group = t.group_?.name_;
    if (group !== undefined) node.group = group;
    nodes.push(node);
    for (const dep of t.dependsOn_) {
      const depName = dep?.name_;
      if (depName !== undefined && targets.has(depName)) {
        edges.push([depName, name]);
      }
    }
  }
  return { nodes, edges };
}

/** The `data` payload of a single Cytoscape element (node or edge). */
export interface CyElementData {
  /** Synthetic id (`n0`, `g0`, `e0`, …) so the markup is name-independent. */
  id: string;
  /** Display label (targets and group boxes). */
  label?: string;
  /** The target's description, omitted when empty. */
  description?: string;
  /**
   * The target's dependency depth: the longest chain of `dependsOn` references
   * leading to it (`0` for a target with no dependencies). The page maps depth
   * onto a colour ramp so the graph reads from roots to leaves.
   */
  depth?: number;
  /** The compound parent's id, for targets inside a parallel group. */
  parent?: string;
  /** Edge source node id (the dependency that runs first). */
  source?: string;
  /** Edge target node id (the dependent). */
  target?: string;
}

/** A single Cytoscape element: a node, group box, or edge. */
export interface CyElement {
  /** The element's data payload. */
  data: CyElementData;
  /** Space-separated style classes (`target`, `group`). Absent for edges. */
  classes?: string;
}

/**
 * Render {@link GraphData} as a Cytoscape element model. Each target becomes a
 * `target` node with a synthetic id (`n0`, `n1`, …); targets that share a
 * parallel {@link GraphNode.group} are nested inside a compound `group` node
 * (`g0`, `g1`, …, assigned by first appearance) that Cytoscape draws as a
 * labelled box. Dependencies become directed edges. An empty graph renders a
 * single placeholder node.
 */
export function cytoscapeElements(data: GraphData): CyElement[] {
  if (data.nodes.length === 0) {
    return [{
      data: { id: "empty", label: "No targets defined" },
      classes: "target",
    }];
  }
  const elements: CyElement[] = [];

  // Assign a compound parent per group, in order of first appearance.
  const groupId = new Map<string, string>();
  for (const n of data.nodes) {
    const g = n.group;
    if (g !== undefined && g !== "" && !groupId.has(g)) {
      const id = `g${groupId.size}`;
      groupId.set(g, id);
      elements.push({ data: { id, label: g }, classes: "group" });
    }
  }

  const id: Record<string, string> = {};
  data.nodes.forEach((n, i) => {
    id[n.name] = `n${i}`;
  });

  // Longest-path depth per target: relax edges over the DAG until stable.
  const depth: Record<string, number> = {};
  for (const n of data.nodes) depth[n.name] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, to] of data.edges) {
      if (depth[to] < depth[from] + 1) {
        depth[to] = depth[from] + 1;
        changed = true;
      }
    }
  }

  data.nodes.forEach((n, i) => {
    const d: CyElementData = {
      id: `n${i}`,
      label: n.name,
      depth: depth[n.name],
    };
    if (n.description !== "") d.description = n.description;
    const g = n.group;
    if (g !== undefined && g !== "") {
      const gid = groupId.get(g);
      if (gid !== undefined) d.parent = gid;
    }
    elements.push({ data: d, classes: "target" });
  });
  data.edges.forEach(([from, to], i) => {
    elements.push({ data: { id: `e${i}`, source: id[from], target: id[to] } });
  });
  return elements;
}

/** Embed a value as a JS literal, neutralising `<` so it can't end the script. */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/* cspell:disable */

/**
 * Render a complete, interactive HTML page for a build graph. The page loads
 * Cytoscape from a pinned CDN, lays the diagram out with the dagre extension,
 * and wires tap handlers so selecting a target dims everything except the
 * targets it connects to (its transitive dependencies and dependents); tapping
 * the background resets. Header controls switch the layout direction
 * (vertical/horizontal) and edge style (curved/orthogonal), fit the graph to
 * the viewport, and export it as a PNG.
 */
export function renderGraphHtml(
  data: GraphData,
  title = "Zuke build graph",
): string {
  const elements = embed(cytoscapeElements(data));
  const count = embed(data.nodes.length);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column; font: 14px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; color: #c8d3e0; background: #070b12; }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem 1rem; padding: .75rem 1rem; border-bottom: 1px solid #161d2b; background: #0a0f1a; z-index: 1; }
  header h1 { font-size: 1rem; margin: 0; font-weight: 700; color: #e6edf6; letter-spacing: .01em; }
  .count { color: #5eead4; }
  .spacer { flex: 1; }
  .ctl { display: inline-flex; align-items: center; gap: .4rem; color: #8d9ab0; font-size: .82rem; }
  select, button { font: inherit; font-size: .85rem; padding: .35rem .6rem; border: 1px solid #243049; border-radius: 6px; background: #111827; color: #c8d3e0; cursor: pointer; }
  select:hover, button:hover { background: #182236; border-color: #34507e; }
  select:disabled { opacity: .5; cursor: not-allowed; }
  #graph {
    flex: 1; min-height: 0; background-color: #070b12;
    background-image:
      linear-gradient(rgba(125, 160, 220, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(125, 160, 220, 0.05) 1px, transparent 1px);
    background-size: 28px 28px;
  }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="count" id="count"></span>
  <span class="spacer"></span>
  <label class="ctl">Layout
    <select id="dir" title="Layout direction">
      <option value="TB">Vertical</option>
      <option value="LR">Horizontal</option>
    </select>
  </label>
  <label class="ctl">Edges
    <select id="edge" title="Edge style">
      <option value="bezier">Curved</option>
      <option value="taxi">Orthogonal</option>
    </select>
  </label>
  <button id="fit" type="button" title="Fit the graph to the viewport">Fit</button>
  <button id="png" type="button" title="Download the graph as a PNG image">PNG</button>
  <button id="reset" type="button" title="Clear the current selection">Reset</button>
</header>
<main id="graph"></main>
<script type="module">
import cytoscape from "${CYTOSCAPE_CDN}";
// Register the dagre layout if it loads; otherwise fall back to a built-in one
// so the diagram still renders rather than blanking the page.
let dagreOk = false;
try {
  const dagre = (await import("${CYTOSCAPE_DAGRE_CDN}")).default;
  cytoscape.use(dagre);
  dagreOk = true;
} catch (err) {
  console.warn("Cytoscape dagre layout unavailable; using breadthfirst", err);
}
let curDir = "TB";
let curEdge = "bezier";
function layoutConfig(dir) {
  if (dagreOk) {
    return { name: "dagre", rankDir: dir, nodeSep: 36, rankSep: 56, edgeSep: 12, fit: true, padding: 30, animate: true, animationDuration: 300 };
  }
  return { name: "breadthfirst", directed: true, spacingFactor: 1.15, padding: 30, animate: true, animationDuration: 300 };
}
const ELEMENTS = ${elements};
const COUNT = ${count};
document.getElementById("count").textContent = COUNT + (COUNT === 1 ? " target" : " targets");
// Colour ramp walked by dependency depth: roots are teal, leaves are pink.
const RAMP = ["#5eead4", "#60a5fa", "#a78bfa", "#f472b6"];
let maxDepth = 0;
for (const el of ELEMENTS) {
  if (typeof el.data.depth === "number" && el.data.depth > maxDepth) maxDepth = el.data.depth;
}
function accentFor(depth) {
  if (!(depth > 0) || maxDepth === 0) return RAMP[0];
  const idx = Math.round((depth / maxDepth) * (RAMP.length - 1));
  return RAMP[Math.min(idx, RAMP.length - 1)];
}
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const cy = cytoscape({
  container: document.getElementById("graph"),
  elements: ELEMENTS,
  minZoom: 0.2,
  maxZoom: 2.5,
  style: [
    { selector: "node.target", style: {
      "label": "data(label)", "text-valign": "center", "text-halign": "center",
      "text-wrap": "wrap", "text-max-width": 160, "shape": "round-rectangle",
      "width": "label", "height": "label", "padding": "14px",
      "font-family": MONO, "font-size": 13, "font-weight": 600,
      "background-color": "#0e1626", "background-opacity": 0.95, "color": "#e8eef7",
      "border-width": 1.5, "border-color": "#2b3a55",
      "underlay-color": "#2b3a55", "underlay-opacity": 0.18, "underlay-padding": 3,
      "underlay-shape": "round-rectangle",
    } },
    { selector: "node.target[accent]", style: {
      "border-color": "data(accent)", "color": "#f2f6fc",
      "underlay-color": "data(accent)", "underlay-opacity": 0.25,
    } },
    { selector: "node.group", style: {
      "label": "data(label)", "text-valign": "top", "text-halign": "center",
      "text-margin-y": 8, "font-family": MONO, "shape": "round-rectangle", "padding": "22px",
      "background-color": "#0c1320", "background-opacity": 0.55,
      "border-width": 1, "border-color": "#243049", "border-style": "dashed",
      "color": "#7f8ca3", "font-size": 12, "font-weight": 700,
    } },
    { selector: "edge", style: {
      "width": 2, "line-color": "#33415e", "opacity": 0.9,
      "target-arrow-color": "#4a5b80", "target-arrow-shape": "triangle",
      "curve-style": "bezier", "arrow-scale": 0.95,
    } },
    { selector: "edge[accent]", style: { "target-arrow-color": "data(accent)" } },
    { selector: ".active", style: { "border-width": 3, "underlay-padding": 5, "underlay-opacity": 0.45 } },
    { selector: ".faded", style: { "opacity": 0.1 } },
  ],
  layout: layoutConfig(curDir),
});
// Colour nodes by depth, then run a gradient down each edge (source → target).
cy.batch(function () {
  cy.nodes("node.target").forEach(function (n) {
    n.data("accent", accentFor(n.data("depth")));
  });
  cy.edges().forEach(function (e) {
    const a = e.source().data("accent") || RAMP[0];
    const b = e.target().data("accent") || RAMP[RAMP.length - 1];
    e.data("accent", b);
    e.style({
      "line-fill": "linear-gradient",
      "line-gradient-stop-colors": a + " " + b,
      "line-gradient-stop-positions": "0% 100%",
    });
  });
});
function reset() { cy.elements().removeClass("faded active"); }
cy.on("tap", "node.target", function (evt) {
  const n = evt.target;
  const hood = n.predecessors().union(n.successors()).union(n);
  cy.elements().addClass("faded");
  hood.removeClass("faded");
  cy.nodes(".group").removeClass("faded");
  n.addClass("active");
});
cy.on("tap", function (evt) { if (evt.target === cy) reset(); });

// Controls.
function applyEdgeStyle() {
  cy.edges().style({
    "curve-style": curEdge === "taxi" ? "taxi" : "bezier",
    "taxi-direction": curDir === "LR" ? "rightward" : "downward",
    "taxi-turn": 20,
  });
}
const dirSel = document.getElementById("dir");
dirSel.disabled = !dagreOk; // breadthfirst ignores direction
dirSel.addEventListener("change", function (e) {
  curDir = e.target.value;
  applyEdgeStyle();
  cy.layout(layoutConfig(curDir)).run();
});
document.getElementById("edge").addEventListener("change", function (e) {
  curEdge = e.target.value;
  applyEdgeStyle();
});
document.getElementById("fit").addEventListener("click", function () { cy.fit(undefined, 30); });
document.getElementById("png").addEventListener("click", function () {
  const uri = cy.png({ full: true, scale: 2, bg: "#070b12" });
  const a = document.createElement("a");
  a.href = uri;
  a.download = "zuke-graph.png";
  a.click();
});
document.getElementById("reset").addEventListener("click", reset);
</script>
</body>
</html>
`;
}

/* cspell:enable */
