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

Awaiting a command resolves to a `CommandOutput` (`{ code, stdout, stderr }`,
plus a `.text()` helper for trimmed stdout).

**Safety:** interpolated values become **discrete argv entries** — they are
never spliced into a shell string — so there is no injection surface. Arrays
expand to multiple arguments:

```ts
const files = ["a.ts", "b.ts"];
await $`deno fmt ${files}`; // → ["deno", "fmt", "a.ts", "b.ts"]
const dirty = "; rm -rf /";
await $`echo ${dirty}`; // prints the literal string; runs nothing else
```

By default a command streams its output live to your terminal and captures
stdout; `.text()`/`.lines()` capture without echoing; `.quiet()` does neither.
