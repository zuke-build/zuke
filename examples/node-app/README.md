# node-app

Zuke driving a Node project's build without touching its dependencies. The app
is [`greet.mjs`](./greet.mjs) with a `node --test` suite and an npm `build`
script; [`zuke.ts`](./zuke.ts) runs them through the typed `@zuke/npm` wrapper:

```
install ─▶ test ─▶ build ─▶ pack ─▶ default
```

```sh
zuke                   # the whole chain
zuke test              # install → test
npm run zuke -- --list # the same build, for npm-centric colleagues
```

What to notice:

- `package.json` gains no dependency. Deno is the only prerequisite for the
  build; the app keeps its Node toolchain, and `npm ci` / `npm test` /
  `npm run build` are what actually execute — through `NpmTasks.ci()`,
  `NpmTasks.test()` and `NpmTasks.run((s) => s.script("build"))`, which build
  the argv rather than a shell string.
- The `zuke` npm script hands over to the `zuke` CLI, so npm-centric colleagues
  keep their habit: `npm run zuke -- test` runs one target,
  `npm run zuke -- --list` shows what the build can do. Nobody has to learn Deno
  commands.
- A larger app would put the build in a `build/` folder and drive the root with
  `.cwd("..")` — see
  [Using Zuke in a Node/npm project](../../docs/node-projects.md) for that
  layout and for the pnpm, Yarn and Bun equivalents.
