# Zuke documentation

- [Getting started](./getting-started.md) — install, scaffold, the launcher, and a first build.
- [Core concepts](./concepts.md) — the build/target/graph model and execution semantics.
- [Authoring API](./authoring.md) — `target()`, `Build`, `run()`, and gotchas.
- [Parameters](./parameters.md) — typed build inputs from flags, env, or defaults.
- [Caching](./caching.md) — the incremental build cache and the AI response cache.
- [Shell wrapper (`$`)](./shell.md) — ergonomic, injection-safe process execution.
- [Paths (`absolutePath`)](./paths.md) — the fluent path type.
- [Tools](./tools.md) — the typed tool-wrapper packages and their tasks.
- [Extending Zuke](./extending.md) — the plugin contract: lifecycle plugins, tool wrappers, and reusable target bundles.
- [AI review](./ai-review.md) — model-assessed review gates as build validations.
- [Self-healing builds](./self-healing.md) — hand a failure to an AI fixer that re-runs the command to verify.
- [Using Zuke in a Node/npm project](./node-projects.md) — drive a Node build with Deno.
- [CLI reference](./cli.md) — commands and flags.
- [Programmatic API](./programmatic-api.md) — drive Zuke from your own code.
