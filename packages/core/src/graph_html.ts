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
  data.nodes.forEach((n, i) => {
    const d: CyElementData = { id: `n${i}`, label: n.name };
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
 * the background resets.
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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column; font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #fafafa; }
  header { display: flex; align-items: center; gap: 1rem; padding: .75rem 1rem; border-bottom: 1px solid #e2e2e2; background: #fff; z-index: 1; }
  header h1 { font-size: 1rem; margin: 0; font-weight: 600; }
  .count { color: #666; }
  .spacer { flex: 1; }
  .hint { color: #666; }
  button { font: inherit; padding: .35rem .8rem; border: 1px solid #cfcfcf; border-radius: 6px; background: #fff; cursor: pointer; }
  button:hover { background: #f0f0f0; }
  #graph { flex: 1; min-height: 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e6e6; background: #16181d; }
    header { background: #1d2025; border-color: #2c2f36; }
    .count, .hint { color: #9aa0aa; }
    button { background: #23262c; border-color: #3a3e46; color: inherit; }
    button:hover { background: #2c3037; }
  }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="count" id="count"></span>
  <span class="spacer"></span>
  <span class="hint">Click a target to highlight what it connects to</span>
  <button id="reset" type="button">Reset</button>
</header>
<main id="graph"></main>
<script type="module">
import cytoscape from "${CYTOSCAPE_CDN}";
// Register the dagre layout if it loads; otherwise fall back to a built-in one
// so the diagram still renders rather than blanking the page.
let layout = { name: "breadthfirst", directed: true, spacingFactor: 1.15, padding: 30 };
try {
  const dagre = (await import("${CYTOSCAPE_DAGRE_CDN}")).default;
  cytoscape.use(dagre);
  layout = { name: "dagre", rankDir: "TB", nodeSep: 36, rankSep: 56, edgeSep: 12, fit: true, padding: 30 };
} catch (err) {
  console.warn("Cytoscape dagre layout unavailable; using breadthfirst", err);
}
const ELEMENTS = ${elements};
const COUNT = ${count};
document.getElementById("count").textContent = COUNT + (COUNT === 1 ? " target" : " targets");
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
const palette = dark
  ? { node: "#23262c", nodeBorder: "#3a3e46", text: "#e6e6e6", edge: "#5b606b", group: "#1f2937", groupBorder: "#3a4658", groupText: "#9aa0aa", accent: "#6ea8fe" }
  : { node: "#ffffff", nodeBorder: "#cfcfcf", text: "#1a1a1a", edge: "#b3b3b3", group: "#f1f5fb", groupBorder: "#c7d4e6", groupText: "#5a6b86", accent: "#3b82f6" };
const cy = cytoscape({
  container: document.getElementById("graph"),
  elements: ELEMENTS,
  minZoom: 0.2,
  maxZoom: 2.5,
  style: [
    { selector: "node.target", style: {
      "label": "data(label)", "text-valign": "center", "text-halign": "center",
      "text-wrap": "wrap", "text-max-width": 160, "shape": "round-rectangle",
      "width": "label", "height": "label", "padding": "12px",
      "background-color": palette.node, "border-width": 1, "border-color": palette.nodeBorder,
      "color": palette.text, "font-size": 13, "font-weight": 500,
    } },
    { selector: "node.group", style: {
      "label": "data(label)", "text-valign": "top", "text-halign": "center",
      "text-margin-y": 6, "shape": "round-rectangle", "padding": "18px",
      "background-color": palette.group, "background-opacity": dark ? 0.5 : 1,
      "border-width": 1, "border-color": palette.groupBorder, "border-style": "dashed",
      "color": palette.groupText, "font-size": 12, "font-weight": 600,
    } },
    { selector: "edge", style: {
      "width": 1.5, "line-color": palette.edge, "target-arrow-color": palette.edge,
      "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.9,
    } },
    { selector: ".active", style: { "border-width": 2.5, "border-color": palette.accent } },
    { selector: ".faded", style: { "opacity": 0.12 } },
  ],
  layout,
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
document.getElementById("reset").addEventListener("click", reset);
</script>
</body>
</html>
`;
}

/* cspell:enable */
