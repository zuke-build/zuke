# Recipe: replace your shell scripts

Every small project has a `scripts/release.sh`. It started as three lines,
grew a flag and two guards, and now nobody wants to touch it. This recipe
replaces it with the `$` shell from `@zuke/core/shell` — and nothing else. No
build class, no targets: the smallest possible door into Zuke, and a script you
run exactly as before.

## The script you have

```sh
#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: scripts/release.sh <version>" >&2
  exit 2
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "release: the working tree is not clean" >&2
  exit 1
fi

deno test -A
git tag -a "v$VERSION" -m "Release $VERSION"
git push origin --follow-tags
```

It works, until a version string has a space in it, or someone copies it to a
project without `set -e`, or the `$(...)` quoting is one level off.

## The same script with `$`

<!-- check -->

```ts
#!/usr/bin/env -S deno run -A
import { $ } from "jsr:@zuke/core/shell";

const [version, flag] = Deno.args;
if (version === undefined) {
  console.error("usage: deno run -A scripts/release.ts <version> [--dry-run]");
  Deno.exit(2);
}

const dirty = await $`git status --porcelain`.quiet().text();
if (dirty !== "") throw new Error("release: the working tree is not clean");

await $`deno test -A`;

if (flag === "--dry-run") {
  console.log(`dry run: would tag v${version} and push`);
} else {
  await $`git tag -a ${`v${version}`} -m ${`Release ${version}`}`;
  await $`git push origin --follow-tags`;
}
```

```sh
deno run -A scripts/release.ts 1.1.0 --dry-run
deno run -A scripts/release.ts 1.1.0
```

## What you gained

- **No shell, so nothing to break out of.** Every `${…}` interpolation becomes
  one discrete argv entry; the process is spawned directly. A version with a
  space, a quote, or a `;` in it is just a string — the bash script has to
  trust its quoting.
- **A non-zero exit throws.** `set -e` is not something you can forget, and the
  error names the command and its code. `.noThrow()` is the explicit opt-out,
  and `.code()` gives you the exit code as a number when that is what you want.
- **Typed output.** `.text()` is trimmed stdout, `.lines()` is a `string[]`,
  and both replace `$(...)`, `IFS` tricks and `$?`. `.quiet()` replaces
  `> /dev/null 2>&1`.
- **The rest of TypeScript.** Arrays expand to multiple arguments
  (`` $`deno fmt ${files}` ``), a value can be validated before it is used, and
  the editor knows what `$` returns. See the
  [shell guide](../shell.md) for `.env()`, `.cwd()`, `.killAfter()` and
  `.spawn()`.

## When to take the next step

The moment you have two scripts that share a step, give the steps names. The
same routine as targets — each one runnable alone, visible in `--list`, and
free to depend on the others:

<!-- check -->

```ts
import { Build, parameter, run, target } from "jsr:@zuke/core";
import { $ } from "jsr:@zuke/core/shell";
import { DenoTasks } from "jsr:@zuke/deno";
import { GitTasks } from "jsr:@zuke/git";

class Release extends Build {
  version = parameter("The version to release, e.g. 1.1.0").required();

  clean = target()
    .description("Refuse to release from a dirty working tree")
    .executes(async () => {
      // `$` still works inside a target, for the command that has no wrapper.
      const dirty = await $`git status --porcelain`.quiet().text();
      if (dirty !== "") throw new Error("the working tree is not clean");
    });

  test = target()
    .description("Run the tests")
    .dependsOn(this.clean)
    .executes(() => DenoTasks.test((s) => s.allowAll()));

  tag = target()
    .description("Create the annotated release tag")
    .dependsOn(this.test)
    .executes(() =>
      GitTasks.tag((s) =>
        s.name(`v${this.version.value}`)
          .message(`Release ${this.version.value}`)
      )
    );

  push = target()
    .description("Push the tag")
    .dependsOn(this.tag)
    .executes(() => GitTasks.push((s) => s.remote("origin").followTags()));
}

await run(Release);
```

```sh
./zuke tag --version 1.1.0   # clean → test → tag, and stop there
./zuke --list                # every step, with its description
```

The git steps moved from `$` to the typed `GitTasks` wrapper, where the flags
are methods and a typo is a compile error. `./zuke --list`, `graph`,
`--parallel` and `./zuke mcp` come with the targets for free. All three
versions of this script, side by side, are in
[`examples/scripts-to-zuke`](../../examples/scripts-to-zuke).
