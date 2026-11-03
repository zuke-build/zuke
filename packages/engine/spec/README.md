# The tool spec

`tools.json` describes every wrapper's tasks and the settings they are
configured with, read from the wrappers' own `deno doc --json` output by
`./zuke toolSpec` in the Zuke repository, where `toolSpecCheck` fails the gate
when it drifts. An SDK in another language generates its tool facades from it,
so none is written by hand; the Python SDK's generator is the first reader. The
file ships with `@zuke/engine`, so a release's spec is at
`https://jsr.io/@zuke/engine/<version>/spec/tools.json`.

The spec carries only what `tool.call` carries. A task or setter taking a
function, a host, a stream, a signal or an instance of the package's own classes
is left out, and a type JSON flattens is spelled as what travels: a `Date`, a
`URL` and a path are `string`. The wrappers' release versions are not in it; a
wrapper's release is whatever its `deno.json` says at the engine tag the SDK
vendors the spec from.

| Field      | Meaning                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`     | The schema version, bumped when a reader must change.                                                                                        |
| `tooling`  | The settings classes of `@zuke/core`'s tooling base, `ToolSettings` first, that every wrapper's settings extend.                             |
| `packages` | One entry per wrapper package that exports a task the spec carries, in publish order: `name` after `@zuke/`, `summary`, `tasks`, `settings`. |

A `tasks` entry is one `*Tasks` object: its `name`, `doc` and `tasks`, each a
member. A `settings` entry is one settings class a task's `Configure` reaches,
directly, through its base, or through a setter that answers another class: its
`name`, `doc`, `extends` (another entry's name, a `tooling` class, or `null`)
and `setters`, each a member. A member has a `name`, a `doc`, `params` (each
`name`, `type`, `optional`, `rest`) and `returns`. A setter's `returns` is
`self`, the `settings` class it switches to, or `null`.

A `type` is one of:

| `kind`                                | Carries                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `string`, `number`, `boolean`, `null` | The JSON scalar; `null` is also a task that answers nothing.                                 |
| `literal`                             | One `value`, a string, number or boolean.                                                    |
| `union`                               | Any of `members`.                                                                            |
| `array`                               | A list of `element`.                                                                         |
| `record`                              | An object of `key` to `value`.                                                               |
| `object`                              | Plain data of an interface, `name` where it has one, as a JSON object.                       |
| `settings`                            | An instance of the settings class `name`: what a kind-changing setter answers.               |
| `configure`                           | A settings lambda over the class `settings`, sent as `{"configure": [[setter, [args]], …]}`. |
| `output`                              | The `CommandOutput` of a run, as `exec` answers it.                                          |
| `self`                                | A setter's own settings.                                                                     |
| `unknown`                             | A value the spec cannot name; JSON still carries it.                                         |
