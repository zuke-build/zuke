# Parameters

Parameters are typed inputs to a build. You declare them as class fields — just
like targets — and read the resolved value inside a target. The execution
engine resolves every parameter **before any target runs**, from (in order of
precedence):

1. a command-line flag — `--environment production` or `--environment=production`
2. an environment variable — `ENVIRONMENT`
3. the declared default

```ts
import { Build, parameter, run, target } from "jsr:@zuke/core";

class Deploy extends Build {
  environment = parameter("Target environment")
    .options("dev", "staging", "production")
    .required();

  workers = parameter("Parallel upload workers").number().default(4);

  dryRun = parameter("Print actions without performing them").boolean();

  deploy = target().executes(() => {
    if (this.dryRun.value) console.log("(dry run)");
    console.log(`Deploying to ${this.environment.value} with ${this.workers.value} workers`);
  });
}

if (import.meta.main) await run(Deploy);
```

```sh
./zuke deploy --environment production --workers 8 --dry-run
ENVIRONMENT=staging ./zuke deploy        # value from the environment
```

## Declaring

`parameter(description?)` starts a **string** parameter. Configure it fluently;
each call refines the value type, so `value` is exactly as strong as the
declaration:

| Method | Effect | `value` type |
| --- | --- | --- |
| `parameter("…")` | optional string | `string \| undefined` |
| `.number()` | parse as a number | `number \| undefined` |
| `.boolean()` | a flag; defaults to `false` | `boolean` |
| `.options("a", "b")` | restrict a string to choices | unchanged |
| `.default(v)` | provide a default | non-optional (`T`) |
| `.required()` | must be supplied | non-optional (`T`) |
| `.env("NAME")` | override the env var name | unchanged |
| `.secret()` | mark the value sensitive | unchanged |

`.number()` and `.boolean()` come first (they change the kind); `.options()`
applies to strings. A required parameter with no value (and no default) fails
the build before any target runs, with a message naming the flag and env var —
unless it can be supplied interactively (below).

## Secrets

`.secret()` marks a value sensitive. Under GitHub Actions, Zuke emits an
`::add-mask::` for the resolved value so it is redacted from the logs.

```ts
token = parameter("Deploy token").secret().required();
```

## Interactive input

When a required parameter is missing and the build runs at an interactive
terminal (a TTY, not CI), Zuke prompts for the value instead of failing. On CI
or non-interactive runs it still errors, so automation stays deterministic.

## Reading

Read a parameter inside a target body via `this.<name>.value`. The value is
fully typed: a `.required()` or `.default()` parameter is non-optional, while a
plain optional parameter is `T | undefined`. Reading `.value` before the build
has resolved parameters (e.g. at construction time) throws.

## Naming

The flag and environment variable are derived from the property name:
`environment` → `--environment` / `ENVIRONMENT`; a camelCase name like
`targetEnv` → `--target-env` / `TARGET_ENV`. Override the environment variable
with `.env("NAME")`.

## Without the CLI

Resolution lives in the execution engine, not the CLI, so a programmatic
[`execute`](./programmatic-api.md) call resolves parameters too — pass raw
values via `params` and/or rely on environment variables:

```ts
import { discoverTargets, execute } from "jsr:@zuke/core";

const build = new Deploy();
const deploy = discoverTargets(build).get("deploy");
if (deploy) {
  await execute(build, deploy, { params: { environment: "production" } });
}
```
