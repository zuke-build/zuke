# Core concepts

| Concept              | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| **Build**            | A class extending `Build`. Each target is a field.                    |
| **Target**           | A named unit of work: a description, dependencies, and a body.        |
| **Dependency graph** | A DAG derived from `.dependsOn(...)`. Cycles are an error.            |
| **Plan**             | The requested target's transitive dependencies, topologically sorted. |
| **Executor**         | Runs the plan (serially or in parallel), with timing and pass/fail reporting. |

## Execution semantics

1. Instantiate the build class.
2. Discover targets by property introspection.
3. Resolve [parameters](./parameters.md) (flags → env → defaults) before any
   target runs.
4. Build the dependency graph from `.dependsOn(...)`.
5. **Validate:** an undefined/unknown dependency or a cycle fails fast (with the
   offending path) and exits `1`.
6. Compute the requested target's transitive closure.
7. **Topologically sort** (honouring `before`/`after`). Targets run one at a time
   in deterministic order by default; [`--parallel`](./cli.md#parallel-execution)
   (or a [`group()`](./authoring.md#group-and-partof)) runs independent targets
   concurrently while still completing every dependency before its dependents.
8. For each target, honour its `onlyWhen` conditions and the incremental
   [cache](./caching.md): a target whose inputs are unchanged is skipped and
   reported `cached`, without running its body.
9. Run each body. On throw, stop and report (unless the target opted into
   `.proceedAfterFailure()`).
10. Each target runs **at most once** per invocation — diamond dependencies
    dedupe.
