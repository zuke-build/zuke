# @zuke/google

<!-- cspell:ignore Последната версия -->

Google Play publishing for [Zuke](https://github.com/zuke-build/zuke#readme)
builds: upload an Android app bundle to a Play track, with a release status and
release notes, through the Google Play Developer API — the counterpart of
`@zuke/apple`'s `TestFlightTasks`. The service-account key signs an RS256 JWT
that is exchanged for an access token; neither reaches a progress line or an
error.

```ts
import { GooglePlayTasks } from "@zuke/google";

await GooglePlayTasks.upload((s) =>
  s.serviceAccount(keyJson)
    .packageName("com.example.app")
    .bundle("build/app/outputs/bundle/release/app-release.aab")
    .track("internal")
    .status("completed")
    .releaseNotes("The latest build.", "en-US")
    .releaseNotes("Последната версия.", "bg")
    .timeout("15m")
);
```

## What `upload` does

1. Signs in with the service account's JWT (scope `androidpublisher`).
2. Opens an edit on the app.
3. Uploads the bundle and reads back its `versionCode`.
4. Sets the track's release to that version code, with the status and release
   notes.
5. Commits the edit — or deletes it when a step failed, so no half-made edit is
   left behind.

It returns the `versionCode`, track and status.

| Setting                      | Meaning                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `.serviceAccount(json)`      | The key's JSON text (required). Declare it `parameter(...).secret()` so Zuke masks it too.  |
| `.packageName(name)`         | The app's package name (required).                                                          |
| `.bundle(path)`              | The `.aab` to upload (required) — `FlutterTasks.buildAppBundle` builds one.                 |
| `.track(name)`               | `internal` (default), `alpha`, `beta`, `production`, or a closed testing track's name.      |
| `.status("completed")`       | `completed` (default) or `draft`. An app that has never had a release accepts only a draft. |
| `.releaseNotes(text, lang)`  | Repeatable, one call per BCP-47 language; default `en-US`.                                  |
| `.changesNotSentForReview()` | Commit without sending the changes for review, where Google requires that for the app.      |
| `.timeout("15m")`            | The longest the whole upload may take; default 15 minutes.                                  |

The service account needs the _Release apps to testing tracks_ (or _Release to
production_) permission on the app in the Play Console. A refused step throws a
`GooglePlayError` carrying Google's own message and the HTTP status.

## Resolution

No binary: the task talks to `https://androidpublisher.googleapis.com` and the
key's `token_uri` with `fetch`. Both must be `https:` unless loopback or
`ZUKE_ALLOW_INSECURE_URL` is set. `.fetch()`, `.now()` and `.log()` are the
seams tests use.

<!-- ZUKE:API:START -->

## API

<details>
<summary>Full typed API — generated from <code>deno doc</code></summary>

````text
`@zuke/google` — Google Play publishing for Zuke builds, through the Google
Play Developer API. The counterpart of `@zuke/apple`'s `TestFlightTasks`.

```ts
import { GooglePlayTasks } from "@zuke/google";

await GooglePlayTasks.upload((s) =>
  s.serviceAccount(keyJson)
    .packageName("com.example.app")
    .bundle("build/app/outputs/bundle/release/app-release.aab")
    .track("internal")
    .releaseNotes("What changed.", "en-US")
);
```
@module

const GOOGLE_PLAY_API_URL: "https://androidpublisher.googleapis.com"
  The Google Play Developer API's base URL.

const GooglePlayTasks: GooglePlayTasksApi
  Publish to Google Play through the Google Play Developer API.

class GooglePlayError extends Error
  Raised by `GooglePlayTasks.upload`. The message names the step and, for a
  refused request, Google's own error message; it never carries the
  service-account key or an access token.

  constructor(message: string, readonly status?: number)
    Build the error from its message and, for a refused request, the HTTP status.
  override name: string
    The error name.

class GooglePlaySettings
  Settings for `GooglePlayTasks.upload`.

  The service-account key and every token signed with it stay out of progress
  lines and errors. Declare the key in the build as `parameter(...).secret()`
  so Zuke masks it in its own output too.

  serviceAccount_?: string
    The service-account key's JSON text (set by {@link serviceAccount}).
  packageName_?: string
    The app's package name (set by {@link packageName}).
  bundle_?: string
    The app bundle's path (set by {@link bundle}).
  track_: string
    The track (set by {@link track}).
  status_: GooglePlayReleaseStatus
    The release status (set by {@link status}).
  releaseNotes_: Map<string, string>
    Release notes by language (set by {@link releaseNotes}).
  changesNotSentForReview_: boolean
    Whether the commit skips review (set by {@link changesNotSentForReview}).
  timeout_: number
    The longest the whole upload may take, in ms (set by {@link timeout}).
  apiUrl_: string
    The API's base URL (set by {@link apiUrl}).
  fetch_: typeof fetch
    The `fetch` to use (set by {@link fetch}).
  readEnv_: (name: string) => string | undefined
    The environment reader (set by {@link readEnv}).
  now_: () => number
    The clock, in epoch ms (set by {@link now}).
  log_: (line: string) => void
    Where progress lines go (set by {@link log}).
  serviceAccount(json: string): this
    The service account's key, as the text of the JSON file the Play Console
    (or Google Cloud) downloaded; required. The account needs the Release
    apps to testing tracks (or Release to production) permission on the
    app.
  packageName(name: string): this
    The app's package name, e.g. `com.example.app`; required.
  bundle(path: PathLike): this
    The Android app bundle (`.aab`) to upload; required.
  track(name: string): this
    The track to release on: `internal` (the default), `alpha`, `beta`,
    `production`, or the name of a closed testing track.
  status(status: GooglePlayReleaseStatus): this
    The release's status; default `completed`.
  releaseNotes(text: string, language: string): this
    The release notes users see, per BCP-47 language (`"en-US"`, `"bg"`);
    repeatable, one call per language. Default language `en-US`.
  changesNotSentForReview(): this
    Commit without sending the changes for review, so an app with managed
    publishing or a release that review would otherwise hold can go out as
    Google allows it to.
  timeout(duration: string | number): this
    The longest the whole upload may take (`"30m"`, or ms); default 15 minutes.
  apiUrl(url: string): this
    The API's base URL, `https://androidpublisher.googleapis.com` by default.
    It carries the access token, so it must be `https:` unless it is loopback
    or `ZUKE_ALLOW_INSECURE_URL` is set.
  fetch(fetcher: typeof fetch): this
    Send with this `fetch` instead of the global one — the seam tests use.
  readEnv(reader: (name: string) => string | undefined): this
    Read environment variables through `reader` instead of `Deno.env`.
  now(clock: () => number): this
    Read the time from `clock` (epoch ms) instead of `Date.now`.
  log(sink: (line: string) => void): this
    Send progress lines to `sink` instead of `console.log`.

interface GooglePlayTasksApi
  The shape of {@link GooglePlayTasks}.

  upload(configure: Configure<GooglePlaySettings>): Promise<GooglePlayUpload>
    Upload an app bundle and release it on a track, in one committed edit.

    @throws {GooglePlayError}
        when the service account cannot sign in, the
        API refuses a step, or the upload runs out of time.

interface GooglePlayUpload
  What `GooglePlayTasks.upload` released.

  readonly packageName: string
    The app's package name.
  readonly versionCode: number
    The uploaded bundle's version code, as Google Play read it.
  readonly track: string
    The track the release went to.
  readonly status: GooglePlayReleaseStatus
    The release's status.

type GooglePlayReleaseStatus = "completed" | "draft"
  A release's status on its track. `completed` makes it live for the track's
  testers or users; `draft` saves it to publish from the Play Console — the
  only status Google accepts for an app that has never had a release.
````

</details>

<!-- ZUKE:API:END -->
