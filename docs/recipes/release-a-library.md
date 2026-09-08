# Recipe: release a small library

Build, test, bump the version, tag, push, cut the GitHub release, write the
notes, publish. For a small library this is where the real pain lives: a
routine you run once a month, from a script that grew ugly, with a step you
always forget. This recipe is that routine as one chain of targets — every step
a typed wrapper, and a chain you can stop anywhere.

## The chain

<!-- check -->

```ts
import { Build, FileTasks, parameter, run, target } from "jsr:@zuke/core";
import { DenoTasks } from "jsr:@zuke/deno";
import { GhTasks } from "jsr:@zuke/gh";
import { GitTasks } from "jsr:@zuke/git";

class Release extends Build {
  // `--version 1.1.0` on the command line, or VERSION in the environment.
  // Required: a missing value is an error before anything runs.
  version = parameter("The version to release, e.g. 1.1.0").required();

  check = target()
    .description("Type-check the public entrypoint")
    .executes(() => DenoTasks.check((s) => s.paths("mod.ts")));

  test = target()
    .description("Run the tests")
    .dependsOn(this.check)
    .executes(() => DenoTasks.test((s) => s.allowAll()));

  bump = target()
    .description("Write the version into jsr.json and commit it")
    .dependsOn(this.test)
    .executes(async () => {
      const manifest: Record<string, unknown> = JSON.parse(
        await FileTasks.readText("jsr.json"),
      );
      const bumped = { ...manifest, version: this.version.value };
      await FileTasks.writeText(
        "jsr.json",
        `${JSON.stringify(bumped, null, 2)}\n`,
      );
      await GitTasks.add((s) => s.paths("jsr.json"));
      await GitTasks.commit((s) =>
        s.message(`chore: release ${this.version.value}`)
      );
    });

  tag = target()
    .description("Create the annotated release tag")
    .dependsOn(this.bump)
    .executes(() =>
      GitTasks.tag((s) =>
        s.name(`v${this.version.value}`)
          .message(`Release ${this.version.value}`)
      )
    );

  push = target()
    .description("Push the commit and the tag")
    .dependsOn(this.tag)
    .executes(() => GitTasks.push((s) => s.remote("origin").followTags()));

  release = target()
    .description("Create the GitHub release, with notes generated from the PRs")
    .dependsOn(this.push)
    .executes(() =>
      GhTasks.releaseCreate((s) =>
        s.tag(`v${this.version.value}`).generateNotes().latest()
      )
    );

  publish = target()
    .description("Publish the package to JSR")
    .dependsOn(this.release)
    .executes(() => DenoTasks.publish());

  default = target()
    .description("Default: the whole release")
    .dependsOn(this.publish)
    .executes(() => {});
}

await run(Release);
```

```sh
./zuke --version 1.1.0                   # the whole release
./zuke tag --version 1.1.0               # stop after the tag: a safe local rehearsal
./zuke release --version 1.1.0 --dry-run # print the plan, run nothing
VERSION=1.1.0 ./zuke                     # the parameter from the environment
```

## Why a chain beats a script

- **You can stop anywhere.** `./zuke tag` runs check → test → bump → tag and
  nothing after it; `--dry-run` prints the plan for any target. A script has
  one entry point and a comment that says "don't run past here".
- **Every step is the real CLI, typed.** `GitTasks.tag((s) => s.name(…).message(…))`
  is `git tag -a … -m …`; `GhTasks.releaseCreate((s) => s.generateNotes().latest())`
  is `gh release create --generate-notes --latest`; `DenoTasks.publish()` is
  `deno publish`, which reads your `jsr.json` (or `deno.json`). The flags are
  methods, a typo is a compile error, and the argv is built without a shell.
- **The version is a typed input.** `parameter(…).required()` is read from
  `--version` or `VERSION`, checked before the first target runs, and used in
  the targets as `this.version.value`. `./zuke --list` documents it.
- **The release notes write themselves.** `--generate-notes` turns the merged
  pull requests since the previous tag into the release body.

## Variations

- **npm instead of JSR:** replace the `publish` body with
  `NpmTasks.publish((s) => s.access("public"))` from `@zuke/npm`, and bump
  `package.json` instead of `jsr.json`.
- **A changelog file:** `GhTasks.releaseCreate` also takes `.notesFile(path)`,
  so a `CHANGELOG.md` section you maintain by hand becomes the release body.
- **Fully automated:** `@zuke/release-please` wraps release-please, which opens
  a release pull request from your conventional commits, keeps the changelog,
  and cuts the GitHub release when the PR merges — the routine Zuke uses for
  its own 58 packages (see [`RELEASING.md`](../../RELEASING.md)).
- **Secrets:** a token for `gh` or `npm` is a `parameter("…").secret()`, which
  Zuke masks in every log — see [Secrets](../secrets.md).

The complete project, with a one-function library beside it, is
[`examples/release-library`](../../examples/release-library).
