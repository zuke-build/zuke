# Review criteria — accepted designs

Reference material for the **security** reviewer in `zuke.ts`, fed to the model
alongside the diff. It is read from the **diff base** rather than from the
branch under review, so a pull request cannot add a clause telling the reviewer
to overlook what that pull request does. That is the whole reason it is a file
and not an inline `.criteria(...)` string — see
[issue #589](https://github.com/zuke-build/zuke/issues/589) and
[`docs/ai-review.md`](../docs/ai-review.md).

What belongs here: a design this project has already accepted and does not want
restated as a finding on every run. What does not: anything that merely tightens
what gets reported, which is safe to keep inline because it cannot widen a
review. Each entry names the issue where the design was agreed, so a reader can
go and disagree with it there rather than here.

## The global `zuke` command forwards to the project's build (#578)

The global `zuke` command (`@zuke/cli`) forwards every command that is not its
own (`setup`, `import`, `doc`, `--help`, `--version`) to the nearest `zuke.json`
above the working directory and runs the `zuke.ts` beside it with `deno run -A`,
exactly as the `./zuke` launcher does.

That walk-up discovery is the accepted design: it is how npm, Deno and git find
`package.json`, `deno.json` and `.git`, and it is gated like git's
`safe.directory` — the root, the build files in it and every ancestor config
Deno would read must belong to the caller, and the root must not be
world-writable.

Do not report the forwarding, the ancestor walk, the `-A` run of the caller's
own build, or the absence of an opt-in flag as findings. Review the gate's
implementation for concrete bypasses instead.

## A compiled binary resolves a real Deno (#586)

When the CLI is a `deno compile` binary it cannot spawn its own executable as
Deno, so it resolves one: whatever `PATH` gives, then
`${DENO_INSTALL:-~/.deno}/bin/deno`.

That order is the accepted design. It is byte-for-byte the order the generated
launchers already use in bash and PowerShell; the bootstrap directory is their
fallback rather than a pinned copy; and every input to the choice (`PATH`,
`DENO_INSTALL`, `HOME`, `USERPROFILE`) is the invoking user's own environment,
so preferring one over another moves the lever instead of removing it.

Do not report the `PATH`-first ordering, or the environment being read at all,
as findings. Report a concrete path by which input the *caller did not choose*
reaches the spawn.
