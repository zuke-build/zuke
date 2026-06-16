# Core concepts

| Concept              | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| **Build**            | A class extending `Build`. Each target is a field.                    |
| **Target**           | A named unit of work: a description, dependencies, and a body.        |
| **Dependency graph** | A DAG derived from `.dependsOn(...)`. Cycles are an error.            |
| **Plan**             | The requested target's transitive dependencies, topologically sorted. |
| **Executor**         | Runs the plan sequentially, with timing and pass/fail reporting.      |

## Execution semantics

1. Instantiate the build class.
2. Discover targets by property introspection.
3. Build the dependency graph from `.dependsOn(...)`.
4. **Validate:** an undefined/unknown dependency or a cycle fails fast (with the
   offending path) and exits `1`.
5. Compute the requested target's transitive closure.
6. **Topologically sort** (honouring `before`/`after`); v0 runs
   **sequentially**.
7. Run each body. On throw, stop and report.
8. Each target runs **at most once** per invocation — diamond dependencies
   dedupe.
