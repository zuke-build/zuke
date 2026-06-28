# @zuke/nest

Typed [NestJS CLI](https://docs.nestjs.com) (`nest`) task wrappers for
[Zuke](https://github.com/zuke-build/zuke#readme) builds, in a fluent
settings-lambda API. The `nest` command (from `@nestjs/cli`) scaffolds,
generates, builds, and runs NestJS applications; this wrapper mirrors its
subcommands and flags. Arguments stay a discrete argv array, so command
construction is injection-free.

```ts
import { NestTasks } from "jsr:@zuke/nest";

await NestTasks.generate((s) => s.schematic("service").name("users").flat());
await NestTasks.build((s) => s.webpack().preserveWatchOutput());
```

## Paths

Every path argument accepts either a string or an `AbsolutePath` from
`@zuke/core`, so a path built with `absolutePath` can be passed in directly.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/nest` — typed NestJS CLI (`nest`) task wrappers for Zuke builds.

Wraps the `@nestjs/cli` (https://docs.nestjs.com) `nest` command in the same
settings-lambda style as the other Zuke tool wrappers: configure a fluent
settings object in a lambda; the task builds the argv and runs it.

```ts
import { NestTasks } from "jsr:@zuke/nest";
await NestTasks.generate((s) => s.schematic("service").name("users"));
await NestTasks.build((s) => s.webpack());
```
@module

const NestTasks: NestTasksApi
  Typed task functions for the NestJS CLI (`nest`).

class NestBuildSettings extends NestSettings
  Settings for `nest build` — compile a NestJS application.

  app(value: string): this
    The application/project to build (positional, optional).
  config(path: PathLike): this
    Path to the Nest CLI configuration file (`--config <p>`).
  path(path: PathLike): this
    Path to the `tsconfig` file (`--path <p>`).
  watch(): this
    Rebuild on file changes (`--watch`).
  webpack(): this
    Use the webpack builder (`--webpack`).
  tsc(): this
    Use the `tsc` builder (`--tsc`).
  builder(value: string): this
    Builder to use, e.g. `tsc`/`webpack`/`swc` (`--builder <v>`).
  preserveWatchOutput(): this
    Keep prior console output between watch rebuilds (`--preserveWatchOutput`).
  override protected subcommandArgs(): string[]

class NestGenerateSettings extends NestSettings
  Settings for `nest generate` — generate code from a schematic.

  schematic(value: string): this
    The schematic to generate, e.g. `module`/`service` (positional, required).
  name(value: string): this
    The name passed to the schematic (positional, optional).
  project(value: string): this
    Target project in a monorepo (`--project <v>`).
  collection(value: string): this
    Schematics collection to use (`--collection <v>`).
  flat(): this
    Generate files without a dedicated directory (`--flat`).
  spec(): this
    Force generation of a spec file (`--spec`).
  noSpec(): this
    Disable generation of a spec file (`--no-spec`).
  skipImport(): this
    Skip importing the generated element into its module (`--skip-import`).
  dryRun(): this
    Report what would be generated without writing files (`--dry-run`).
  override protected subcommandArgs(): string[]

class NestInfoSettings extends NestSettings
  Settings for `nest info` — print Nest CLI and project information.

  override protected subcommandArgs(): string[]

class NestNewSettings extends NestSettings
  Settings for `nest new` — scaffold a new NestJS application.

  name(value: string): this
    The application name (positional, required).
  directory(path: PathLike): this
    Generate into this directory (`--directory <p>`).
  skipInstall(): this
    Skip package installation (`--skip-install`).
  skipGit(): this
    Skip git repository initialization (`--skip-git`).
  strict(): this
    Enable TypeScript strict mode in the generated project (`--strict`).
  dryRun(): this
    Report what would be generated without writing files (`--dry-run`).
  packageManager(value: string): this
    Package manager to use, e.g. `npm`/`yarn`/`pnpm` (`--package-manager <v>`).
  language(value: string): this
    Programming language, e.g. `ts`/`js` (`--language <v>`).
  override protected subcommandArgs(): string[]

class NestStartSettings extends NestSettings
  Settings for `nest start` — build and run a NestJS application.

  app(value: string): this
    The application/project to start (positional, optional).
  config(path: PathLike): this
    Path to the Nest CLI configuration file (`--config <p>`).
  path(path: PathLike): this
    Path to the `tsconfig` file (`--path <p>`).
  watch(): this
    Rebuild and restart on file changes (`--watch`).
  debug(): this
    Start in debug mode (`--debug`).
  preserveWatchOutput(): this
    Keep prior console output between watch rebuilds (`--preserveWatchOutput`).
  exec(value: string): this
    Binary used to run the compiled output (`--exec <v>`).
  builder(value: string): this
    Builder to use, e.g. `tsc`/`webpack`/`swc` (`--builder <v>`).
  override protected subcommandArgs(): string[]

interface NestTasksApi
  The shape of {@link NestTasks}.

  new(configure?: Configure<NestNewSettings>): Promise<CommandOutput>
    Scaffold a new application: `nest new`.
  generate(configure?: Configure<NestGenerateSettings>): Promise<CommandOutput>
    Generate code from a schematic: `nest generate`.
  build(configure?: Configure<NestBuildSettings>): Promise<CommandOutput>
    Compile an application: `nest build`.
  start(configure?: Configure<NestStartSettings>): Promise<CommandOutput>
    Build and run an application: `nest start`.
  info(configure?: Configure<NestInfoSettings>): Promise<CommandOutput>
    Print CLI and project information: `nest info`.
````

</details>

<!-- ZUKE:API:END -->
