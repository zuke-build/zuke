// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The end-of-`setup` "star the repo" prompt: ask once, then help with the
 * answer — star directly through an authenticated `gh`, fall back to opening
 * the repository page in the browser, and fall back again to printing the URL.
 * Every side effect sits behind {@link StarActions} so the flow is testable
 * without a network, a `gh` install, or a browser.
 *
 * @module
 */

import { BrowserTasks } from "@zuke/core";
import { GhTasks } from "@zuke/gh";
import type { SetupHost } from "./setup.ts";
import type { Prompter } from "../mod.ts";

/** The Zuke repository's home page. */
export const ZUKE_REPO_URL = "https://github.com/zuke-build/zuke";

/** The `gh api` endpoint that stars the Zuke repository for the caller. */
const STAR_ENDPOINT = "user/starred/zuke-build/zuke";

/**
 * The side effects behind {@link promptStar}, injectable so tests never spawn
 * `gh` or a browser.
 */
export interface StarActions {
  /** Whether the `gh` CLI is installed and holds a login. */
  ghAuthenticated(): Promise<boolean>;
  /** Star the Zuke repository through `gh api`. */
  starWithGh(): Promise<void>;
  /** Open `url` in the default browser; `false` when it could not launch. */
  openBrowser(url: string): Promise<boolean>;
}

/**
 * Build the real {@link StarActions} over the given task functions. The
 * parameters exist as seams — production uses the defaults ({@link GhTasks}
 * and {@link BrowserTasks}); tests substitute fakes so no process is spawned.
 */
export function realStarActions(
  runGh: typeof GhTasks.run = GhTasks.run,
  apiGh: typeof GhTasks.api = GhTasks.api,
  openUrl: typeof BrowserTasks.open = BrowserTasks.open,
): StarActions {
  return {
    async ghAuthenticated(): Promise<boolean> {
      try {
        const output = await runGh((s) =>
          s.command("auth", "status").quiet().noThrow()
        );
        return output.code === 0;
      } catch {
        return false; // gh not installed (ToolNotFoundError) — use the browser.
      }
    },
    async starWithGh(): Promise<void> {
      await apiGh(STAR_ENDPOINT, (s) => s.method("PUT").silent().quiet());
    },
    async openBrowser(url: string): Promise<boolean> {
      try {
        const output = await openUrl(url, (s) => s.quiet().noThrow());
        return output.code === 0;
      } catch {
        return false; // no opener on this system — fall back to the URL.
      }
    },
  };
}

/** The real {@link StarActions}, backed by `GhTasks` and `BrowserTasks`. */
export const defaultStarActions: StarActions = realStarActions();

/**
 * Ask the user to star the Zuke repository and help with a yes: star through
 * `gh` when it is installed and authenticated, otherwise open the repository
 * page, otherwise print its URL. A "no" is respected silently, and no failure
 * here ever fails the setup that just succeeded.
 */
export async function promptStar(
  host: SetupHost,
  prompter: Prompter,
  actions: StarActions = defaultStarActions,
): Promise<void> {
  if (!prompter.confirm("Enjoying Zuke? Star zuke-build/zuke on GitHub?")) {
    return;
  }
  if (await actions.ghAuthenticated()) {
    try {
      await actions.starWithGh();
      host.log("★ Starred zuke-build/zuke — thank you!");
      return;
    } catch {
      // gh was there but the call failed (network, scope) — try the browser.
    }
  }
  if (await actions.openBrowser(ZUKE_REPO_URL)) {
    host.log(`Opened ${ZUKE_REPO_URL} — click “☆ Star”. Thank you!`);
    return;
  }
  host.log(`Star Zuke at ${ZUKE_REPO_URL} — thank you!`);
}
