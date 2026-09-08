# node-app

Zuke driving a Node project's build without touching its dependencies. The app
is [`greet.mjs`](./greet.mjs) with a `node --test` suite and an npm `build`
script; [`zuke.ts`](./zuke.ts) runs them through the typed `@zuke/npm` wrapper:

```
install ─▶ test ─▶ build ─▶ pack ─▶ default
```

```sh
deno run -A zuke.ts            # the whole chain
deno run -A zuke.ts test       # install → test
npm run zuke -- --list         # the same build, for npm-centric colleagues
```

What to notice:

- `package.json` gains no dependency. Deno is the only prerequisite for the
  build; the app keeps its Node toolchain, and `npm ci` / `npm test` /
  `npm run build` are what actually execute — through `NpmTasks.ci()`,
  `NpmTasks.test()` and `NpmTasks.run((s) => s.script("build"))`, which build
  the argv rather than a shell string.
- The `zuke` npm script bridges the two worlds: `npm run zuke -- test` runs one
  target, `npm run zuke -- --list` shows what the build can do. Nobody has to
  learn Deno commands.
- Inside the Zuke repository, run this example without `--frozen` (as above) or
  with `DENO_NO_PACKAGE_JSON=1`: Deno discovers the app's `package.json` from
  this directory and, frozen, wants it in the root lockfile. In your own
  repository the lockfile is yours and this does not arise.
- A larger app would put the build in a `build/` folder and drive the root with
  `.cwd("..")` — see
  [Using Zuke in a Node/npm project](../../docs/node-projects.md) for that
  layout and for the pnpm, Yarn and Bun equivalents.
