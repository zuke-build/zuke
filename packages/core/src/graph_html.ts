/**
 * Render a build's dependency graph as a Mermaid flowchart embedded in a
 * self-contained, interactive HTML page.
 *
 * Everything here is pure: {@link graphData} extracts nodes and edges from the
 * discovered targets, {@link toMermaid} renders the flowchart source, and
 * {@link renderGraphHtml} wraps it in a page whose nodes are clickable —
 * selecting a target highlights every other target it connects to. The
 * effectful parts (writing the file, opening a browser) live in `graph_view.ts`.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";

/** Pinned Mermaid build loaded by the generated page (needs network to view). */
const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";

/** A target in the visualised graph. */
export interface GraphNode {
  /** The target's name. */
  name: string;
  /** The target's description, or `""` if none. */
  description: string;
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
    nodes.push({ name, description: t.description_ ?? "" });
    for (const dep of t.dependsOn_) {
      const depName = dep?.name_;
      if (depName !== undefined && targets.has(depName)) {
        edges.push([depName, name]);
      }
    }
  }
  return { nodes, edges };
}

/** Escape a label for a Mermaid quoted-string node (`["..."]`). */
function mermaidLabel(text: string): string {
  return text.replace(/"/g, "&quot;");
}

/**
 * Render {@link GraphData} as Mermaid `flowchart TD` source. Each node gets a
 * synthetic id (`n0`, `n1`, …) so the markup is independent of target names; an
 * empty graph renders a single placeholder node.
 */
export function toMermaid(data: GraphData): string {
  if (data.nodes.length === 0) {
    return 'flowchart TD\n  empty["No targets defined"]';
  }
  const id: Record<string, string> = {};
  data.nodes.forEach((n, i) => {
    id[n.name] = `n${i}`;
  });
  const lines = ["flowchart TD"];
  for (const n of data.nodes) {
    lines.push(`  ${id[n.name]}["${mermaidLabel(n.name)}"]`);
  }
  for (const [from, to] of data.edges) {
    lines.push(`  ${id[from]} --> ${id[to]}`);
  }
  return lines.join("\n");
}

/** A graph node enriched with its synthetic id and adjacency, for the client. */
export interface ClientNode {
  /** Synthetic id matching {@link toMermaid} (`n0`, `n1`, …). */
  id: string;
  /** The target's name. */
  name: string;
  /** The target's description. */
  description: string;
  /** Ids of direct dependencies (targets that run before this one). */
  deps: string[];
  /** Ids of direct dependents (targets that depend on this one). */
  dependents: string[];
}

/** The adjacency model embedded in the page for client-side highlighting. */
export interface ClientModel {
  /** Nodes with their synthetic ids and adjacency. */
  nodes: ClientNode[];
  /** Edges as `[fromId, toId]`, in the same order {@link toMermaid} emits them. */
  edges: Array<[string, string]>;
}

/** Build the {@link ClientModel} that drives the page's interactivity. */
export function clientModel(data: GraphData): ClientModel {
  const nodes: ClientNode[] = data.nodes.map((n, i) => ({
    id: `n${i}`,
    name: n.name,
    description: n.description,
    deps: [],
    dependents: [],
  }));
  const byName: Record<string, ClientNode> = {};
  for (const node of nodes) byName[node.name] = node;
  const edges: Array<[string, string]> = [];
  for (const [from, to] of data.edges) {
    const f = byName[from];
    const t = byName[to];
    f.dependents.push(t.id);
    t.deps.push(f.id);
    edges.push([f.id, t.id]);
  }
  return { nodes, edges };
}

/** Embed a value as a JS literal, neutralising `<` so it can't end the script. */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/* cspell:disable */

/**
 * Render a complete, interactive HTML page for a build graph. The page loads
 * Mermaid from a pinned CDN, draws the flowchart, and wires click handlers so
 * selecting a target dims everything except the targets it connects to (its
 * transitive dependencies and dependents); clicking the background resets.
 */
export function renderGraphHtml(
  data: GraphData,
  title = "Zuke build graph",
): string {
  const src = embed(toMermaid(data));
  const model = embed(clientModel(data));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #1a1a1a; background: #fafafa; }
  header { display: flex; align-items: center; gap: 1rem; padding: .75rem 1rem; border-bottom: 1px solid #e2e2e2; background: #fff; position: sticky; top: 0; z-index: 1; }
  header h1 { font-size: 1rem; margin: 0; font-weight: 600; }
  .count { color: #666; }
  .spacer { flex: 1; }
  .hint { color: #666; }
  button { font: inherit; padding: .35rem .8rem; border: 1px solid #cfcfcf; border-radius: 6px; background: #fff; cursor: pointer; }
  button:hover { background: #f0f0f0; }
  #graph { padding: 1.5rem; }
  #graph svg { max-width: 100%; height: auto; }
  .node { cursor: pointer; }
  svg.zuke-selecting .node, svg.zuke-selecting .edgePaths path { opacity: .12; transition: opacity .15s ease; }
  svg.zuke-selecting .node.zuke-on { opacity: 1; }
  svg.zuke-selecting .edgePaths path.zuke-on { opacity: .85; }
  svg.zuke-selecting .node.zuke-active > * { stroke-width: 2.5px; }
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
<main><div id="graph"></div></main>
<script type="module">
import mermaid from "${MERMAID_CDN}";
const SRC = ${src};
const MODEL = ${model};
mermaid.initialize({ startOnLoad: false, securityLevel: "loose", flowchart: { useMaxWidth: true } });
const host = document.getElementById("graph");
const { svg } = await mermaid.render("zuke-graph", SRC);
host.innerHTML = svg;
const root = host.querySelector("svg");
const byId = new Map(MODEL.nodes.map(function (n) { return [n.id, n]; }));
document.getElementById("count").textContent = MODEL.nodes.length + " targets";
const nodeEls = new Map();
root.querySelectorAll(".node").forEach(function (g) {
  const m = g.id.match(/(?:^|-)(n\\d+)-\\d+$/);
  if (m) nodeEls.set(m[1], g);
});
const edgeEls = Array.prototype.slice.call(root.querySelectorAll(".edgePaths > path"));
function connected(start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = byId.get(stack.pop());
    if (!cur) continue;
    cur.deps.concat(cur.dependents).forEach(function (id) {
      if (!seen.has(id)) { seen.add(id); stack.push(id); }
    });
  }
  return seen;
}
function select(id) {
  const set = connected(id);
  root.classList.add("zuke-selecting");
  nodeEls.forEach(function (g, nid) {
    g.classList.toggle("zuke-on", set.has(nid));
    g.classList.toggle("zuke-active", nid === id);
  });
  edgeEls.forEach(function (p, i) {
    const e = MODEL.edges[i] || [];
    p.classList.toggle("zuke-on", set.has(e[0]) && set.has(e[1]));
  });
}
function reset() {
  root.classList.remove("zuke-selecting");
  nodeEls.forEach(function (g) { g.classList.remove("zuke-on", "zuke-active"); });
  edgeEls.forEach(function (p) { p.classList.remove("zuke-on"); });
}
nodeEls.forEach(function (g, id) {
  g.addEventListener("click", function (ev) { ev.stopPropagation(); select(id); });
});
root.addEventListener("click", function (ev) {
  if (!ev.target.closest(".node")) reset();
});
document.getElementById("reset").addEventListener("click", reset);
</script>
</body>
</html>
`;
}

/* cspell:enable */
