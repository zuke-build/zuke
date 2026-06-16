/** Test doubles for the core CLI's injectable seams. */

import type { GraphHost } from "../src/graph_view.ts";

/**
 * An in-memory {@link GraphHost} that records writes, directories, browser
 * opens, and logs. `existing` lists paths that {@link exists} reports as present
 * (e.g. a `zuke.json` so {@link cwd}'s root resolves).
 */
export class FakeGraphHost implements GraphHost {
  /** Virtual filesystem: path → contents. */
  readonly files = new Map<string, string>();
  /** Directories passed to {@link mkdir}. */
  readonly dirs: string[] = [];
  /** Paths passed to {@link open}. */
  readonly opened: string[] = [];
  /** Lines passed to {@link log}. */
  readonly logs: string[] = [];

  constructor(
    private readonly cwdPath = "/repo",
    private readonly existing: string[] = [],
  ) {}

  cwd(): string {
    return this.cwdPath;
  }

  exists(path: string): boolean {
    return this.existing.includes(path);
  }

  mkdir(path: string): Promise<void> {
    this.dirs.push(path);
    return Promise.resolve();
  }

  writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    return Promise.resolve();
  }

  open(path: string): Promise<void> {
    this.opened.push(path);
    return Promise.resolve();
  }

  log(message: string): void {
    this.logs.push(message);
  }
}
