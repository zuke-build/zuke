// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A stand-in for `brew`, run by the running `deno` through the shim
 * `tests/_fake_brew.ts` writes. It records every invocation and imitates just
 * enough of Homebrew for a verification to run against it:
 *
 * - `--repository <tap>` prints `$FAKE_BREW_ROOT/<tap>`;
 * - `tap-new … <tap>` creates that directory's `Formula/`;
 * - `install … <user>/<repo>/<name>` fails unless the formula file is in the
 *   tap, which is what proves the verification copied it there;
 * - `info` prints a canned `--json=v2` document;
 * - a verb named in `$FAKE_BREW_FAIL` exits 1.
 *
 * @module
 */

const log = Deno.env.get("FAKE_BREW_LOG") ?? "";
const root = Deno.env.get("FAKE_BREW_ROOT") ?? "";
const failing = (Deno.env.get("FAKE_BREW_FAIL") ?? "").split(",");
const args = Deno.args;
const verb = args[0] ?? "";
const last = args[args.length - 1] ?? "";

Deno.writeTextFileSync(
  log,
  JSON.stringify({
    args,
    autoUpdate: Deno.env.get("HOMEBREW_NO_AUTO_UPDATE") ?? null,
  }) + "\n",
  { append: true },
);

if (failing.includes(verb)) {
  console.error(`fake brew: ${verb} failed`);
  Deno.exit(1);
}
if (verb === "--repository") {
  console.log(`${root}/${last}`);
} else if (verb === "tap-new") {
  Deno.mkdirSync(`${root}/${last}/Formula`, { recursive: true });
} else if (verb === "install") {
  const [user, repo, name] = last.split("/");
  try {
    Deno.statSync(`${root}/${user}/${repo}/Formula/${name}.rb`);
  } catch {
    console.error("Error: No available formula with the name " + last);
    Deno.exit(1);
  }
} else if (verb === "info") {
  console.log(JSON.stringify({
    formulae: [{
      name: "app",
      full_name: "acme/tap/app",
      tap: "acme/tap",
      desc: "Widget tool",
      homepage: "https://example.com",
      versions: { stable: "1.2.3", head: null, bottle: false },
      installed: [{ version: "1.2.3" }],
      linked_keg: "1.2.3",
      outdated: false,
    }],
    casks: [],
  }));
}
