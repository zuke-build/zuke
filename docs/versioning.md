# Versioning & compatibility

Zuke publishes 54 independent JSR packages from one workspace. They don't all
move at the same speed, and knowing which promise each package makes — and how
they interlock — is what keeps an upgrade from surprising you at runtime
instead of at `deno check` time.

## One tier: every package follows full semver

**All 54 packages are `1.x`.** `@zuke/core`, the `@zuke/cli` command, and every
tool wrapper make the same promise: a `1.x` release never breaks a public
symbol, so a minor or patch upgrade is safe to take without reading the diff,
and a breaking change bumps the **major** version. Depend on
`jsr:@zuke/core@^1` (and `jsr:@zuke/deno@^1`, …) and let minors resolve.

`release-please`'s `bump-minor-pre-major` is off, so nothing silently ships a
breaking change under a minor bump. Read a
package's `CHANGELOG.md` when its major moves — that is the only release that
can require a code change on your side.

What a wrapper's `1.x` promise does **not** cover is the upstream CLI it drives:
its flags track a tool that can rename or drop one. When upstream changes, the
wrapper keeps the old method working (deprecated) or bumps its major — the
promise is about the wrapper's own typed surface, not about upstream's
stability.

Check a specific package's current version from its badge on the
[Packages table](../README.md#packages) or its JSR page — score and version
are both visible there.

## Every wrapper declares a `@zuke/core` floor

Each tool wrapper's `deno.json` pins a minimum core version it needs, e.g.

```json
{
  "imports": {
    "@zuke/core": "jsr:@zuke/core@^1.31.0"
  }
}
```

That floor is **hand-maintained** — nothing regenerates it — but it is no longer
unverified: the `coreFloorCheck` target type-checks every package against the
core version it declares, and the `Core version floors` CI job runs it on every
PR. See [Verifying the floors](#verifying-the-floors) below. The floor exists
because a wrapper often imports a symbol that only exists from some specific
core release onward (a new settings class, a new exported type). If the floor
is under-declared, a consumer can pin a wrapper version whose code needs core
1.31 while their lockfile still resolves an older core that doesn't export the
symbol — and the failure doesn't show up until the wrapper is actually
imported at runtime, because this repo's own CI type-checks every package
against the **workspace-local** `packages/core`, not against the floor each
`deno.json` claims.

### The failure mode, concretely

This happened in this repo (fixed in
[`d8f51c0`](https://github.com/zuke-build/zuke/commit/d8f51c0939d26faa6eb5d7d4bb75bbba241890bb),
"fix: raise the `@zuke/core` floor to 1.31.0 in wrappers using
`SubcommandSettings`"):

1. Five wrappers (`@zuke/claude`, `@zuke/codex`, `@zuke/gcloud`,
   `@zuke/gemini`, `@zuke/gh`) started importing `SubcommandSettings`, a type
   new in `@zuke/core@1.31.0`.
2. Their declared floor was still an older range that predates that symbol.
3. CI was green: `deno check` resolves the workspace's local `packages/core`
   member (already at 1.31.0+) regardless of what each wrapper's `deno.json`
   claims, so the type-check never sees the gap.
4. A consumer whose `deno.lock` had already pinned an older, published core —
   satisfying the wrapper's stale floor — hit a **runtime** failure: the
   import resolved to a real core release that doesn't export
   `SubcommandSettings`.
5. The fix was a follow-up PR that raised the floor in the five affected
   `deno.json`s (and `deno.lock`) to `^1.31.0`, once core 1.31.0 had actually
   published. See [`RELEASING.md`](../RELEASING.md) for why the floor bump has
   to be a separate, later PR rather than landing in the same change that
   introduces the new symbol.

### How to diagnose it

If you hit an import that resolves at type-check time but throws or logs a
missing export at runtime:

1. Check which core symbol the failing import actually needs, and which
   version introduced it — grep the symbol in
   [`packages/core/CHANGELOG.md`](../packages/core/CHANGELOG.md) or search
   [`llms-full.txt`](../llms-full.txt).
2. Compare that to the floor the wrapper declares
   (`jsr:@zuke/core@^x.y.z` in its `deno.json`, visible on its JSR page) and to
   what your own `deno.lock` actually resolved for `@zuke/core` — run
   `deno info jsr:@zuke/<wrapper>` or inspect `deno.lock` directly.
3. If the lockfile-resolved core predates the version the symbol needs, the
   wrapper's floor is under-declared. File an issue (or bump your own pin to
   the version that introduced the symbol as a workaround) and expect the fix
   to look like `d8f51c0`: a small `fix:` PR raising the floor in every
   affected `deno.json`.

### Verifying the floors

`./zuke coreFloorCheck` type-checks every package against the core version it
declares, so the gap above is now caught before release rather than by a
consumer at runtime. It runs as its own CI job on every PR.

It works by writing a throwaway config per package containing that package's own
imports and **no `workspace` field**, then type-checking the package's `mod.ts`
with `deno check --config` pointed at it. Without a workspace to resolve
against, `@zuke/core` comes from JSR instead of the local `packages/core` member
— which is precisely the substitution that made the ordinary type-check blind
to this class of bug.

Two details matter, and both are load-bearing:

- **The floor is pinned to the range's exact minimum.** A caret range resolves
  to the *newest* matching version, so checking `^1.25.0` as written would
  exercise the current core and pass no matter how new a symbol the package
  uses. Verified against `1.25.0` exactly, it tests the actual claim.
- **`minimumDependencyAge` is zeroed** in the generated config. Deno otherwise
  refuses a version published within the last day as a supply-chain
  precaution — sensible when installing dependencies to run, wrong here, where
  the case most needing verification is a floor naming the core just released
  alongside it.

Because it reaches JSR, it is deliberately **not** part of `./zuke ci`, which
stays runnable offline.

## Pinning guidance

- Depend on the caret range, not an exact version: `jsr:@zuke/core@^1` (or a
  wrapper's own `jsr:@zuke/<tool>@^1`) so patch and non-breaking minor releases
  resolve automatically.
- **Always commit `deno.lock`.** It is what pins the exact resolved version of
  every package (core included) that your build actually runs against — the
  caret range in `deno.json` only bounds what's *allowed*, the lockfile fixes
  what's *used*. Regenerate it (`deno install` or a fresh `deno.lock` write)
  whenever you deliberately take an upgrade, and review the diff. In this repo
  that is `deno task lock`, and the gate enforces it: every entrypoint that
  loads `zuke.ts` runs `--frozen`, and the `lockCheck` target fails if a run
  modified the lock — so a stale lock is caught before it reaches CI rather
  than being silently healed on the machine that happened to run the gate.

## Upgrade notes

For what changed in a given release, see:

- The root [`CHANGELOG.md`](../CHANGELOG.md) for project-level milestones.
- Each package's own `packages/<pkg>/CHANGELOG.md` (e.g.
  [`packages/core/CHANGELOG.md`](../packages/core/CHANGELOG.md)) for the
  generated, per-release notes — every entry there is release-please output
  from Conventional Commits, so it's the authoritative per-package history.
