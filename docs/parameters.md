# Parameters

Parameters are typed inputs to a build. You declare them as class fields — just
like targets — and read the resolved value inside a target. The execution engine
resolves every parameter **before any target runs**, from (in order of
precedence):

1. a command-line flag — `--environment production` or
   `--environment=production`
2. an environment variable — `ENVIRONMENT`
3. a [secret source](./secrets.md) declared with `.from(...)`
4. the declared default

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
    console.log(
      `Deploying to ${this.environment.value} with ${this.workers.value} workers`,
    );
  });
}

await run(Deploy);
```

```sh
./zuke deploy --environment production --workers 8 --dry-run
ENVIRONMENT=staging ./zuke deploy        # value from the environment
```

## Declaring

`parameter(description?)` starts a **string** parameter. Configure it fluently;
each call refines the value type, so `value` is exactly as strong as the
declaration:

| Method               | Effect                                        | `value` type          |
| -------------------- | --------------------------------------------- | --------------------- |
| `parameter("…")`     | optional string                               | `string \| undefined` |
| `.number()`          | parse as a number                             | `number \| undefined` |
| `.boolean()`         | a flag; defaults to `false`                   | `boolean`             |
| `.options("a", "b")` | restrict a string to choices                  | unchanged             |
| `.default(v)`        | provide a default                             | non-optional (`T`)    |
| `.required()`        | must be supplied                              | non-optional (`T`)    |
| `.env("NAME")`       | override the env var name                     | unchanged             |
| `.secret()`          | mark the value sensitive (masked everywhere)  | unchanged             |
| `.from(source)`      | resolve from a [secret manager](./secrets.md) | unchanged             |
| `.array()`           | a comma-separated / repeatable list           | `T[]`                 |

`.number()` and `.boolean()` come first (they change the kind); `.options()`
applies to strings; `.required()`/`.default()` set optionality; and `.array()`
comes **last** and composes with everything before it — so a required list is
`.required().array()` (in that order). A required parameter with no value (and
no default) fails the build before any target runs, with a message naming the
flag and env var — unless it can be supplied interactively (below).

## Lists

`.array()` turns a string parameter into a list. On the command line, a comma
separates values **or** the flag is repeated (the two are equivalent); blank
entries are dropped. An unsupplied **optional** list defaults to `[]`; make it
`.required().array()` to reject a missing value instead (the required flag
carries through `.array()`).

```ts
tags = parameter("Image tags").array();
// deploy = target().executes(() => console.log(this.tags.value)); // string[]
```

```sh
./zuke deploy --tags latest,canary      # ["latest", "canary"]
./zuke deploy --tags latest --tags canary  # same result
TAGS=latest,canary ./zuke deploy        # from the environment
```

`.array()` composes with the kind and choices declared before it — every
**element** is validated, not just the raw string:

```ts
// number[]: each entry parsed as a number; "1,x" is rejected.
workers = parameter("Worker ids").number().array();

// each element must be one of the choices; "api,nope" is rejected.
services = parameter("Services").options("api", "web", "worker").array();

// required list: missing --repos fails the build (not a silent []).
repos = parameter("Repos to deploy").required().array();
```

## Secrets

`.secret()` marks a value sensitive. Its resolved value is **redacted from all
of Zuke's output** — every banner, target status, summary, and error message —
and, under GitHub Actions, Zuke also emits an `::add-mask::` so the runner masks
it in its own logs.

```ts
token = parameter("Deploy token").secret().required();
```

Pair `.secret()` with `.from(source)` to fetch the value from a secret manager
(1Password, Vault, a mounted file, …) instead of the environment:

```ts
import { execSecret } from "jsr:@zuke/core";

token = parameter("Deploy token")
  .secret()
  .from(
    execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")),
  );
```

The [Secrets guide](./secrets.md) covers sources, resolution precedence, and the
exact redaction guarantee (and its boundary) in full.

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
