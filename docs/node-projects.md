# Using Zuke in a Node/npm project

Zuke can drive a Node project's build without touching its dependencies — build
logic in a `build/` folder that lives next to the code. Deno is the only
prerequisite (it runs the build; your app keeps its Node toolchain):

```
my-app/
  package.json          # your app — no zuke dependency added
  src/ ...
  build/
    deno.json           # the build project's config
    zuke.ts             # your targets
```

1. Install Deno: <https://docs.deno.com/runtime/getting_started/installation/>

2. Create `build/deno.json`:

```json
{
  "imports": {
    "@zuke/core": "jsr:@zuke/core@^0",
    "@zuke/npm": "jsr:@zuke/npm@^0"
  }
}
```

3. Create `build/zuke.ts` — targets drive the repo root via `.cwd("..")`:

```ts
import { Build, run, target } from "@zuke/core";
import { NpmTasks } from "@zuke/npm";

class AppBuild extends Build {
  install = target()
    .description("Clean-install dependencies")
    .executes(async () => {
      await NpmTasks.ci((s) => s.cwd(".."));
    });

  test = target()
    .description("Run the app's test script")
    .dependsOn(this.install)
    .executes(async () => {
      await NpmTasks.run((s) => s.script("test").cwd(".."));
    });

  pack = target()
    .description("Verify the publishable tarball")
    .dependsOn(this.test)
    .executes(async () => {
      await NpmTasks.publish((s) => s.dryRun().cwd(".."));
    });

  default = target()
    .description("Default: install → test → pack")
    .dependsOn(this.pack)
    .executes(() => {});
}

if (import.meta.main) {
  await run(AppBuild);
}
```

4. Bridge it for npm-centric contributors — in `package.json`:

```json
{
  "scripts": {
    "build": "deno run -A build/zuke.ts"
  }
}
```

Now `npm run build` runs the default pipeline, `npm run build -- test` runs one
target, and `npm run build -- --list` / `-- graph` show what the build can do
— no one has to learn Deno commands.

## Other package managers

The same pattern applies to the other JS package managers, each with its own
wrapper: [`@zuke/bun`](../packages/bun) (`BunTasks` — also `bun test`),
[`@zuke/pnpm`](../packages/pnpm) (`PnpmTasks`, with `--filter` for workspaces),
and [`@zuke/yarn`](../packages/yarn) (`YarnTasks`, Classic and Berry). For
example, `await PnpmTasks.install((s) => s.frozenLockfile())` or
`await BunTasks.run((s) => s.script("build"))`.
