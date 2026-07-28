# Shell wrapper (`$`)

Ergonomic process execution built on `Deno.Command`, imported from the `shell`
submodule:

```ts
import { $ } from "jsr:@zuke/core/shell";

await $`deno test -A`; // throws on non-zero exit
const sha = await $`git rev-parse HEAD`.text(); // trimmed stdout
const files = await $`git diff --name-only`.lines(); // string[]
const code = await $`flaky-cmd`.noThrow().code(); // exit code, never throws
await $`build`.env({ NODE_ENV: "prod" }).cwd("./app").quiet();
```

| Member         | Behaviour                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `` $`…` ``     | Builds a lazy command. Awaiting it runs the process and **throws `CommandError` on non-zero exit** by default. |
| `.text()`      | Run; resolve to trimmed stdout. Throws on non-zero (unless `.noThrow()`).                                      |
| `.lines()`     | Run; resolve to `string[]` (stdout split on newlines; empty output → `[]`).                                    |
| `.code()`      | Run; resolve to the numeric exit code. **Never throws** on non-zero.                                           |
| `.noThrow()`   | Suppress throwing on non-zero exit.                                                                            |
| `.env(record)` | Merge environment variables.                                                                                   |
| `.cwd(path)`   | Set the working directory.                                                                                     |
| `.quiet()`     | Suppress live stdout/stderr streaming.                                                                         |

Awaiting a command resolves to a `CommandOutput`
(`{ code, stdout, stderr, truncated }`, plus a `.text()` helper for trimmed
stdout).

**Bounded capture:** each captured stream keeps at most 8 MiB, so a runaway child
cannot grow the buffer until the run dies. Past the cap the **newest** bytes are
kept, `truncated` is `true`, and `.text()` prefixes
`[output truncated to last 8 MiB]`. Raise or lower it per command with
`.maxCapturedBytes(bytes)` — the same setting exists on every tool wrapper's
settings lambda, so `SomeTasks.run((s) => s.maxCapturedBytes(64 * 1024 * 1024))`
raises it for a tool whose whole output must be parsed. The cap must be a
positive whole number of bytes; there is no unlimited value, so pass a cap larger
than the output you expect. Live streaming to the terminal is never capped.

**Safety:** interpolated values become **discrete argv entries** — they are never
spliced into a shell string, and no shell is involved at all — so there is **no
shell-injection surface**. Arrays expand to multiple arguments:

```ts
const files = ["a.ts", "b.ts"];
await $`deno fmt ${files}`; // → ["deno", "fmt", "a.ts", "b.ts"]
const dirty = "; rm -rf /";
await $`echo ${dirty}`; // prints the literal string; runs nothing else
```

That is shell injection, and only shell injection. **Argument injection is still
yours to validate:** a value beginning with `-` is passed through faithfully as
one argv entry, and the invoked tool reads it as a **flag**, not as data.

```ts
const ref = "--output=/tmp/leak"; // untrusted
await $`git diff --name-only ${ref}`; // git honours it as an option
```

So validate any untrusted value you interpolate into a leading position —
reject a leading `-`, or separate data from options with `--` where the tool
supports it. Zuke does this for the inputs it accepts itself: `--affected`
rejects a base revision starting with `-` for exactly this reason.

By default a command streams its output live to your terminal and captures
stdout; `.text()`/`.lines()` capture without echoing; `.quiet()` does neither.
