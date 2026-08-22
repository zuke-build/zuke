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

/** Star through `gh`, reporting success; `false` sends the caller onward. */
async function starViaGh(
  host: SetupHost,
  actions: StarActions,
): Promise<boolean> {
  try {
    await actions.starWithGh();
  } catch {
    return false; // gh was there but the call failed (network, scope).
  }
  host.log("★ Starred zuke-build/zuke — thank you!");
  return true;
}

/** Open the repo page, reporting success; `false` sends the caller onward. */
async function openRepoPage(
  host: SetupHost,
  actions: StarActions,
): Promise<boolean> {
  try {
    if (!(await actions.openBrowser(ZUKE_REPO_URL))) return false;
  } catch {
    return false; // no opener on this system — fall back to the URL.
  }
  host.log(`Opened ${ZUKE_REPO_URL} — click “☆ Star”. Thank you!`);
  return true;
}

/**
 * Ask the user to star the Zuke repository and help with a yes. The `gh` login
 * is probed *before* asking, so the question says what a yes will do: with an
 * authenticated `gh`, that the star is placed on their behalf through it;
 * without one, that the repository page opens in the browser (falling back to
 * printing its URL). A "no" is respected silently, and no failure here ever
 * fails the setup that just succeeded.
 */
export async function promptStar(
  host: SetupHost,
  prompter: Prompter,
  actions: StarActions,
): Promise<void> {
  let authed = false;
  try {
    authed = await actions.ghAuthenticated();
  } catch {
    // A probe failure only means the browser path — never a failed setup.
  }
  const how = authed
    ? "uses your gh login to star on your behalf"
    : "opens the repo page in your browser";
  if (
    !prompter.confirm(`Enjoying Zuke? Star zuke-build/zuke on GitHub? (${how})`)
  ) {
    return;
  }
  if (authed && (await starViaGh(host, actions))) return;
  if (await openRepoPage(host, actions)) return;
  host.log(`Star Zuke at ${ZUKE_REPO_URL} — thank you!`);
}
