/**
 * The effectful side of `zuke graph`: write the rendered HTML under the
 * repository's `.zuke/` directory and open it in the default browser.
 *
 * Side effects go through an injectable {@link GraphHost} (and an injectable
 * browser opener) so the orchestration stays unit-testable; {@link
 * defaultGraphHost} is the real `Deno`-backed implementation.
 *
 * @module
 */

import { graphData, renderGraphHtml } from "./graph_html.ts";
import { findConfigDir, pathExists } from "./config.ts";
import { absolutePath } from "./path.ts";
import type { TargetBuilder } from "./target.ts";

/** Spawn a detached command (binary + args); used to launch a browser. */
export type Spawn = (cmd: string, args: string[]) => Promise<void>;

/** The platform-appropriate command to open `target` in the default app. */
export function browserCommand(
  os: typeof Deno.build.os,
  target: string,
): [string, string[]] {
  if (os === "windows") return ["cmd", ["/c", "start", "", target]];
  if (os === "darwin") return ["open", [target]];
  return ["xdg-open", [target]];
}

/** The real spawner: run the opener, discarding its output. */
const denoSpawn: Spawn = async (cmd, args) => {
  await new Deno.Command(cmd, { args, stdout: "null", stderr: "null" })
    .output();
};

/**
 * Open `target` in the default browser, swallowing failures (e.g. a headless
 * CI machine with no opener) — the caller has already reported the file path.
 */
export async function openInBrowser(
  target: string,
  os: typeof Deno.build.os = Deno.build.os,
  spawn: Spawn = denoSpawn,
): Promise<void> {
  const [cmd, args] = browserCommand(os, target);
  try {
    await spawn(cmd, args);
  } catch {
    // No opener available; the path was logged so the user can open it.
  }
}

/** Injected side effects, so {@link graphCommand} is unit-testable. */
export interface GraphHost {
  /** The current working directory (absolute). */
  cwd(): string;
  /** Whether a path exists. */
  exists(path: string): boolean;
  /** Create a directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  /** Write UTF-8 text to a file, creating or truncating it. */
  writeText(path: string, content: string): Promise<void>;
  /** Open a path in the default browser. */
  open(path: string): Promise<void>;
  /** Emit a line of output. */
  log(message: string): void;
}

/** The real, `Deno`-backed {@link GraphHost}. */
export const defaultGraphHost: GraphHost = {
  cwd: () => Deno.cwd(),
  exists: pathExists,
  mkdir: (path) => Deno.mkdir(path, { recursive: true }),
  writeText: (path, content) => Deno.writeTextFile(path, content),
  open: (path) => openInBrowser(path),
  log: (message) => console.log(message),
};

/** Options controlling {@link graphCommand}. */
export interface GraphCommandOptions {
  /** Open the generated file in a browser when done. */
  open: boolean;
  /** Override the output path (default: `<root>/.zuke/graph.html`). */
  out?: string;
}

/** The directory under the repo root where Zuke writes generated artifacts. */
const ARTIFACT_DIR = ".zuke";
/** The default graph file name within {@link ARTIFACT_DIR}. */
const GRAPH_FILE = "graph.html";

/** Resolve `out` against `cwd` unless it is already absolute. */
function resolveOut(cwd: string, out: string): string {
  return /^([A-Za-z]:|[/\\])/.test(out)
    ? absolutePath(out).path
    : absolutePath(cwd, out).path;
}

/**
 * Render the build graph to an HTML file and (optionally) open it. The file
 * lands in `<repo root>/.zuke/graph.html` — the root is located via the
 * `zuke.json` config file, falling back to the cwd — unless `out` overrides it.
 *
 * @returns a process exit code (always 0; rendering cannot fail on valid input).
 */
export async function graphCommand(
  targets: Map<string, TargetBuilder>,
  options: GraphCommandOptions,
  host: GraphHost = defaultGraphHost,
): Promise<number> {
  const html = renderGraphHtml(graphData(targets));
  const cwd = host.cwd();
  const root = findConfigDir(cwd, (path) => host.exists(path)) ?? cwd;
  const outPath = options.out !== undefined
    ? resolveOut(cwd, options.out)
    : absolutePath(root)(ARTIFACT_DIR, GRAPH_FILE).path;

  await host.mkdir(absolutePath(outPath).parent().path);
  await host.writeText(outPath, html);
  host.log(`Wrote build graph to ${outPath}`);
  if (options.open) {
    host.log("Opening it in your browser...");
    await host.open(outPath);
  } else {
    host.log("Open it in a browser to explore the graph.");
  }
  return 0;
}
