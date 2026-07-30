# How Zuke compares

Zuke exists for the build that has outgrown a list of commands: a real
dependency graph, typed inputs, external tools driven through checked argv, and
pipelines that have to survive waiting for something outside the build.

It is also a **young, single-maintainer project**, though no longer a pre-1.0
one: all 54 JSR packages are `1.x` and follow full semver (see
[Versioning & compatibility](./versioning.md) for what that promises). The
package a consumer actually installs is the `@zuke/cli` command — `1.x` too, and
the front door to the `mcp`, `resume` and `cancel` surface below.

**Scope:** tools a JavaScript or TypeScript team would realistically choose, on
the capabilities Zuke was built to provide. [NUKE](https://nuke.build/) is
deliberately absent — it needs the .NET SDK — even though it is the direct
precedent for Zuke's design and is credited as such in the
[acknowledgements](../README.md#acknowledgements).

A **—** means the capability was **not found in the official documentation
reviewed** for this page. That is weaker evidence than a positive finding: the
docs may simply be silent.

<div style="overflow-x: auto">

| Capability                        | Zuke                                        | `deno task`                    | npm scripts                    | GNU Make                | Nx                                | Turborepo                     | Dagger                             |
| --------------------------------- | ------------------------------------------- | ------------------------------ | ------------------------------ | ----------------------- | --------------------------------- | ----------------------------- | ---------------------------------- |
| Dependency wiring                 | typed `this.field` references               | JSON array of task names       | none (`pre`/`post` naming)     | Makefile prerequisites  | JSON `dependsOn` + inferred graph | JSON `dependsOn`              | inferred from code data flow       |
| Bad reference caught              | compile error, then pre-flight scan         | CLI name yes; in-array unknown | only for a directly-run script | yes, before any recipe  | when the task graph is built      | yes, before the run starts    | compile error in the host language |
| Authoring language                | TypeScript, no DSL                          | JSON + shell subset            | JSON + shell strings           | Makefile DSL            | JSON + TypeScript executors       | JSON + `package.json` scripts | Go/Python/TypeScript/… code        |
| Typed wrappers for tool flags     | 50+ `*Tasks` packages                       | no                             | no                             | no                      | executor options, JSON-schema     | no                            | no (plain `withExec` argv)         |
| Command construction              | argv arrays end to end, no shell            | built-in shell subset          | OS shell strings               | shell per recipe line   | per-executor, no stated contract  | `package.json` shell strings  | argv arrays                        |
| Suspend and resume a run          | `.waitsFor()` + `zuke resume`               | —                              | —                              | —                       | —                                 | —                             | —                                  |
| Cancellation with compensations   | `.onCancel()`, reverse order                | —                              | —                              | —                       | —                                 | —                             | cancel visible in traces only      |
| Long-lived process dependencies   | `service()`                                 | —                              | —                              | —                       | `continuous: true`                | `persistent` + `with`         | —                                  |
| MCP server for agents             | built in (`zuke mcp`)                       | —                              | —                              | —                       | official `nx-mcp`                 | proposed, not shipped         | modules exposed as MCP servers     |
| Machine-readable self-description | `--list --json`, generated `llms.txt`       | —                              | `npm pkg get scripts`          | —                       | workspace/graph tools over MCP    | —                             | typed API + MCP                    |

</div>

Checked against official documentation on 2026-07-28.
