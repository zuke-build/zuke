# Paths (`absolutePath`)

TypeScript has no operator overloading, so a literal `/` path join isn't
possible. `absolutePath` gets as close as the language allows: the returned
`AbsolutePath` is **callable** (and has an equivalent `.join(...)`), so
appending segments reads almost like a path.

```ts
import { absolutePath } from "jsr:@zuke/core";

const root = absolutePath("/app");
const main = root("src", "main.ts"); // callable: /app/src/main.ts
const test = root.join("tests", "x.ts"); // explicit: /app/tests/x.ts

main.name; // "main.ts"
main.stem; // "main"
main.extension; // ".ts"
main.parent(); // AbsolutePath → /app/src
main.relativeTo(root); // "src/main.ts"
main.equals("/app/lib/../src/main.ts"); // true

await $`deno run ${main}`; // toString() → drops straight into $`` and args()
```

Paths are immutable and normalised (forward slashes, `.`/`..` resolved; a
Windows `C:/…` drive prefix is preserved). The base must be absolute — start
with `/` or a drive letter, or build from an absolute base.

## Repo root (`repoRoot`)

`repoRoot` is `absolutePath` anchored at your repository root, so you can build
paths relative to the project no matter where the build is invoked from:

```ts
import { repoRoot } from "jsr:@zuke/core";

repoRoot(); // <root>            (an AbsolutePath)
repoRoot("src", "main.ts"); // <root>/src/main.ts
repoRoot().join("dist"); // <root>/dist
```

The root is the directory containing `zuke.json`, the config file `zuke setup`
scaffolds at your project root. `repoRoot()` walks up from the current working
directory to find it, so the absolute path is **resolved at runtime** — nothing
machine-specific is ever committed. If no `zuke.json` is found in the current
directory or any ancestor, `repoRoot()` throws and points you at `zuke setup`.
