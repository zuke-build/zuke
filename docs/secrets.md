# Secrets

Builds need secrets — a deploy token, a registry password, an API key. Zuke
treats a secret as a **parameter with two extra guarantees**:

1. **It can be sourced from a secret manager** at run time with `.from(source)`,
   so the value never has to be pasted into a shell, a `.env` file, or CI YAML.
2. **Its resolved value is redacted from all of Zuke's output** — so a secret
   cannot leak into a log, a summary, or an error message, on any platform.

```ts
import { Build, execSecret, parameter, run, target } from "jsr:@zuke/core";

class Deploy extends Build {
  token = parameter("Deploy token")
    .secret()
    .from(
      execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")),
    );

  deploy = target().executes(async () => {
    await fetch("https://api.example.com/deploy", {
      headers: { authorization: `Bearer ${this.token.value}` },
    });
  });
}

await run(Deploy);
```

A secret is still an ordinary [parameter](./parameters.md): it has a flag and an
environment variable, it can be `.required()`, `.number()`, and so on.
`.secret()` adds redaction; `.from(...)` adds a run-time provider.

## Marking a value secret

`.secret()` marks a parameter sensitive. From then on Zuke masks its resolved
value wherever it prints:

- Every line the executor writes through its reporter — banners, per-target
  status, the build summary, and **error messages** (including a target that
  throws with the secret in its message, or a parse error on a malformed value).
- The rendered **command line** of any `$` command: the echo under `--dry-run`, a
  `CommandError`/`CommandTimeoutError` message, and a spawned service's recorded
  line. A secret passed to a command as an argv token is masked there even if the
  build prints the line itself, because the masking happens where the line is
  built rather than at the reporter. The argv handed to the operating system is
  unchanged — the command still works.
- Under GitHub Actions, Zuke additionally emits `::add-mask::<value>` so the
  runner masks the value in its own log stream.

The mask is the literal text `[redacted]`. Matching is a plain substring
replace, never a regular expression, so a secret containing regex-significant
characters is masked literally and there is no injection surface.

A **multi-line** secret — a PEM private key is the common one — is masked line
by line as well as whole. Both sinks read a line at a time: Zuke's redactor
rewrites one reporter line, and the Actions runner reads an `::add-mask::`
directive to the end of *its* line. So a key registered only as one string would
match no line of itself, and the whole of it after the header would print in the
clear. Each of its lines is registered as its own pattern, and one directive is
emitted per line rather than one carrying the whole key. Lines under eight
characters are skipped, since a two-character fragment identifies nothing and
would mask ordinary text wherever it appeared; the value as a whole stays
registered regardless.

```ts
token = parameter("Deploy token").secret().required();
// --token …, or the TOKEN env var; redacted everywhere Zuke prints it.
```

### What redaction does — and does not — cover

Redaction is **guaranteed for everything Zuke itself prints**. It is applied by
wrapping the executor's reporter, so it does not depend on running under a CI
host that happens to mask logs.

It does **not** reach inside a subprocess a target spawns: if a command a target
runs echoes the secret to _its own_ stdout/stderr, that output streams straight
to the terminal without passing through Zuke's reporter. Two mitigations apply:

- Under GitHub Actions, the `::add-mask::` directive Zuke emits makes the runner
  mask the value in subprocess output too.
- As a rule, don't pass secrets as command-line arguments (they show up in
  process listings) or echo them; pass them through the environment or stdin.

## Secret sources

A **source** resolves a secret's value on demand. Attach one with
`.from(source)`. Zuke ships two dependency-free source builders; both shell out
to a tool you already trust rather than bundling a provider SDK.

### `execSecret` — run a command, take its stdout

For any secret manager with a CLI: 1Password (`op`), HashiCorp Vault (`vault`),
Google Secret Manager (`gcloud`), Doppler, AWS (`aws`), and so on.

```ts
import { execSecret } from "jsr:@zuke/core";

// 1Password
.from(execSecret((s) => s.command("op").arg("read", "op://vault/deploy/token")))

// HashiCorp Vault
.from(execSecret((s) =>
  s.command("vault").arg("kv", "get", "-field=token", "secret/ci/deploy")
))

// Google Secret Manager
.from(execSecret((s) =>
  s.command("gcloud")
    .arg("secrets", "versions", "access", "latest", "--secret=deploy-token")
))
```

The command runs quietly (its output is captured, never streamed to the
terminal), and its standard output becomes the value. A non-zero exit fails the
build with a `SecretError` naming the command and its exit code.

| `ExecSecretSettings` method | Effect                                               |
| --------------------------- | ---------------------------------------------------- |
| `.command(binary)`          | the executable to run (**required**)                 |
| `.arg(...values)`           | append one or more arguments (repeatable)            |
| `.env(record)`              | extra environment variables for the process          |
| `.cwd(path)`                | working directory for the process                    |
| `.trim(on = true)`          | trim surrounding whitespace from stdout (default on) |

Turn `.trim(false)` on for a whitespace-sensitive value (rare — most tokens are
a single line and trimming the trailing newline is what you want).

### `fileSecret` — read a file

For a secret mounted into the environment as a file — a Kubernetes/Docker
secret, or a CI-provided credential file.

```ts
import { fileSecret } from "jsr:@zuke/core";

.from(fileSecret((s) => s.path("/run/secrets/registry_password")))
```

| `FileSecretSettings` method | Effect                                   |
| --------------------------- | ---------------------------------------- |
| `.path(path)`               | the file to read (**required**)          |
| `.trim(on = true)`          | trim surrounding whitespace (default on) |

A missing or unreadable file fails the build with a `SecretError` naming the
path.

## Resolution precedence

A source is a **fallback provider, not an override**. Zuke resolves a parameter
from, in order:

1. a command-line flag (`--token …`)
2. the environment variable (`TOKEN`)
3. the `.from(...)` source
4. the declared default

So the source is consulted only when neither a flag nor an environment variable
supplied a value. This is what makes the same build portable: in CI, a token is
usually injected as an environment variable (and the source is never invoked);
on a developer's machine, the source pulls it from their secret manager. Neither
path requires a code change.

Because a source runs a subprocess or reads a file, parameter resolution is
asynchronous — but this is entirely internal; a build declares parameters
exactly as before.

## Errors

A source that fails is reported as a parameter error, before any target runs —
the same as a missing required value:

```
Invalid or missing parameters:
  --token: execSecret command "op" exited with code 1: [ERROR] not signed in
```

`SecretError` is exported for handling in programmatic use. The value returned
by a source is registered for redaction **before** it is parsed, so even a parse
error on a malformed secret (e.g. a `.secret().number()` whose source returns a
non-number) is masked rather than echoed.

The failure message deliberately includes the source's own output — a command's
exit code and trimmed stderr, or the file-read error — so a misconfigured source
is debuggable from the log. A source whose value never resolved has nothing
registered for redaction, so **this one message is not masked**: choose a source
command that reports failures on stderr without echoing the secret itself
(secret managers such as `op`, `vault`, and `gcloud` do). This is the same
boundary as any subprocess a target spawns.

## A complete example

```ts
import {
  Build,
  execSecret,
  fileSecret,
  parameter,
  run,
  target,
} from "jsr:@zuke/core";

class Release extends Build {
  // From 1Password locally; from the REGISTRY_TOKEN env var in CI.
  registryToken = parameter("Container registry token")
    .secret()
    .from(
      execSecret((s) => s.command("op").arg("read", "op://ci/registry/token")),
    );

  // A cluster token mounted into the deploy job as a file.
  clusterToken = parameter("Cluster token")
    .secret()
    .from(fileSecret((s) => s.path("/run/secrets/cluster_token")));

  publish = target().executes(async () => {
    // Prefer the environment/headers over argv, so the secret never appears in
    // a process list. Anything printed here that contains the value is masked.
    await fetch("https://registry.example.com/publish", {
      method: "POST",
      headers: { authorization: `Bearer ${this.registryToken.value}` },
    });
  });
}

await run(Release);
```

## Reference

- `execSecret`, `fileSecret`, `ExecSecretSettings`, `FileSecretSettings`,
  `SecretSource`, and `SecretError` are exported from `@zuke/core`; see the
  generated API blocks in
  [`packages/core/README.md`](../packages/core/README.md) and
  [`llms-full.txt`](../llms-full.txt).
- Parameters in general: [Parameters](./parameters.md).
- Installing the CLIs a source shells out to:
  [Installing tools](./installing-tools.md).
