# @zuke/vite

Typed [Vite](https://vitejs.dev) CLI task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `dev`, `build`, and
`preview`.

```ts
import { ViteTasks } from "jsr:@zuke/vite";

await ViteTasks.build((s) => s.outDir("dist").mode("production"));
await ViteTasks.preview((s) => s.port(4173));
```

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/vite` — typed `ViteTasks` wrappers for the Vite (https://vitejs.dev)
CLI, for use in Zuke builds.

```ts
import { ViteTasks } from "jsr:@zuke/vite";

await ViteTasks.build((s) => s.outDir("dist").mode("production"));
await ViteTasks.preview((s) => s.port(4173));
```
@module

const ViteTasks: ViteTasksApi
  Typed task functions for the `vite` CLI.

class ViteBuildSettings extends ViteSettings
  Settings for `vite build`.

  outDir(path: PathLike): this
    Output directory (`--outDir`).
  base(path: string): this
    Public base path (`--base`).
  emptyOutDir(): this
    Empty the output directory before building (`--emptyOutDir`).
  sourcemap(): this
    Emit source maps (`--sourcemap`).
  root(path: PathLike): this
    The project root (positional).
  override protected buildArgs(): string[]
    Assemble the `vite build` argv.

class ViteDevSettings extends ViteSettings
  Settings for `vite dev` (the development server).

  host(value: string): this
    Bind to a host/IP (`--host`).
  port(value: number): this
    Serve on a specific port (`--port`).
  open(): this
    Open the app in the browser on start (`--open`).
  override protected buildArgs(): string[]
    Assemble the `vite dev` argv.

class VitePreviewSettings extends ViteSettings
  Settings for `vite preview` (serve a production build locally).

  host(value: string): this
    Bind to a host/IP (`--host`).
  port(value: number): this
    Serve on a specific port (`--port`).
  open(): this
    Open the app in the browser on start (`--open`).
  override protected buildArgs(): string[]
    Assemble the `vite preview` argv.

abstract class ViteSettings extends ToolSettings
  Base for all `vite` subcommand settings: the binary is `vite`, with the
  `--config` and `--mode` options shared by every subcommand.

  override protected defaultTool(): string
    The default binary this wrapper invokes: `vite`.
  config(path: PathLike): this
    Use an explicit config file (`--config`).
  mode(name: string): this
    Set the mode, e.g. `production` or `development` (`--mode`).
  protected baseArgs(): string[]
    The shared option arguments.

interface ViteTasksApi
  The shape of {@link ViteTasks}.

  dev(configure?: Configure<ViteDevSettings>): Promise<CommandOutput>
    Start the dev server: `vite dev`.
  build(configure?: Configure<ViteBuildSettings>): Promise<CommandOutput>
    Build for production: `vite build`.
  preview(configure?: Configure<VitePreviewSettings>): Promise<CommandOutput>
    Preview a production build: `vite preview`.
````

</details>

<!-- ZUKE:API:END -->
