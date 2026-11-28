# Troubleshooting a Zuke build

Start cheap: `./zuke --list` shows the targets, their dependencies and the
parameters, and fails fast on a broken definition. `./zuke <target> --dry-run`
prints the plan without running a body. Add `--state` to persist a run record,
then read it with `./zuke runs show <run-id>` (`runs list` finds the id). There
is no `--verbose` or debug switch; `--plain` drops the banner and colour for
clean logs. Messages below are quoted from the code, so match on the distinctive
part.

## Build definition

**Symptom:** `Target "x" depends on an undefined target. This usually means it
references a sibling via this.x that is declared *after* it` **Cause:** class
fields initialise top-to-bottom; `this.y` was `undefined`. **Fix:** move the
referenced target above the one that depends on it.

**Symptom:** `Target "x" depends on a target that was not discovered (...)`
**Cause:** `dependsOn` got a `target()` that is not a field of the build (a
local variable, another instance). **Fix:** assign it to a class field.
`triggers` and the other edges give the same message with their own verb.

**Symptom:** `Dependency cycle detected: a → b → a` **Fix:** break the loop;
`before`/`after` hints are soft, `dependsOn` is not.

**Symptom:** `Target "x" has no body — call .executes(...) before running.`
**Cause:** a target with neither `.executes(...)` nor `.effect(...)` was run.
Fine as a pure aggregate only if nothing selects it as a root that must work.
**Fix:** add `.executes(async () => { ... })`, or run a real target.

**Symptom:** `Unknown target: x. Did you mean "y"?` (exit 1, then the list)
**Fix:** use a name from the list. An unknown flag reads `Unknown flag "--x".
Did you mean ...` or `Run --help to see the available flags.`

**Symptom:** `Target instance is bound to two names: "a" and "b"` **Fix:** one
`target()` per field; do not alias a field to another.

**Symptom:** `Target already declares an effect named "x"` **Fix:** give each
`.effect(name, fn)` on a target a distinct name.

**Symptom:** `Target "x" combines .forEach() with .waitsFor()` (or `.effect()`,
or a stage using `.onFailure()`) **Fix:** put the wait or effect on a separate
target the fan-out `dependsOn`s.

**Symptom:** `Target "x" .validateDuring(...) set no interval` / `set no checks`
**Fix:** call `s.every(...)` and `s.check(...)` in the lambda.

## Tool resolution

**Symptom:** `Tool not found: "x". Install it and make sure it is on PATH, or
point at the binary explicitly with .toolPath(...).` **Cause:** the wrapper
spawned a binary the OS could not find. Resolution mode is per wrapper: `"path"`
spawns the bare name on `PATH`; `"node_modules"` walks up from the working
directory for `node_modules/.bin/<tool>` and falls back to `PATH`. **Fix:**
install the tool, or `.toolPath("/abs/bin")` on that call. To force a mode:
`.fromNodeModules()` / `.fromPath()` per call, or env
`ZUKE_TOOL_RESOLUTION=node_modules|path` (other values are ignored).

**Symptom:** the above plus `A node_modules directory was found but did not
contain "x" — run `npm ci`, or provision it via toolchain().` **Fix:** `npm ci`
in the project (the launcher does this itself on Node), or declare the tool with
`ToolTasks`/`toolchain()` so the build installs it into `.zuke/tools`.

**Symptom:** a tool ran but failed: `CommandError` with the command line, exit
code and stderr **Cause:** nonzero exit with throw-on-error (the default).
**Fix:** read the stderr; `.noThrow()` on the settings only if the code is meant
to be inspected.

**Symptom (provisioning):** `checksum mismatch for "x": expected ..., got ....
The download may be corrupt or tampered with; nothing was installed.` **Fix:**
retry once; if it repeats, the pinned SHA-256 is for another release or
platform. Update the pin from the tool's published checksum.

**Symptom:** `invalid checksum for linux/x64: expected a 64-character hex
SHA-256`, `tool "x" requires .url(...)`, `tool "x": a tree install needs an
archive` **Fix:** correct the `ToolTasks` declaration as the message says.

**Symptom:** `invalid npm tool name`, `invalid version "..." for npm tool`
**Fix:** exact version like `"4.1.9"`, plain package name like `@nestjs/cli`.

## Launcher and runtime

**Symptom:** `zuke: Node N or newer not found — installing ... now...`
**Cause:** `./zuke` found no Node at the pinned major on `PATH` and downloads a
checksum-verified one into `ZUKE_NODE_HOME` (default `~/.zuke/node`). **Fix:**
wait, or put a new enough Node on `PATH`. `NODE_VERSION` overrides need
`NODE_SHA256` too: `NODE_VERSION=... overrides the pinned ..., but no checksum
is pinned for it`.

**Symptom:** `zuke: Deno not found — installing it now...`, or
`DENO_VERSION=latest is not supported`, `no pinned checksum for <target>`
**Fix:** on a Deno project set `DENO_VERSION` to an exact tag plus
`DENO_SHA256`, or install Deno yourself.

**Symptom:** `zuke: checksum mismatch for <asset>:` with `expected` and `got`
**Cause:** the downloaded release does not match the hash the launcher pins.
**Fix:** rerun once (bad download). Persisting: never bypass; regenerate the
launchers with `zuke upgrade --engine`/`zuke setup`, which write matching pins.

**Symptom:** `<lock> was left by an install that did not finish (process N);
remove it and run again.` / `another launcher has held <lock> for 10 minutes`
**Fix:** if no other launcher runs, delete the named lock file.

**Symptom:** a launcher that fails closed: `Deno not found on PATH. Install it,
then re-run this launcher` **Cause:** launchers written with `zuke setup
--no-bootstrap` require the runtime on `PATH`. **Fix:** install the runtime, or
regenerate without that flag.

**Symptom:** `zuke: builds on Deno are supported until October 2027 — run zuke
setup --runtime node to move this project to Node.` **Cause:** informational
notice on stderr, not a failure. Builds on Deno still run until then. **Fix:**
none needed now; migrate with the command it names.

**Symptom:** `zuke: no deno.lock here yet — running without lockfile
verification so Deno can write one.` Notice, not an error; commit the lock.

**Symptom:** `zuke: refusing to run the build at <dir>: the directory is owned
by user N, not you` (or `... is writable by everyone`, or an ancestor
`deno.json`/`package.json` owned by someone else) **Cause:** the global `zuke`
found a `zuke.json` above the working directory and its trust gate (like git's
`safe.directory`) refused it. **Fix:** if you trust it, run that project's own
`./zuke`; otherwise fix the ownership or permissions. Inert on Windows.

**Symptom:** `this zuke's built-in @zuke/engine X cannot run zuke.json's ...` or
`this zuke runs on Node and has no @zuke/engine to run ...` **Cause:** a Python
or other-SDK build (`zuke.json`, no `zuke.ts`) whose pinned engine this `zuke`
cannot serve. It never falls back to Deno. **Fix:** run the project's `./zuke`
(downloads the pinned release), install the `zuke` binary, or `zuke upgrade
--engine`.

**Symptom:** `zuke: no zuke release is built for <os>`, `the zuke command is not
on PATH`, `the zuke on PATH is this launcher` **Fix:** install the binary;
remove the empty or `.` entry from `PATH` for the last one.

## Dependencies

**Symptom:** import of `@zuke/<name>` cannot be resolved (Node or Deno error)
**Cause:** the package is not declared. On Node the alias `@zuke/<name>` is
`npm:@zuke-build/<name>` in `package.json`; on Deno it is the `imports` entry
`jsr:@zuke/<name>@^1` in `deno.json`. **Fix:** `zuke add <name>` (e.g. `zuke add
docker gh`; `--dry-run` previews), then rerun. `zuke remove` is the inverse. A
JSR-only package is refused on Node.

**Symptom:** on Deno, `The lockfile is out of date` (Deno's own message)
**Cause:** `deno.lock` no longer matches the imports; launchers pass `--frozen`.
**Fix:** `zuke relock` regenerates it (backup beside it), then commit it. `zuke
outdated` shows packages the lock resolves behind.

**Symptom:** `zuke add: name at least one package` **Fix:** `zuke add docker`.

## Durable state and runs

State is off unless `--state`, `ZUKE_STATE_DIR` or `ZUKE_STATE_URL` is set (or
the build overrides `stateStore()`). Records live in `.zuke/runs`.

**Symptom:** `resume: no state store is configured. Set ZUKE_STATE_DIR /
ZUKE_STATE_URL, override stateStore(), or pass one.` (also for `cancel` and
`.lock(...)`: `declares .lock("k") but no state store is configured`) **Fix:**
pass `--state` (same store as the run), or set the env var.

**Symptom:** `no run "id" found in the store.` **Fix:** `./zuke runs list
--state`; check you point at the same store.

**Symptom:** `run X was already resumed by <actor> at <time>` or `resume: run X
is "succeeded", not suspended.` **Cause:** exactly one resumer wins; safe for
duplicate webhooks. **Fix:** none. `runs show X` for the state.

**Symptom:** `run X belongs to build "A", but this process is "B"` **Fix:** run
from the owning build, or set `ZUKE_BUILD_ID` to the owner.

**Symptom:** `resume: the build graph changed since run X was suspended (...).
Re-run with --force-graph to override.` **Fix:** revert the graph change, or
`zuke resume X --force-graph` if the bodies that remain are compatible.

**Symptom:** `resume: run X is recorded as degraded — at least one state write
was permanently lost` **Cause:** a target that succeeded may be recorded
`running`/`pending`; resume would rerun it (a deploy twice). **Fix:** `zuke runs
show X` and check what really happened, then `zuke resume X --resume-degraded`
only if repeating is safe.

**Symptom:** `resume: --data is not valid JSON.` / `--data payload is too large`
**Fix:** pass compact valid JSON; trim the payload.

**Symptom:** `resume: run X: ... — run cancelled (...)` **Cause:** a
`.waitsFor()` deadline passed and its `onTimeout` ran. **Fix:** `runs show X`;
raise the timeout or send the signal sooner (`zuke resume X --signal <name>`;
`resume --check` sweeps all suspended runs).

**Symptom:** `Lock "k" is held by ... Wait for that run to finish, or stop it,
then retry.` (or the target's own `onConflict(...)` text) **Cause:** another run
holds the lock key until its TTL expires or it ends. **Fix:** `runs list
--status running`, then `zuke cancel <id>` for a stale one. Own run: `cannot
take lock "k": another target of this same run holds it` means order them with
`dependsOn` or declare `s.holdForRun()`.

**Symptom:** `.lock(...) set no key` / `set no TTL` **Fix:** call
`s.lockKey(...)` (or `s.key`) and `s.withTtl("4h")`.

**Symptom:** `cancel: gave up cancelling X after repeated conflicts.` **Fix:**
retry; another process is writing the record.

## Caching

A target caches only if it declares `.inputs(...)` or `.cacheKey(...)`; one with
`.effect(...)` never caches. Output shows `cached` when its fingerprint matched.

**Symptom:** a target reran unexpectedly **Cause:** any declared input file/dir
content changed (a missing path hashes as absent), or a `cacheKey` value
changed. **Fix:** check `.inputs`/`.cacheKey`; outputs are not inputs.

**Symptom:** a target never reran though its source changed **Cause:** the
changed file is not under a declared input. **Fix:** add it to `.inputs(...)`,
or run with `--no-cache`.

**Symptom:** `remote cache lookup for "x" failed: ...` / `remote cache upload
for "x" failed` / `remote cache restore for "x" was refused, rebuilding`
**Cause:** warnings only; the store is best-effort and the build rebuilds. A
refusal covers a bad archive or `the artifact's signature is missing or does not
match the signing key` (`ZUKE_REMOTE_CACHE_SIGNING_KEY`). **Fix:** fix store
credentials/URL, align the signing key, or `--no-remote-cache`.

## Parameters and secrets

**Symptom:** `--name is required (or set ENV_NAME).` (all problems listed)
**Fix:** pass the flag or set the env var the message names.

**Symptom:** `--name: expected a number, got "x"` / `expected a boolean` /
`expected one of a, b, got "x"` **Fix:** booleans accept true/1/yes and
false/0/no; choices are exact.

**Symptom:** `Parameter "x" renders as "--y", which is a built-in Zuke CLI
flag`, `both render as "--y"`, or `collides with a reserved MCP control name
(dryRun, confirm, operatorToken)` **Fix:** rename the field or use
`.flag("--other")`. Exit 1 before any run.

**Symptom:** `Parameter "x" was read before it was resolved` **Fix:** read
`.value` inside a target body, not in a field initialiser.

**Symptom:** `execSecret command "c" exited with code N` / `fileSecret could not
read "path"` / `requires a command` / `requires a path` **Fix:** run that
command or read that file by hand; fix the settings lambda.

## MCP

`zuke mcp` is read-only by default; clients see these results.

**Symptom:** tool result `Running targets is disabled. Start the server
with `zuke mcp --allow-run` to enable execution.` **Fix:** restart with
`--allow-run` (or `--allow-run=glob,glob` for a subset).

**Symptom:** `Unknown tool: run:x` **Cause:** the target is missing or outside
the `--allow-run` globs; both read the same by design. **Fix:** widen the glob,
or check the name with `--list`.

**Symptom:** JSON `{"error":"unauthorized", "reason": "missing_operator_token"}`
(or `invalid_operator_token`, `operator_token_unconfigured`) **Cause:** the
target (or a dependency) matches `--protect <globs>`; the call must carry
`operatorToken` equal to the server's `ZUKE_OPERATOR_TOKEN`.
`operator_token_unconfigured` means the server has no token set (fail-closed).
**Fix:** set `ZUKE_OPERATOR_TOKEN` on the server and pass it in the call.

**Symptom:** `{"status":"confirmation_required", "plan": [...]}` (not an error)
**Cause:** `--confirm-destructive`; the target is not `.readOnly()`. **Fix:**
call again with `confirm: true` (or `dryRun: true`).

**Symptom:** `zuke mcp: refusing to bind host:port without authentication`
**Fix:** set `ZUKE_MCP_TOKEN`, declare `mcpAuth()`, or bind `127.0.0.1`. `mcp:
invalid --http address` wants `<port>` or `<host:port>`. A browser origin
rejected with `Forbidden: Origin not allowed.` needs `--allowed-origin`.

## CI

**Symptom:** `CI configuration is out of date: <paths>. Run `zuke
generate-ci` and commit the result.` (exit 1 from `zuke generate-ci --check`)
**Cause:** the files generated from `cicd()` differ from what is committed.
**Fix:** `./zuke generate-ci`, review the diff, commit. Never hand-edit them.
`No CI configuration is declared on this build.` means no `cicd()` override.
