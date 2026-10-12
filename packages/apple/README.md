# @zuke/apple

Typed task wrappers for Apple's code-signing tools in
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `codesign`,
`xcrun notarytool`, `security` and `ditto` — in a fluent settings-lambda API.
Arguments stay a discrete argv array, so command construction is injection-free.

```ts
import {
  CodesignTasks,
  DittoTasks,
  NotarytoolTasks,
  SecurityTasks,
} from "@zuke/apple";

await SecurityTasks.temporaryKeychain(
  (s) => s.certificate(p12Base64).certificatePassword(p12Password),
  async ({ keychain, identity }) => {
    await CodesignTasks.sign((s) =>
      s.identity(identity.hash).keychain(keychain).options("runtime")
        .timestamp().force().file("dist/MyApp.app")
    );
  },
);
await DittoTasks.archive((s) =>
  s.keepParent().source("dist/MyApp.app").destination("dist/MyApp.zip")
);
const submission = await NotarytoolTasks.submit((s) =>
  s.file("dist/MyApp.zip").key("AuthKey_ABC123.p8").keyId("ABC123")
    .issuer(issuer).wait().timeout("30m")
);
```

## The tools

| Task object       | Binary             | Tasks                                                                                                                                                              |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CodesignTasks`   | `codesign`         | `sign`, `verify`, `display` (parsed: identifier, team, authorities — read from stderr, where `codesign` writes them)                                               |
| `NotarytoolTasks` | `xcrun notarytool` | `submit`, `info`, `log`, `history` — each returns the tool's JSON, parsed                                                                                          |
| `SecurityTasks`   | `security`         | `createKeychain`, `deleteKeychain`, `unlockKeychain`, `setKeychainSettings`, `import`, `setKeyPartitionList`, `listKeychains`, `findIdentity`, `temporaryKeychain` |
| `DittoTasks`      | `ditto`            | `copy`, `archive` (`-c -k`), `extract` (`-x -k`)                                                                                                                   |

Task and setting names follow the real subcommands and flags:
`SecurityTasks.setKeyPartitionList` runs `security set-key-partition-list`,
`.privateKeys()` is its `-s`, `DittoSettings.keepParent()` is `--keepParent`.

## A temporary keychain for CI

`SecurityTasks.temporaryKeychain` is the keychain dance every macOS signing job
repeats, with the cleanup done right:

1. read the user keychain search list;
2. create a uniquely named keychain in a fresh private temp directory, with a
   random password;
3. turn its auto-lock off (`set-keychain-settings` with no flags) and unlock it;
4. write the decoded `.p12` to a `0600` file, `security import` it with
   `-T /usr/bin/codesign -f pkcs12`, and delete the file at once;
5. `set-key-partition-list -S apple-tool:,apple: -s`, so `codesign` never raises
   the access prompt that hangs a headless build;
6. put the keychain first on the search list;
7. resolve the codesigning identity with `find-identity -v -p codesigning` —
   when the `.p12` holds several, pick one with `.identity(nameOrHash)`.

Then the callback runs with `{ keychain, identity }`. Afterwards — whether
setup, the callback or nothing failed — the keychain is deleted, the search list
is put back as it was read, and the temp directory is removed. Every cleanup
step runs even if an earlier one fails; failures are reported together as a
`KeychainCleanupError`, with the callback's own error as its `cause`.

The keychain search list is one per user, and each keychain restores the list it
read, so keychain lifetimes are serialized within a process: a second
`temporaryKeychain` — from a parallel target in a `group()`, say — waits until
the first has been torn down. Separate processes running as the same user (two
builds, or two jobs on one self-hosted runner account) cannot see that lock and
must not sign at the same time.

## Dry runs

Under `--dry-run` commands are echoed rather than run, and core gives a wrapper
no way to tell. `temporaryKeychain` therefore still decodes the certificate and
writes (then deletes) its private file before failing with "no valid codesigning
identity", and every `NotarytoolTasks` call fails with a `NotarytoolOutputError`
because there is no JSON to read. Keep signing and notarization targets out of a
dry run.

## Notarization

`NotarytoolTasks.submit` always passes `--output-format json` and returns
`{ id, status, message }`. With `.wait()`, any final status other than
`Accepted` fetches `notarytool log <id>` with the same credentials and throws a
`NotarizationError` whose message lists the log's issues (and whose `.log` holds
them parsed). Any other non-zero exit is a `CommandError`, even when notarytool
printed a result with an id. Set `.noThrow()` to get the result back instead.

Authenticate with exactly one of:

- an App Store Connect API key — `.key(p8Path).keyId(id).issuer(uuid)` (omit the
  issuer for an individual key);
- a keychain profile — `.keychainProfile(name)`, optionally `.keychain(path)`;
- an Apple ID — `.appleId(email).password(appSpecific).teamId(id)`.

Mixing two, or giving none, is refused before anything runs.

## Secrets

`security` takes passwords only as argv tokens (`-p`, `-P`, `-k`), and so does
notarytool's `--password`. Every password set through these settings is
registered with the run's redactor, so it is masked in the dry-run echo, the
reporter and any `CommandError`, and the settings mask it out of the errors they
raise themselves, so a wrapper used outside a run does not leak it either.
Masking cannot reach the process table, though: while the command runs, its argv
is visible to other users of the host. Prefer the API key for notarytool, and
let `temporaryKeychain` generate the throwaway keychain password.

The base64 certificate never reaches a command line or an error message.

## Paths

A relative path operand starting with `-` is passed as `./-…`, so a file name
can never be read as an option. Every path argument accepts a string or an
`AbsolutePath` from `@zuke/core`.

## Resolution

All four tools ship with macOS (`/usr/bin`) and resolve from `PATH`. A missing
binary surfaces as a `ToolNotFoundError` naming it.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/apple` — typed task wrappers for Apple's code-signing tools in Zuke
builds: `codesign`, `xcrun notarytool`, `security` and `ditto`.

Configure a fluent settings object in a lambda; the task builds the argv and
runs it. Sign, zip, notarize, from a throwaway keychain:

```ts
import {
  CodesignTasks,
  DittoTasks,
  NotarytoolTasks,
  SecurityTasks,
} from "@zuke/apple";

await SecurityTasks.temporaryKeychain(
  (s) => s.certificate(p12Base64).certificatePassword(p12Password),
  async ({ keychain, identity }) => {
    await CodesignTasks.sign((s) =>
      s.identity(identity.hash).keychain(keychain).options("runtime")
        .timestamp().force().file("dist/MyApp.app")
    );
  },
);
await DittoTasks.archive((s) =>
  s.keepParent().source("dist/MyApp.app").destination("dist/MyApp.zip")
);
await NotarytoolTasks.submit((s) =>
  s.file("dist/MyApp.zip").key("AuthKey.p8").keyId(keyId).issuer(issuer)
    .wait().timeout("30m")
);
```
@module

const CodesignTasks: CodesignTasksApi
  Typed task functions for Apple's `codesign`.

const DittoTasks: DittoTasksApi
  Typed task functions for macOS `ditto`.

const NotarytoolTasks: NotarytoolTasksApi
  Typed task functions for `xcrun notarytool`.

const SecurityTasks: SecurityTasksApi
  Typed task functions for macOS `security`.

class CodesignDisplaySettings extends CodesignSettings
  Settings for `codesign --display`.

  override protected operation(): string
    `--display`.
  override protected operationArgs(): string[]
    `--display` takes no options of its own beyond verbosity.

abstract class CodesignSettings extends ToolSettings
  The shared shape of every `codesign` operation: the files it acts on and how
  verbose it is. Each operation subclass names its mode flag and its own
  options.

  override protected defaultTool(): string
    The default executable name (`codesign`).
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `codesign` ships with macOS in `/usr/bin`.
  abstract protected operation(): string
    The operation's mode flag, e.g. `--sign` or `--verify`.
  abstract protected operationArgs(): string[]
    The operation's own options, placed after the mode flag.
  file(...paths: PathLike[]): this
    The code to act on (positional) — an app bundle, framework, binary or
    disk image; repeatable. A relative path starting with `-` is passed as
    `./-…` so `codesign` cannot read it as an option.
  verbose(level?: number): this
    More output (`--verbose`, or `--verbose=<level>` with a level). `display`
    shows more of the signature at each level; `4` lists everything.
  override protected buildArgs(): string[]
    Assemble the `codesign` argv: mode, options, verbosity, then files.

class CodesignSignSettings extends CodesignSettings
  Settings for `codesign --sign`.

  override protected operation(): string
    `--sign`.
  identity(value: string): this
    The signing identity (`--sign <identity>`): a certificate's common name,
    a substring of it, or its SHA-1 hash. `-` signs ad hoc. Required.
  force(): this
    Replace an existing signature (`--force`).
  deep(): this
    Sign nested code as well (`--deep`). Apple discourages it for signing.
  options(...flags: string[]): this
    Signature option flags (`--options`, comma-joined); repeatable.
    `runtime` enables the hardened runtime notarization requires.
  timestamp(url?: string): this
    Request a secure timestamp (`--timestamp`), from `url` when given
    (`--timestamp=<url>`). Notarization requires one.
  entitlements(path: PathLike): this
    The entitlements plist to embed (`--entitlements`).
  keychain(path: PathLike): this
    Look the identity up in this keychain only (`--keychain`).
  identifier(value: string): this
    The code's identifier (`--identifier`), overriding the bundle id.
  override protected operationArgs(): string[]
    Assemble the signing options.

class CodesignVerifySettings extends CodesignSettings
  Settings for `codesign --verify`.

  override protected operation(): string
    `--verify`.
  strict(): this
    Apply the strict validation rules notarization uses (`--strict`).
  deep(): this
    Verify nested code as well (`--deep`).
  override protected operationArgs(): string[]
    Assemble the verification options.

class DittoSettings extends ToolSettings
  Settings for a `ditto` run.

  override protected defaultTool(): string
    The default executable name (`ditto`).
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `ditto` ships with macOS in `/usr/bin`.
  create(): this
    Create an archive rather than copy (`-c`).
  extract(): this
    Extract an archive rather than copy (`-x`).
  pkzip(): this
    Use the PKZip format for the archive (`-k`) instead of CPIO.
  sequesterRsrc(): this
    Keep resource forks and HFS metadata in a `__MACOSX` directory inside the
    archive (`--sequesterRsrc`), the way the Finder's own compress does.
  keepParent(): this
    Put the source directory itself in the archive, not only its contents
    (`--keepParent`) — what makes a zipped `MyApp.app` unzip as `MyApp.app`.
  source(path: PathLike): this
    What to copy or archive (positional). Required.
  destination(path: PathLike): this
    Where to write it (positional). Required.
  override protected buildArgs(): string[]
    Assemble the `ditto` argv: flags, then source and destination.

class KeychainCleanupError extends Error
  Raised by `SecurityTasks.temporaryKeychain` when tearing the keychain down
  failed — restoring the search list, deleting the keychain, or removing its
  directory. Every step is attempted regardless; {@link failures} holds each
  one that threw. When the callback had already failed, that error is the
  {@link Error.cause}, so neither is lost.

  constructor(readonly failures: ReadonlyArray<KeychainCleanupFailure>, options?: ErrorOptions)
    Build the error from the failed cleanup steps and, when setup or the
    callback had failed first, `{ cause }` holding that error — whatever was
    thrown, `undefined` included, since its presence is what records that the
    callback failed.
  override name: string
    The error name.

class KeychainError extends Error
  Raised by `SecurityTasks.temporaryKeychain` when the keychain cannot be set
  up for signing: no certificate given, a certificate that is not base64, or
  an imported certificate holding no codesigning identity, or several that
  the identity filter cannot tell apart. Never carries a password.

  override name: string
    The error name.

class NotarizationError extends Error
  Raised by `NotarytoolTasks.submit` when `.wait()` was set and Apple finished
  the submission with any status other than `Accepted`. The message names the
  status and lists the issues from the submission's notarization log, which
  the task fetched with the same credentials.

  constructor(readonly submission: NotarytoolSubmission, readonly log: NotarytoolLog | undefined)
    Build the error from the finished submission and, if fetched, its log.
  override name: string
    The error name.

class NotarytoolHistorySettings extends NotarytoolSettings
  Settings for `xcrun notarytool history`.

  override protected subcommand(): string
    `history`.
  override protected subcommandArgs(): string[]
    Assemble the history arguments.

class NotarytoolInfoSettings extends NotarytoolSettings
  Settings for `xcrun notarytool info <id>`.

  override protected subcommand(): string
    `info`.
  submissionId(id: string): this
    The submission to describe (positional). Required.
  override protected subcommandArgs(): string[]
    Assemble the info arguments.

class NotarytoolLogSettings extends NotarytoolSettings
  Settings for `xcrun notarytool log <id>`.

  override protected subcommand(): string
    `log`.
  submissionId(id: string): this
    The submission whose log to fetch (positional). Required.
  override protected subcommandArgs(): string[]
    Assemble the log arguments. The log is itself JSON, printed to stdout
    when no output path is given, so no output format is pinned.

class NotarytoolOutputError extends Error
  Raised when `notarytool` did not print the JSON result a task asked for —
  an older Xcode, a crash, or output that is not a notarytool result at all.
  The raw output is kept on the error rather than in its message.

  constructor(message: string, readonly stdout: string)
    Build the error from a description of the problem and the raw stdout.
  override name: string
    The error name.

abstract class NotarytoolSettings extends ToolSettings
  The shared settings of every `xcrun notarytool` subcommand: the credentials,
  and the masking of the app-specific password. A subclass names its
  subcommand and builds its own arguments.

  override protected defaultTool(): string
    The default executable name (`xcrun`), which dispatches to notarytool.
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `xcrun` ships with macOS in `/usr/bin`.
  abstract protected subcommand(): string
    The notarytool subcommand, e.g. `submit`.
  abstract protected subcommandArgs(): string[]
    The subcommand's own arguments, placed before the credentials.
  key(path: PathLike): this
    The App Store Connect API private key file, `AuthKey_<id>.p8` (`--key`).
  keyId(id: string): this
    The API key's id (`--key-id`).
  issuer(uuid: string): this
    The API key's issuer UUID (`--issuer`); omit it for an individual key.
  keychainProfile(name: string): this
    Authenticate with credentials saved by `notarytool store-credentials`
    (`--keychain-profile`).
  keychain(path: PathLike): this
    The keychain to read the {@link keychainProfile} from (`--keychain`).
  appleId(email: string): this
    The Apple ID to authenticate as (`--apple-id`).
  password(value: string): this
    The Apple ID's app-specific password (`--password`). Registered with the
    run's redactor and masked out of any error this run raises.
  teamId(id: string): this
    The developer team id the Apple ID signs for (`--team-id`).
  override toolPath(path: PathLike): this
    Override the binary, remembered so a follow-up command uses it too.
  override env(record: Record<string, string>): this
    Merge environment variables, remembered for a follow-up command too.
  override cwd(path: PathLike): this
    Set the working directory, remembered for a follow-up command too.
  protected carryInto(target: T): T
    Give `target` this command's credentials, binary, environment and working
    directory — so a follow-up command (the log of a failed submission) talks
    to the same account through the same `xcrun`.
  override run(): Promise<CommandOutput>
    Run the command, with the app-specific password masked out of any
    `CommandError` or timeout it raises — inside a run and outside one.
  protected failureOf(output: CommandOutput): CommandError
    The {@link CommandError} a failed `output` of this command amounts to,
    with the app-specific password masked out — for a subclass that ran with
    `noThrow` to read the output first and judges the exit itself.
  override protected buildArgs(): string[]
    Assemble `notarytool <subcommand> <args> <credentials>`.

class NotarytoolSubmitSettings extends NotarytoolSettings
  Settings for `xcrun notarytool submit`.

  override protected subcommand(): string
    `submit`.
  file(path: PathLike): this
    The archive to notarize — a `.zip`, `.pkg` or `.dmg` (positional). Required.
  wait(): this
    Wait for Apple to finish processing (`--wait`). With it the result
    carries the final status, and `NotarytoolTasks.submit` throws a
    `NotarizationError` for anything but `Accepted`.
  timeout(duration: string): this
    How long `--wait` waits, e.g. `30m` or `1h` (`--timeout`). Needs {@link wait}.
  get waits(): boolean
    Whether {@link wait} was set.
  logFor(id: string): NotarytoolLogSettings
    Settings for `notarytool log <id>` that reuse this submission's
    credentials, binary, environment and working directory.
  async submit_(): Promise<NotarytoolSubmission>
    Run the submission and read its JSON result — what
    `NotarytoolTasks.submit` calls before judging the status.

    The exit code is judged after the JSON is read: notarytool can exit
    non-zero for a waited submission Apple did not accept, and that result —
    which `NotarytoolTasks.submit` turns into a `NotarizationError` with the
    log — is the most useful thing to report. Any other non-zero exit raises
    the `CommandError`, even when it printed a result with an id (an upload
    that failed after the id was issued, say); `.noThrow()` returns the
    result instead. A failed run with no readable result raises it even under
    `.noThrow()`, since there is then nothing to return.
  override protected subcommandArgs(): string[]
    Assemble the submit arguments.

class SecurityCreateKeychainSettings extends SecuritySettings
  Settings for `security create-keychain`.

  override protected subcommand(): string
    `create-keychain`.
  password(value: string): this
    The new keychain's password (`-p`). A secret: masked in every rendering
    of the command. Without it `security` prompts for one.
  keychain(...paths: PathLike[]): this
    The keychain(s) to create (positional); repeatable. Required.
  override protected subcommandArgs(): string[]
    Assemble the create-keychain arguments.

class SecurityDeleteKeychainSettings extends SecuritySettings
  Settings for `security delete-keychain`.

  override protected subcommand(): string
    `delete-keychain`.
  keychain(...paths: PathLike[]): this
    The keychain(s) to delete (positional); repeatable. Required.
  override protected subcommandArgs(): string[]
    Assemble the delete-keychain arguments.

class SecurityFindIdentitySettings extends SecuritySettings
  Settings for `security find-identity`.

  override protected subcommand(): string
    `find-identity`.
  policy(name: string): this
    Only identities usable under this policy (`-p`), e.g. `codesigning`.
  search(value: string): this
    Only identities whose name contains this string (`-s`).
  valid(): this
    Only valid identities (`-v`) — not expired, revoked or untrusted.
  keychain(...paths: PathLike[]): this
    The keychain(s) to search (positional); the search list when omitted.
  override protected subcommandArgs(): string[]
    Assemble the find-identity arguments.

class SecurityImportSettings extends SecuritySettings
  Settings for `security import`.

  override protected subcommand(): string
    `import`.
  file(path: PathLike): this
    The file to import, e.g. a `.p12` (positional). Required.
  keychain(path: PathLike): this
    The keychain to import into (`-k`); the default keychain when omitted.
  passphrase(value: string): this
    The file's passphrase (`-P`), e.g. a `.p12`'s export password. A secret:
    masked in every rendering of the command.
  application(...paths: PathLike[]): this
    An application allowed to use the imported key without a prompt (`-T`),
    e.g. `/usr/bin/codesign`; repeatable.
  type(value: SecurityItemType): this
    The type of item in the file (`-t`).
  format(value: SecurityImportFormat): this
    The file's format (`-f`), e.g. `pkcs12`.
  nonExtractable(): this
    Make the imported private key non-extractable (`-x`).
  override protected subcommandArgs(): string[]
    Assemble the import arguments: the file, then its options.

class SecurityListKeychainsSettings extends SecuritySettings
  Settings for `security list-keychains`.

  override protected subcommand(): string
    `list-keychains`.
  domain(value: SecurityDomain): this
    The preference domain to read or set (`-d`).
  set(...keychains: PathLike[]): this
    Replace the search list with these keychains (`-s`), in order. Called
    with none, it empties the list. Repeat calls append.
  override protected subcommandArgs(): string[]
    Assemble the list-keychains arguments.

class SecuritySetKeyPartitionListSettings extends SecuritySettings
  Settings for `security set-key-partition-list`, which lets Apple's signing
  tools use a key without the "allow access" prompt that hangs a headless
  build.

  override protected subcommand(): string
    `set-key-partition-list`.
  partitionList(...ids: string[]): this
    Partition ids to allow (`-S`, comma-joined); repeatable. `apple-tool:`
    and `apple:` cover `codesign` and the other Apple tools.
  privateKeys(): this
    Match private keys only (`-s`).
  password(value: string): this
    The keychain's password (`-k`). A secret: masked in every rendering of
    the command. Without it `security` prompts for one.
  keychain(path: PathLike): this
    The keychain to modify (positional); the default keychain when omitted.
  override protected subcommandArgs(): string[]
    Assemble the set-key-partition-list arguments.

class SecuritySetKeychainSettings extends SecuritySettings
  Settings for `security set-keychain-settings`. With no flags, the keychain
  never locks on its own — no timeout, and no lock on sleep — which is what a
  CI keychain wants for the length of a build.

  override protected subcommand(): string
    `set-keychain-settings`.
  lockOnSleep(): this
    Lock the keychain when the machine sleeps (`-l`).
  lockAfterTimeout(): this
    Lock the keychain after {@link timeout} seconds of inactivity (`-u`).
  timeout(seconds: number): this
    The inactivity timeout, in seconds (`-t`).
  keychain(path: PathLike): this
    The keychain to configure (positional); the default keychain when omitted.
  override protected subcommandArgs(): string[]
    Assemble the set-keychain-settings arguments.

abstract class SecuritySettings extends ToolSettings
  The shared settings of every `security` subcommand: the binary, and the
  secret handling for the passwords a subcommand takes. A subclass names its
  subcommand and builds its own arguments.

  override protected defaultTool(): string
    The default executable name (`security`).
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `security` ships with macOS in `/usr/bin`.
  abstract protected subcommand(): string
    The `security` subcommand, e.g. `create-keychain`.
  abstract protected subcommandArgs(): string[]
    The subcommand's own arguments.
  protected secret(value: string): string
    Record `value` as a password: registered with the run's redactor and
    masked out of any error this command raises. Returns it, so a setter can
    store it in the same line.
  override run(): Promise<CommandOutput>
    Run the command, with every password masked out of any `CommandError` or
    timeout it raises — inside a run and outside one.
  override protected buildArgs(): string[]
    Assemble `<subcommand> <args>`.

class SecurityUnlockKeychainSettings extends SecuritySettings
  Settings for `security unlock-keychain`.

  override protected subcommand(): string
    `unlock-keychain`.
  password(value: string): this
    The keychain's password (`-p`). A secret: masked in every rendering of
    the command. Without it `security` prompts for one.
  keychain(path: PathLike): this
    The keychain to unlock (positional); the default keychain when omitted.
  override protected subcommandArgs(): string[]
    Assemble the unlock-keychain arguments.

class TemporaryKeychainSettings
  Settings for `SecurityTasks.temporaryKeychain`.

  certificate(base64P12: string): this
    The signing certificate and its private key, as a base64-encoded `.p12`
    — the form CI secrets hold it in. Whitespace is ignored. Required. It is
    decoded only into a `0600` file that is deleted straight after import,
    and never appears in a command line or an error message.
  certificatePassword(value: string): this
    The `.p12`'s export password, handed to `security import -P`. A secret:
    masked in every rendering of that command. Defaults to empty, for a
    `.p12` exported without one — `security` would otherwise prompt.
  identity(filter: string): this
    Pick the identity whose name contains `filter`, or whose SHA-1 hash it
    is. Needed only when the `.p12` holds more than one codesigning identity.
  application(...paths: PathLike[]): this
    An application allowed to use the imported key (`security import -T`);
    repeatable. Defaults to `/usr/bin/codesign` when none is named.
  toolPath(path: PathLike): this
    Run this `security` binary instead of the one on `PATH`.
  host(value: KeychainHost): this
    Replace the machine the keychain is set up on — the seam a test uses to
    record the steps without macOS. Production code leaves the default.
  open_(use: (keychain: TemporaryKeychain) => Promise<T>): Promise<T>
    Set the keychain up, run `use` with it, and tear it down — what
    `SecurityTasks.temporaryKeychain` calls. Returns what `use` returns.

    @throws {KeychainError}
        When the certificate is missing or not base64
        (before anything is created), or holds no matching codesigning identity.

    @throws {KeychainCleanupError}
        When any cleanup step failed; the error of
        a failed setup or callback is its `cause`.

interface CodesignDisplay
  A code signature as `codesign --display` describes it.

  identifier?: string
    The signed code's identifier (`Identifier=`), when printed.
  teamIdentifier?: string
    The team identifier (`TeamIdentifier=`), when printed. `codesign` prints
    `not set` for an ad-hoc signature, and that text is kept as it is.
  authorities: string[]
    The certificate chain (`Authority=` lines), leaf first.
  text: string
    The whole description: stderr, then any stdout, trimmed.
  output: CommandOutput
    The command output the description was read from.

interface CodesignTasksApi
  The shape of {@link CodesignTasks}.

  sign(configure: Configure<CodesignSignSettings>): Promise<CommandOutput>
    Sign code with `codesign --sign`.
  verify(configure: Configure<CodesignVerifySettings>): Promise<CommandOutput>
    Check a signature with `codesign --verify`; a bad one fails the run.
  display(configure: Configure<CodesignDisplaySettings>): Promise<CodesignDisplay>
    Describe a signature with `codesign --display`. `codesign` prints the
    description on stderr, so it is returned parsed, with the raw text and
    the command output alongside.

interface DittoTasksApi
  The shape of {@link DittoTasks}.

  copy(configure: Configure<DittoSettings>): Promise<CommandOutput>
    Copy a file or directory tree with `ditto`, metadata intact.
  archive(configure: Configure<DittoSettings>): Promise<CommandOutput>
    Write a zip archive: `ditto -c -k`, then the lambda's settings.
  extract(configure: Configure<DittoSettings>): Promise<CommandOutput>
    Unpack a zip archive: `ditto -x -k`, then the lambda's settings.

interface KeychainCleanupFailure
  One cleanup step of a temporary keychain that threw.

  step: string
    What the step was doing, e.g. `delete the keychain`.
  message: string
    The step's error message.

interface KeychainHost
  What `SecurityTasks.temporaryKeychain` asks of the machine it runs on.

  security(settings: SecuritySettings): Promise<CommandOutput>
    Run one configured `security` command and return its output.
  makeTempDir(): Promise<string>
    Create a fresh private directory and return its absolute, canonical path
    — symlinks resolved, so it is spelled the way `security list-keychains`
    prints it (on macOS the temp dir is under the `/var` → `/private/var`
    link).
  writePrivateFile(path: string, data: Uint8Array): Promise<void>
    Write `data` to a new file at `path` readable by the owner only (mode
    `0600`), refusing to overwrite or follow anything already there.
  remove(path: string): Promise<void>
    Remove `path` and anything under it; a path that is already gone is fine.
  randomHex(bytes: number): string
    `bytes` cryptographically random bytes, as lower-case hex.

interface NotarytoolIssue
  One problem a notarization log reports.

  severity?: string
    `error` or `warning`.
  message?: string
    What is wrong, e.g. `The binary is not signed.`
  path?: string
    The path inside the archive the issue is about.
  architecture?: string
    The CPU architecture of the offending slice.
  docUrl?: string
    Apple's documentation link for the issue.

interface NotarytoolLog
  A submission's notarization log, from `notarytool log`.

  jobId?: string
    The submission id the log belongs to.
  status?: string
    The final status, e.g. `Invalid`.
  statusSummary?: string
    A one-line summary, e.g. `Archive contains critical validation errors`.
  issues: NotarytoolIssue[]
    Every issue the log lists; empty for a clean submission.
  text: string
    The log as notarytool printed it.

interface NotarytoolSubmission
  A notarization submission as `notarytool` reports it.

  id: string
    The submission id, used by `info`, `log` and `wait`.
  status?: string
    The status — `Accepted`, `Invalid`, `Rejected` or `In Progress`. Absent
    from a `submit` run without `--wait`, which only reports the upload.
  message?: string
    notarytool's message, e.g. `Processing complete`.
  name?: string
    The uploaded file's name (`info`, `history`).
  createdDate?: string
    When the submission was created, ISO 8601 (`info`, `history`).

interface NotarytoolTasksApi
  The shape of {@link NotarytoolTasks}.

  submit(configure: Configure<NotarytoolSubmitSettings>): Promise<NotarytoolSubmission>
    Upload an archive with `notarytool submit` and return the parsed result.
    With `.wait()`, a final status other than `Accepted` fetches the
    submission's log and throws a {@link NotarizationError} listing its
    issues — unless `.noThrow()` was set, when the result is returned for the
    caller to inspect.
  info(configure: Configure<NotarytoolInfoSettings>): Promise<NotarytoolSubmission>
    Read a submission's status with `notarytool info`.
  log(configure: Configure<NotarytoolLogSettings>): Promise<NotarytoolLog>
    Fetch and parse a submission's notarization log with `notarytool log`.
  history(configure: Configure<NotarytoolHistorySettings>): Promise<NotarytoolSubmission[]>
    List the team's past submissions with `notarytool history`.

interface SecurityIdentity
  A signing identity as `security find-identity` lists it.

  hash: string
    The certificate's SHA-1 hash, 40 upper-case hex digits.
  name: string
    The certificate's common name, e.g. `Developer ID Application: … (TEAMID)`.

interface SecurityTasksApi
  The shape of {@link SecurityTasks}.

  createKeychain(configure: Configure<SecurityCreateKeychainSettings>): Promise<CommandOutput>
    Create a keychain with `security create-keychain`.
  deleteKeychain(configure: Configure<SecurityDeleteKeychainSettings>): Promise<CommandOutput>
    Delete a keychain with `security delete-keychain`.
  unlockKeychain(configure: Configure<SecurityUnlockKeychainSettings>): Promise<CommandOutput>
    Unlock a keychain with `security unlock-keychain`.
  setKeychainSettings(configure: Configure<SecuritySetKeychainSettings>): Promise<CommandOutput>
    Change a keychain's lock settings with `security set-keychain-settings`.
  import(configure: Configure<SecurityImportSettings>): Promise<CommandOutput>
    Import a certificate or key with `security import`.
  setKeyPartitionList(configure: Configure<SecuritySetKeyPartitionListSettings>): Promise<CommandOutput>
    Set which tools may use a key with `security set-key-partition-list`.
  listKeychains(configure?: Configure<SecurityListKeychainsSettings>): Promise<string[]>
    Read — or, with `.set(...)`, replace — the keychain search list with
    `security list-keychains`. Returns the listed paths; empty after a set,
    which prints nothing.
  findIdentity(configure?: Configure<SecurityFindIdentitySettings>): Promise<SecurityIdentity[]>
    List signing identities with `security find-identity`, parsed.
  temporaryKeychain(configure: Configure<TemporaryKeychainSettings>, use: (keychain: TemporaryKeychain) => Promise<T>): Promise<T>
    Import a base64 `.p12` into a fresh keychain, run `use` with the keychain
    and its codesigning identity, and always tear the keychain down after.
    See {@link TemporaryKeychainSettings}.

interface TemporaryKeychain
  What the callback of `SecurityTasks.temporaryKeychain` is handed.

  keychain: string
    The keychain's absolute path — pass it to `codesign --keychain`.
  identity: SecurityIdentity
    The codesigning identity imported into it.

type SecurityDomain = "user" | "system" | "common" | "dynamic"
  A preference domain `security list-keychains` reads or sets (`-d`).

type SecurityImportFormat = "openssl" | "openssh1" | "openssh2" | "bsafe" | "raw" | "pkcs7" | "pkcs8" | "pkcs12" | "netscape" | "x509" | "pemseq"
  A file format `security import` accepts (`-f`).

type SecurityItemType = "pub" | "priv" | "session" | "cert" | "agg"
  An item type `security import` accepts (`-t`).
````

</details>

<!-- ZUKE:API:END -->
