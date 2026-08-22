// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `BrowserTasks` — open a URL in the user's default browser, with the
 * platform's own opener: `open` on macOS, `xdg-open` on Linux, and
 * `rundll32 url.dll,FileProtocolHandler` on Windows (chosen over `cmd /c
 * start`, whose command line re-parses `&` in query strings as a command
 * separator). Only `http:`/`https:` URLs are accepted, so a caller cannot be
 * tricked into launching an arbitrary file or protocol handler.
 *
 * @module
 */

import { type Configure, runSettings, ToolSettings } from "./tooling.ts";
import type { CommandOutput } from "./shell.ts";

/**
 * The platform-appropriate command to open `target` (a URL or file path) in
 * the default app: `open` on macOS, `xdg-open` on Linux, and
 * `rundll32 url.dll,FileProtocolHandler` on Windows. The one copy of this
 * dispatch — {@link BrowserTasksApi.open | BrowserTasks.open} and `zuke
 * graph`'s opener both build their argv from it, so the platform strategy
 * cannot drift between them.
 */
export function browserCommand(
  os: typeof Deno.build.os,
  target: string,
): [string, string[]] {
  if (os === "windows") {
    return ["rundll32", ["url.dll,FileProtocolHandler", target]];
  }
  if (os === "darwin") return ["open", [target]];
  return ["xdg-open", [target]];
}

/**
 * Check that `url` is a well-formed `http:`/`https:` URL, returning its
 * normalized (`URL.href`) form so stray whitespace never reaches the opener.
 *
 * @throws {Error} Naming the offending URL when it does not parse or uses
 * another scheme — the platform openers dispatch on the value, so an
 * unvalidated string could open an arbitrary program instead of a page.
 */
function checkHttpUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `BrowserTasks.open: "${url}" is not a valid URL — pass an absolute ` +
        `http(s) URL, e.g. "https://example.com".`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `BrowserTasks.open: refusing to open "${url}" — only http: and https: ` +
        `URLs are supported, so the platform opener cannot be pointed at an ` +
        `arbitrary program or protocol handler.`,
    );
  }
  return parsed.href;
}

/**
 * Settings for {@link BrowserTasksApi.open | BrowserTasks.open}. The binary and
 * argv are derived from the platform ({@link ToolSettings.os_}); the shared
 * chainers (`quiet`, `noThrow`, `toolPath`, …) apply as on any tool.
 */
export class BrowserOpenSettings extends ToolSettings {
  /** The validated URL this invocation opens. */
  readonly url: string;

  /** Build settings that open `url` (must be `http:`/`https:`). */
  constructor(url: string) {
    super();
    this.url = checkHttpUrl(url);
  }

  /** The platform opener: `open`, `xdg-open`, or `rundll32`. */
  protected override defaultTool(): string {
    return browserCommand(this.os_, this.url)[0];
  }

  /** The opener's argv: the URL, behind the protocol handler on Windows. */
  protected override buildArgs(): string[] {
    return browserCommand(this.os_, this.url)[1];
  }
}

/** The shape of {@link BrowserTasks}. */
export interface BrowserTasksApi {
  /**
   * Open `url` in the default browser. Resolves when the opener process exits
   * (browsers detach, so this is launch, not page load).
   *
   * ```ts
   * await BrowserTasks.open("https://github.com/zuke-build/zuke");
   * ```
   */
  open(
    url: string,
    configure?: Configure<BrowserOpenSettings>,
  ): Promise<CommandOutput>;
}

/** Task functions for the user's browser. */
export const BrowserTasks: BrowserTasksApi = {
  open(
    url: string,
    configure?: Configure<BrowserOpenSettings>,
  ): Promise<CommandOutput> {
    return runSettings(new BrowserOpenSettings(url), configure);
  },
};
