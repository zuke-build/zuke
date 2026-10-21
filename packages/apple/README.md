# @zuke/apple

Typed task wrappers for building, signing and shipping Apple apps in
[Zuke](https://github.com/zuke-build/zuke#readme) builds — `xcodebuild`,
`codesign`, `xcrun notarytool`, `xcrun altool`, `security` and `ditto`,
provisioning profiles, and TestFlight through the App Store Connect API — in a
fluent settings-lambda API. Arguments stay a discrete argv array, so command
construction is injection-free.

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

| Task object                | Binary                | Tasks                                                                                                                                                                              |
| -------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodesignTasks`            | `codesign`            | `sign`, `verify`, `display` (parsed: identifier, team, authorities — read from stderr, where `codesign` writes them)                                                               |
| `NotarytoolTasks`          | `xcrun notarytool`    | `submit`, `info`, `log`, `history` — each returns the tool's JSON, parsed                                                                                                          |
| `SecurityTasks`            | `security`            | `createKeychain`, `deleteKeychain`, `unlockKeychain`, `setKeychainSettings`, `import`, `setKeyPartitionList`, `listKeychains`, `findIdentity`, `temporaryKeychain`                 |
| `DittoTasks`               | `ditto`               | `copy`, `archive` (`-c -k`), `extract` (`-x -k`)                                                                                                                                   |
| `XcodebuildTasks`          | `xcodebuild`          | `build`, `clean`, `analyze`, `buildForTesting`, `test`, `testWithoutBuilding`, `archive`, `exportArchive`, `resolvePackageDependencies`, `showBuildSettings`, `writeExportOptions` |
| `AltoolTasks`              | `xcrun altool`        | `uploadApp`, `validateApp`                                                                                                                                                         |
| `ProvisioningProfileTasks` | —                     | `inspect`, `install`, `temporary`                                                                                                                                                  |
| `TestFlightTasks`          | App Store Connect API | `distribute`                                                                                                                                                                       |

Task and setting names follow the real subcommands and flags:
`SecurityTasks.setKeyPartitionList` runs `security set-key-partition-list`,
`.privateKeys()` is its `-s`, `DittoSettings.keepParent()` is `--keepParent`.

## Building an iOS app

`XcodebuildTasks` archives a scheme and exports the archive to an `.ipa`. The
`ExportOptions.plist` the export needs is written from typed settings by
`writeExportOptions`, so the build does not keep a hand-edited plist:

```ts
import { XcodebuildTasks } from "@zuke/apple";

await XcodebuildTasks.archive((s) =>
  s.workspace("App.xcworkspace").scheme("App").configuration("Release")
    .destination("generic/platform=iOS").archivePath("build/App.xcarchive")
    .allowProvisioningUpdates()
    .authenticationKey("AuthKey_ABC123.p8", "ABC123", issuer)
);
await XcodebuildTasks.writeExportOptions(
  "build/ExportOptions.plist",
  (o) =>
    o.method("app-store-connect").teamId("ABCDE12345").destination("upload"),
);
await XcodebuildTasks.exportArchive((s) =>
  s.archivePath("build/App.xcarchive").exportPath("build/ipa")
    .exportOptionsPlist("build/ExportOptions.plist")
    .allowProvisioningUpdates()
    .authenticationKey("AuthKey_ABC123.p8", "ABC123", issuer)
);
```

With `.destination("upload")` the export uploads to App Store Connect; with
`"export"` (the default) it writes the `.ipa` to the export path. Build setting
overrides go through `.buildSetting(name, value)`, which accepts a condition in
the name (`CODE_SIGN_IDENTITY[sdk=iphoneos*]`) and refuses anything else.

## Shipping to TestFlight

A release runs in three steps. First, install the provisioning profile for the
signing steps only. Then archive and export with an upload destination. Last,
distribute the build once App Store Connect has processed it:

```ts
import {
  ProvisioningProfileTasks,
  TestFlightTasks,
  XcodebuildTasks,
} from "@zuke/apple";

await ProvisioningProfileTasks.temporary(
  (s) => s.base64(profileBase64),
  async ({ profile }) => {
    await XcodebuildTasks.archive((s) =>
      s.workspace("App.xcworkspace").scheme("App").configuration("Release")
        .destination("generic/platform=iOS").archivePath("build/App.xcarchive")
    );
    await XcodebuildTasks.writeExportOptions(
      "build/ExportOptions.plist",
      (o) =>
        o.method("app-store-connect").teamId(profile.teamIds[0])
          .signingStyle("manual")
          .provisioningProfile(profile.bundleId, profile.uuid)
          .destination("upload"),
    );
    await XcodebuildTasks.exportArchive((s) =>
      s.archivePath("build/App.xcarchive").exportPath("build/ipa")
        .exportOptionsPlist("build/ExportOptions.plist")
        .authenticationKey("AuthKey_ABC123.p8", "ABC123", issuer)
    );
  },
);
await TestFlightTasks.distribute((s) =>
  s.issuerId(issuer).keyId("ABC123").privateKey(p8)
    .bundleId("com.example.app").buildNumber(buildNumber)
    .usesNonExemptEncryption(false)
    .whatToTest("Checkout redesign.").group("QA").submitForBetaReview()
);
```

- **Provisioning profiles.** `ProvisioningProfileTasks` reads a
  `.mobileprovision` from a file or a base64 secret. It reads the profile's
  UUID, name, team, bundle id, expiry and kind from the plist inside it, on any
  OS and without running a subprocess. It installs the profile as
  `<uuid>.mobileprovision` into both directories Xcode reads profiles from. An
  expired profile is refused. `temporary` always removes the profile again, the
  same way `SecurityTasks.temporaryKeychain` removes its keychain.
- **Distribution.** `TestFlightTasks.distribute` signs an ES256 token with the
  App Store Connect API key. It finds the app by bundle id and waits for the
  uploaded build to finish processing (`.timeout()`, `.pollInterval()`). A build
  that comes back `INVALID` or `FAILED` throws a `TestFlightError`. Then it
  takes only the steps you asked for: the export-compliance answer, without
  which testers cannot install the build; the "What to Test" notes for each
  locale; adding the build to beta groups by name; and submitting it for beta
  review. Errors from the API arrive as an `AppStoreConnectError` that lists
  each problem the API reported. The private key and the token signed with it
  never appear in a log or an error.
- **`altool`.** `AltoolTasks.uploadApp` and `validateApp` wrap `xcrun altool`,
  which Apple has deprecated. It still works for pipelines that use it.
  `.appleId(user, password)` passes the app-specific password through an
  environment variable rather than the command line.

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

const APP_STORE_CONNECT_API_URL: "https://api.appstoreconnect.apple.com"
  The App Store Connect API's base URL.

const AltoolTasks: AltoolTasksApi
  Typed task functions for `xcrun altool`.

const CodesignTasks: CodesignTasksApi
  Typed task functions for Apple's `codesign`.

const DittoTasks: DittoTasksApi
  Typed task functions for macOS `ditto`.

const NotarytoolTasks: NotarytoolTasksApi
  Typed task functions for `xcrun notarytool`.

const ProvisioningProfileTasks: ProvisioningProfileTasksApi
  Read and install provisioning profiles.

const SecurityTasks: SecurityTasksApi
  Typed task functions for macOS `security`.

const TestFlightTasks: TestFlightTasksApi
  Distribute builds in TestFlight through the App Store Connect API.

const XcodebuildTasks: XcodebuildTasksApi
  Typed task functions for `xcodebuild`.

class AltoolSettings extends ToolSettings
  Settings for `xcrun altool --upload-app` and `--validate-app`.

  constructor(operation: AltoolOperation)
    Settings for `xcrun altool <operation>`.
  override protected defaultTool(): string
    The default executable name (`xcrun`), which dispatches to altool.
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `xcrun` ships with macOS in `/usr/bin`.
  file(path: PathLike): this
    The `.ipa` or `.pkg` to upload or validate (`--file`); required.
  type(platform: AltoolPlatform): this
    The app's platform (`--type`); required.
  apiKey(keyId: string, issuerId: string): this
    Authenticate with an App Store Connect API key: its key id and issuer id
    (`--apiKey`, `--apiIssuer`). `altool` finds `AuthKey_<keyId>.p8` in
    `~/.appstoreconnect/private_keys` and its other search directories, or in
    {@link apiPrivateKeysDir}.
  apiPrivateKeysDir(path: PathLike): this
    The directory holding `AuthKey_<keyId>.p8`, passed to `altool` as
    `API_PRIVATE_KEYS_DIR`.
  appleId(username: string, password: string): this
    Authenticate with an Apple ID and an app-specific password
    (`--username`, `--password`). The password is handed to `altool` in an
    environment variable it reads through `@env:`, so it is never on the
    command line, and it is registered with the run's redactor.
  override protected buildArgs(): string[]
    Assemble the `altool` argv; the output is always JSON.

class AppStoreConnectError extends Error
  Raised when the App Store Connect API answers with an error status. The
  message names the request and every error the API listed; it never carries
  the API key or the token signed with it.

  constructor(readonly request: string, readonly status: number, readonly errors: ReadonlyArray<AppStoreConnectErrorDetail>)
    Build the error from the request, the status and the API's errors.
  override name: string
    The error name.

class AppStoreConnectSettings
  Settings for a task that calls the App Store Connect API with an API key
  (Users and Access → Integrations in App Store Connect): the issuer id, the
  key id, and the `AuthKey_<keyId>.p8` private key.

  The private key and every token signed with it stay out of progress lines
  and errors. Declare them in the build as `parameter(...).secret()` so Zuke
  masks them in its own output too.

  issuerId_?: string
    The API key's issuer id (set by {@link issuerId}).
  keyId_?: string
    The API key's id (set by {@link keyId}).
  privateKey_?: string
    The private key, PEM (set by {@link privateKey}).
  privateKeyFile_?: string
    The private key's file (set by {@link privateKeyFile}).
  apiUrl_: string
    The API's base URL (set by {@link apiUrl}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}).
  readEnv_: (name: string) => string | undefined
    The environment reader (set by {@link readEnv}).
  sleep_: (ms: number) => Promise<void>
    How the task waits between polls (set by {@link sleep}).
  now_: () => number
    The clock, in epoch ms (set by {@link now}).
  log_: (line: string) => void
    Where progress lines go (set by {@link log}).
  issuerId(id: string): this
    The API key's issuer id, a UUID.
  keyId(id: string): this
    The API key's id, e.g. `ABC123`.
  privateKey(pem: string): this
    The private key, as the PEM text of `AuthKey_<keyId>.p8`.
  privateKeyFile(path: PathLike): this
    Read the private key from `AuthKey_<keyId>.p8`.
  apiUrl(url: string): this
    The API's base URL, `https://api.appstoreconnect.apple.com` by default.
    It carries the token, so it must be `https:` unless it is loopback or
    `ZUKE_ALLOW_INSECURE_URL` is set.
  fetch(fetcher: typeof fetch): this
    Send with this `fetch` instead of the global one — the seam tests use.
  readEnv(reader: (name: string) => string | undefined): this
    Read environment variables through `reader` instead of `Deno.env`.
  sleep(sleeper: (ms: number) => Promise<void>): this
    Wait through `sleeper` instead of a timer — the seam tests use.
  now(clock: () => number): this
    Read the time from `clock` (epoch ms) instead of `Date.now`.
  log(sink: (line: string) => void): this
    Send progress lines to `sink` instead of `console.log`.

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

class ExportOptionsSettings
  Settings for an `ExportOptions.plist`.

  readonly options_: Map<string, ExportOptionValue>
    The options set so far, in the order each key was first set; setting a
    key again replaces its value in place.
  method(method: ExportMethod): this
    How the archive is exported (`method`); required.
  teamId(id: string): this
    The developer team id (`teamID`).
  signingStyle(style: ExportSigningStyle): this
    Automatic or manual signing (`signingStyle`).
  signingCertificate(name: string): this
    The certificate to sign with, e.g. `Apple Distribution` (`signingCertificate`).
  provisioningProfile(bundleId: string, profile: string): this
    The provisioning profile, by name or UUID, for one bundle identifier
    (`provisioningProfiles`); repeatable, once per app and extension.
  destination(destination: ExportDestination): this
    Export to a directory, or upload to App Store Connect (`destination`).
  uploadSymbols(enabled: boolean): this
    Include symbols for crash reports (`uploadSymbols`).
  manageAppVersionAndBuildNumber(enabled: boolean): this
    Let App Store Connect manage the version and build number (`manageAppVersionAndBuildNumber`).
  stripSwiftSymbols(enabled: boolean): this
    Strip Swift symbols from the binary (`stripSwiftSymbols`).
  testFlightInternalTestingOnly(enabled: boolean): this
    Limit a TestFlight upload to internal testers (`testFlightInternalTestingOnly`).
  render(): string
    The property list, as `xcodebuild -exportArchive -exportOptionsPlist`
    reads it. Pure: no I/O.

    @throws {Error}
        when no {@link method} is set, or a value holds a control
        character a plist cannot carry.

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

class ProvisioningProfileError extends Error
  Raised by `ProvisioningProfileTasks` when a profile cannot be read, is
  expired, or could not be removed after `temporary`. When the callback had
  already failed before the removal did, that error is the
  {@link Error.cause}.

  constructor(message: string, options?: ErrorOptions)
    Build the error; the message is prefixed with `Provisioning profile:`.
  override name: string
    The error name.

class ProvisioningProfileSettings
  Settings for `ProvisioningProfileTasks`.

  file_?: string
    The profile file (set by {@link file}).
  base64_?: string
    The profile as base64 (set by {@link base64}).
  directories_: string[]
    Directories to install into (set by {@link directory}).
  allowExpired_: boolean
    Whether an expired profile may be installed (set by {@link allowExpired}).
  host_: ProvisioningHost
    The file-system seam (set by {@link host}).
  now_: () => number
    The clock, in epoch ms (set by {@link now}).
  file(path: PathLike): this
    Read the profile from a `.mobileprovision` file.
  base64(text: string): this
    Take the profile as base64 — how a CI secret usually holds it
    (`base64 -i profile.mobileprovision`).
  directory(path: PathLike): this
    Install into this directory instead of Xcode's two defaults; repeatable.
  allowExpired(): this
    Install the profile even if it has expired.
  host(host: ProvisioningHost): this
    Work through `host` instead of the real file system — the test seam.
  now(clock: () => number): this
    Read the time from `clock` (epoch ms) instead of `Date.now`.

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

class TestFlightError extends Error
  Raised by `TestFlightTasks.distribute` when the release cannot go ahead:
  no app has the bundle id, a beta group does not exist, the build finished
  processing as `INVALID` or `FAILED`, or it had not finished by the timeout.

  override name: string
    The error name.

class TestFlightSettings extends AppStoreConnectSettings
  Settings for `TestFlightTasks.distribute`.

  bundleId_?: string
    The app's bundle id (set by {@link bundleId}).
  buildNumber_?: string
    The build number (set by {@link buildNumber}).
  version_?: string
    The version (set by {@link version}).
  platform_?: TestFlightPlatform
    The platform (set by {@link platform}).
  timeout_: number
    The longest wait for processing, in ms (set by {@link timeout}).
  pollInterval_: number
    The time between two polls, in ms (set by {@link pollInterval}).
  usesNonExemptEncryption_?: boolean
    Export compliance (set by {@link usesNonExemptEncryption}).
  whatToTest_: Map<string, string>
    "What to Test" notes by locale (set by {@link whatToTest}).
  groups_: string[]
    Beta groups to add the build to (set by {@link group}).
  submitForBetaReview_: boolean
    Whether to submit for beta review (set by {@link submitForBetaReview}).
  bundleId(id: string): this
    The app's bundle id, e.g. `com.example.app`; required.
  buildNumber(number: string | number): this
    The uploaded build's number, `CFBundleVersion`; required.
  version(version: string): this
    The uploaded build's version, `CFBundleShortVersionString` — needed when
    the same build number exists under several versions.
  platform(platform: TestFlightPlatform): this
    The build's platform — needed when the app ships on several.
  timeout(duration: string | number): this
    The longest wait for the build to finish processing (`"45m"`, or ms); default 30 minutes.
  pollInterval(duration: string | number): this
    The time between two looks at the build (`"1m"`, or ms); default 30 seconds.
  usesNonExemptEncryption(uses: boolean): this
    Answer the export-compliance question: whether the app uses encryption
    beyond the exempt kinds. Until it is answered — here, or by
    `ITSAppUsesNonExemptEncryption` in `Info.plist` — the build sits at
    Missing Compliance and no tester can install it.
  whatToTest(text: string, locale: string): this
    The "What to Test" notes testers see, per locale; default locale `en-US`.
  group(name: string): this
    Add the build to this beta group, by name; repeatable.
  submitForBetaReview(): this
    Submit the build for beta review, which external testing needs.

class XcodebuildActionSettings extends XcodebuildProjectSettings
  Settings for `xcodebuild build`, `clean`, `analyze`, `build-for-testing` and
  `-resolvePackageDependencies`.

  constructor(action: XcodebuildPlainAction)
    Settings for `xcodebuild <action>`.
  override protected actionArgs(): string[]
    The action.

class XcodebuildArchiveSettings extends XcodebuildProjectSettings
  Settings for `xcodebuild archive`.

  archivePath(path: PathLike): this
    Where to write the `.xcarchive` (`-archivePath`); required.
  override protected actionArgs(): string[]
    `archive -archivePath <path>`.

class XcodebuildExportArchiveSettings extends XcodebuildSettings
  Settings for `xcodebuild -exportArchive`.

  archivePath(path: PathLike): this
    The `.xcarchive` to export (`-archivePath`); required.
  exportPath(path: PathLike): this
    The directory to write the export to (`-exportPath`); required.
  exportOptionsPlist(path: PathLike): this
    The export options (`-exportOptionsPlist`); required. Write one with
    `XcodebuildTasks.writeExportOptions`.
  override protected invocationArgs(): string[]
    `-exportArchive` with its three paths.

abstract class XcodebuildProjectSettings extends XcodebuildSettings
  The project flags every build action takes. Each action names itself and
  its own flags; the project flags come first, then the action, then the
  build settings.

  abstract protected actionArgs(): string[]
    The action and its own flags, e.g. `["archive", "-archivePath", …]`.
  workspace(path: PathLike): this
    The workspace to build, e.g. `App.xcworkspace` (`-workspace`).
  project(path: PathLike): this
    The project to build, e.g. `App.xcodeproj` (`-project`).
  scheme(name: string): this
    The scheme to build (`-scheme`); required with a workspace. A later call replaces it.
  configuration(name: string): this
    The build configuration, e.g. `Release` (`-configuration`). A later call replaces it.
  sdk(name: string): this
    The SDK, e.g. `iphoneos` or `iphonesimulator` (`-sdk`). A later call replaces it.
  destination(specifier: string): this
    A destination, e.g. `generic/platform=iOS` or
    `platform=iOS Simulator,name=iPhone 16` (`-destination`); repeatable.
  derivedDataPath(path: PathLike): this
    Where intermediate build files go (`-derivedDataPath`).
  clonedSourcePackagesDirPath(path: PathLike): this
    Where Swift packages are checked out (`-clonedSourcePackagesDirPath`).
  resultBundlePath(path: PathLike): this
    Write an `.xcresult` bundle with the logs and results (`-resultBundlePath`).
  xcconfig(path: PathLike): this
    Apply an `.xcconfig` file's settings over every target (`-xcconfig`).
  buildSetting(name: string, value: string): this
    Override a build setting for every target, e.g.
    `("DEVELOPMENT_TEAM", "ABCDE12345")` → `DEVELOPMENT_TEAM=ABCDE12345`;
    repeatable. A condition goes in the name:
    `CODE_SIGN_IDENTITY[sdk=iphoneos*]`.
  override protected invocationArgs(): string[]
    The project flags, the action, then the build settings.

abstract class XcodebuildSettings extends ToolSettings
  Base for all `xcodebuild` settings: the binary is `xcodebuild`, on `PATH`.

  override protected defaultTool(): string
    The default executable name (`xcodebuild`).
  override protected defaultResolution(): ToolResolution
    Resolve from `PATH` — `xcodebuild` ships with Xcode in `/usr/bin`.
  abstract protected invocationArgs(): string[]
    The invocation's own arguments, placed after the shared flags.
  quietOutput(): this
    Print only warnings and errors (`-quiet`).
  allowProvisioningUpdates(): this
    Let Xcode create and update provisioning profiles and certificates
    (`-allowProvisioningUpdates`); on CI, pair it with
    {@link authenticationKey}.
  authenticationKey(path: PathLike, keyId: string, issuerId: string): this
    Sign in to the developer account with an App Store Connect API key
    instead of an Xcode account: the `AuthKey_<id>.p8` file, its key id and
    its issuer id (`-authenticationKeyPath`, `-authenticationKeyID`,
    `-authenticationKeyIssuerID`).
  override protected buildArgs(): string[]
    Assemble the argv: the invocation's arguments, then the shared flags.

class XcodebuildShowBuildSettings extends XcodebuildProjectSettings
  Settings for `xcodebuild -showBuildSettings`.

  json(): this
    Print the settings as JSON (`-json`).
  override protected actionArgs(): string[]
    `-showBuildSettings`, then `-json` when asked for.

class XcodebuildTestSettings extends XcodebuildProjectSettings
  Settings for `xcodebuild test` and `test-without-building`.

  constructor(action: XcodebuildTestAction)
    Settings for `xcodebuild <action>`.
  xctestrun(path: PathLike): this
    Run the tests a `build-for-testing` run described, from its `.xctestrun`
    file (`-xctestrun`), instead of a scheme — the usual way to run
    `test-without-building`.
  testPlan(name: string): this
    The test plan to run (`-testPlan`).
  onlyTesting(identifier: string): this
    Run only this test target, class or method, e.g. `AppTests/LoginTests`
    (`-only-testing`); repeatable.
  skipTesting(identifier: string): this
    Skip this test target, class or method (`-skip-testing`); repeatable.
  enableCodeCoverage(enabled: boolean): this
    Turn code coverage on or off (`-enableCodeCoverage YES|NO`).
  parallelTestingEnabled(enabled: boolean): this
    Turn parallel testing on or off (`-parallel-testing-enabled YES|NO`).
  retryTestsOnFailure(): this
    Re-run a failed test until it passes, up to the iteration limit (`-retry-tests-on-failure`).
  testIterations(count: number): this
    How many times to run each test (`-test-iterations`).
  override protected actionArgs(): string[]
    The action and the test flags.

interface AltoolTasksApi
  The shape of {@link AltoolTasks}.

  uploadApp(configure: Configure<AltoolSettings>): Promise<CommandOutput>
    Upload an app to App Store Connect: `xcrun altool --upload-app`.
  validateApp(configure: Configure<AltoolSettings>): Promise<CommandOutput>
    Validate an app without uploading it: `xcrun altool --validate-app`.

interface AppStoreConnectErrorDetail
  One entry of an App Store Connect API error response's `errors` list.

  code: string
    The machine-readable code, e.g. `ENTITY_ERROR.ATTRIBUTE.INVALID`.
  title: string
    The short title.
  detail?: string
    The explanation, when the API gave one.

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

interface InstalledProvisioningProfile
  An installed provisioning profile.

  readonly profile: ProvisioningProfile
    What the profile says about itself.
  readonly paths: readonly string[]
    Every file it was installed as.

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

interface ProvisioningHost
  The operations installing a provisioning profile needs.

  readFile(path: string): Promise<Uint8Array>
    Read a file's bytes.
  makeDirectory(path: string): Promise<void>
    Create a directory and its parents, if missing.
  writeFile(path: string, data: Uint8Array): Promise<void>
    Write a file, replacing one that exists.
  remove(path: string): Promise<void>
    Remove a file.
  exists(path: string): Promise<boolean>
    Whether a file exists.
  home(): string
    The user's home directory.

interface ProvisioningProfile
  A provisioning profile's identity, as read from the profile itself.

  readonly uuid: string
    The profile's UUID — Xcode installs it as `<uuid>.mobileprovision`.
  readonly name: string
    The profile's name, as `ExportOptions.plist` can refer to it.
  readonly teamIds: readonly string[]
    The team ids it belongs to.
  readonly teamName: string
    The team's name.
  readonly appIdName: string
    The App ID's name.
  readonly bundleId: string
    The bundle identifier it signs, e.g. `com.example.app`, or a wildcard
    such as `com.example.*` — the `application-identifier` entitlement
    without its team prefix.
  readonly platforms: readonly string[]
    The platforms it is for, e.g. `["iOS"]`.
  readonly kind: ProvisioningProfileKind
    How it distributes the app.
  readonly creationDate: Date
    When it was created.
  readonly expirationDate: Date
    When it expires.
  readonly xcodeManaged: boolean
    Whether Xcode created and manages it (automatic signing).

interface ProvisioningProfileTasksApi
  The shape of {@link ProvisioningProfileTasks}.

  inspect(configure: Configure<ProvisioningProfileSettings>): Promise<ProvisioningProfile>
    Read what a profile says about itself, without installing it.
  install(configure: Configure<ProvisioningProfileSettings>): Promise<InstalledProvisioningProfile>
    Install a profile where Xcode looks for it, named by its UUID. Refuses an
    expired profile unless `.allowExpired()`.
  temporary(configure: Configure<ProvisioningProfileSettings>, fn: (installed: InstalledProvisioningProfile) => Promise<T>): Promise<T>
    Install a profile, run `fn`, then remove every file the install created —
    even when `fn` throws. A copy that was already installed under the same
    UUID is left in place. Returns what `fn` returns.

    @throws {ProvisioningProfileError}
        when a file could not be removed; if
        `fn` had thrown first, its error is the cause.

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

interface TestFlightBuild
  A build in App Store Connect, once processed.

  readonly id: string
    The build's App Store Connect id.
  readonly appId: string
    The app's App Store Connect id.
  readonly buildNumber: string
    The build number, `CFBundleVersion`.
  readonly processingState: string
    The processing state: `VALID` once `distribute` returns.

interface TestFlightTasksApi
  The shape of {@link TestFlightTasks}.

  distribute(configure: Configure<TestFlightSettings>): Promise<TestFlightBuild>
    Wait for an uploaded build to be processed, then distribute it in
    TestFlight as configured.

    @throws {TestFlightError}
        when the app or a beta group is missing, the
        build fails processing, or it is not processed in time.

    @throws {AppStoreConnectError}
        when the API refuses a request.

interface XcodebuildTasksApi
  The shape of {@link XcodebuildTasks}.

  build: XcodebuildActionTask
    Build a scheme: `xcodebuild build`.
  clean: XcodebuildActionTask
    Remove build products: `xcodebuild clean`.
  analyze: XcodebuildActionTask
    Run the static analyzer: `xcodebuild analyze`.
  buildForTesting: XcodebuildActionTask
    Build for a later test run: `xcodebuild build-for-testing`.
  resolvePackageDependencies: XcodebuildActionTask
    Resolve Swift package dependencies: `xcodebuild -resolvePackageDependencies`.
  test: XcodebuildTestTask
    Build and run the tests: `xcodebuild test`.
  testWithoutBuilding: XcodebuildTestTask
    Run tests already built: `xcodebuild test-without-building`.
  archive(configure: Configure<XcodebuildArchiveSettings>): Promise<CommandOutput>
    Build an `.xcarchive`: `xcodebuild archive`.
  exportArchive(configure: Configure<XcodebuildExportArchiveSettings>): Promise<CommandOutput>
    Export an archive to an `.ipa`, or upload it: `xcodebuild -exportArchive`.
  showBuildSettings(configure?: Configure<XcodebuildShowBuildSettings>): Promise<CommandOutput>
    Print the resolved build settings: `xcodebuild -showBuildSettings`.
  writeExportOptions(path: PathLike, configure: Configure<ExportOptionsSettings>): Promise<void>
    Write an `ExportOptions.plist` for {@link exportArchive} to `path`. Runs
    no subprocess.

type AltoolOperation = "--upload-app" | "--validate-app"
  The `altool` operations this wrapper runs.

type AltoolPlatform = "ios" | "macos" | "appletvos" | "visionos"
  The platform of the app being uploaded (`--type`).

type ExportDestination = "export" | "upload"
  Whether to write the export locally or upload it to App Store Connect (`destination`).

type ExportMethod = "app-store-connect" | "release-testing" | "enterprise" | "debugging" | "developer-id" | "mac-application" | "validation" | "app-store" | "ad-hoc" | "development"
  How an archive is exported (`method`). Xcode 15.3 renamed three methods:
  `app-store-connect`, `release-testing` and `debugging` were `app-store`,
  `ad-hoc` and `development`, which older Xcode versions still require.

type ExportOptionValue = string | boolean | Record<string, string>
  One value in an `ExportOptions.plist`: a string, a boolean, or a string dictionary.

type ExportSigningStyle = "automatic" | "manual"
  Whether Xcode or the export options pick the signing assets (`signingStyle`).

type ProvisioningProfileKind = "development" | "ad-hoc" | "enterprise" | "app-store"
  How a profile distributes the app, as Xcode's Organizer names it:
  `development` (devices listed, debugging allowed), `ad-hoc` (devices
  listed), `enterprise` (all devices) or `app-store` (no devices — App Store
  and TestFlight).

type SecurityDomain = "user" | "system" | "common" | "dynamic"
  A preference domain `security list-keychains` reads or sets (`-d`).

type SecurityImportFormat = "openssl" | "openssh1" | "openssh2" | "bsafe" | "raw" | "pkcs7" | "pkcs8" | "pkcs12" | "netscape" | "x509" | "pemseq"
  A file format `security import` accepts (`-f`).

type SecurityItemType = "pub" | "priv" | "session" | "cert" | "agg"
  An item type `security import` accepts (`-t`).

type TestFlightPlatform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS"
  The platform of a build, as App Store Connect names it.

type XcodebuildActionTask = (configure?: Configure<XcodebuildActionSettings>) => Promise<CommandOutput>
  A task that runs a flag-free `xcodebuild` action.

type XcodebuildPlainAction = "analyze" | "build" | "build-for-testing" | "clean" | "-resolvePackageDependencies"
  An `xcodebuild` action that takes no flags of its own.

type XcodebuildTestAction = "test" | "test-without-building"
  An `xcodebuild` action that runs tests.

type XcodebuildTestTask = (configure?: Configure<XcodebuildTestSettings>) => Promise<CommandOutput>
  A task that runs an `xcodebuild` test action.
````

</details>

<!-- ZUKE:API:END -->
