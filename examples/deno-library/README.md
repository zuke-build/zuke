# deno-library

The everyday gate for a Deno package, as five targets and one `ci` that fans out
to all of them:

```
format ─┐
lint ───┼─▶ ci ─▶ default
check ─▶ test ─▶ coverage ─┘
```

```sh
deno run -A zuke.ts            # the whole gate
deno run -A zuke.ts coverage   # check → test → coverage
deno run -A zuke.ts --parallel # format, lint and check run concurrently
```

What to notice in [`zuke.ts`](./zuke.ts):

- Every step is a typed wrapper — `DenoTasks.fmt`, `.lint`, `.check`, `.test`,
  `.coverage` — configured with a settings lambda that mirrors the real flags.
  There is no shell string anywhere.
- `coverage` depends on `test`, which depends on `check`. Ask for `coverage` and
  Zuke runs the chain in order; ask for `ci` and each target still runs exactly
  once.
- `DenoTasks.coverage((s) => s.threshold(95))` is the gate `deno coverage`
  itself does not have: it parses the lcov report and fails the build below the
  threshold.

The library under test is [`mod.ts`](./mod.ts), a one-function module with a
test beside it.
