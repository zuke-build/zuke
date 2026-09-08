# scripts-to-zuke

Zuke as a replacement for shell scripts, before there is a single target. The
same `release` routine three times, in the order a project usually adopts it:

| Step                                         | What changes                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`scripts/release.sh`](./scripts/release.sh) | The starting point. Works, until a version string has a space in it or someone forgets `set -e`.                                |
| [`scripts/release.ts`](./scripts/release.ts) | The same script with the `$` shell from `@zuke/core/shell`. No build class, no targets: `deno run -A scripts/release.ts 1.1.0`. |
| [`zuke.ts`](./zuke.ts)                       | The steps as targets: each one runnable alone, visible in `--list`, and the git steps through the typed `GitTasks` wrapper.     |

```sh
scripts/release.sh 1.1.0 --dry-run
deno run -A scripts/release.ts 1.1.0 --dry-run
deno run -A zuke.ts tag --version 1.1.0      # clean → test → tag, no push
```

Why the middle step is worth taking on its own:

- `` $`git tag -a ${tag} -m ${message}` `` passes `tag` and `message` as
  discrete argv entries. There is no shell in between, so a value cannot break
  out of the command — the bash script has to trust its quoting.
- A non-zero exit throws. `set -e` is not a thing you can forget.
- `.text()`, `.lines()` and `.code()` replace `$(...)`, `IFS` tricks and `$?`
  with typed values; `.noThrow()` and `.quiet()` are explicit choices rather
  than `|| true` and `> /dev/null 2>&1`.

The last step is where most projects end up once they have two scripts that
share a step: targets give each step a name, a description, and a place in the
graph, and `--list`, `graph`, `--parallel` and `zuke mcp` come for free.
