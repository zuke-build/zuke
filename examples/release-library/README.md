# release-library

Where the real pain of a small library lives: the release. Build, test, bump,
tag, push, GitHub release, changelog, publish — usually a shell script that grew
ugly and that nobody dares to touch. Here it is as one chain of targets:

```
check ─▶ test ─▶ bump ─▶ tag ─▶ push ─▶ release ─▶ publish ─▶ default
```

```sh
deno run -A zuke.ts --version 1.1.0                   # the whole release
deno run -A zuke.ts tag --version 1.1.0               # stop after the tag
deno run -A zuke.ts release --version 1.1.0 --dry-run # print the plan, run nothing
VERSION=1.1.0 deno run -A zuke.ts                     # the parameter from the env
```

What to notice in [`zuke.ts`](./zuke.ts):

- `version` is a `parameter(...).required()`: a typed build input read from
  `--version` or `VERSION`, resolved before anything runs. Its value is used
  inside the targets as `this.version.value`.
- Each step is a typed wrapper that mirrors the real CLI: `GitTasks.add`,
  `.commit`, `.tag((s) => s.name("v1.1.0").message(...))`,
  `.push((s) => s.followTags())`, then
  `GhTasks.releaseCreate((s) => s.tag("v1.1.0").generateNotes().latest())` — the
  release notes are the merged pull requests since the last tag — and
  `DenoTasks.publish()` reads the [`jsr.json`](./jsr.json) manifest.
- Because it is a chain, you can stop anywhere: `tag` is a safe local dry run of
  everything up to the tag, and `--dry-run` prints the plan for any target.
- Publishing to npm instead is `NpmTasks.publish()` from `@zuke/npm`; a
  release-please flow is `@zuke/release-please`, which opens the release PR and
  cuts the GitHub release for you when it merges.

The library is [`mod.ts`](./mod.ts), one function with a test beside it.
