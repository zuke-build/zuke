# Running the AI review as your own GitHub App

This is the walk-through from an organisation with no App to reviews that post
as `<your-app>[bot]`, answer maintainers in review threads, close the threads
they settle, and react 👀 when someone comments a command — the setup this
repository runs under `zuke-build[bot]`. It assumes you already have an AI
reviewer gating a target (see [AI code review](./ai-review.md)); everything here
is about the identity it posts with.

## Do you need an App?

Not to review. With `.comment()` and no token named, the reviewer posts with the
workflow's own `GITHUB_TOKEN` as `github-actions[bot]`: the summary comment, the
line-anchored review threads, the outcome replies in them and the Commands panel
all work, and so do rebuttals and the `accept` command. That is the zero-setup
default, and for many projects it is enough.

An App adds two things:

- **Resolved threads.** GitHub allows the mutation that resolves a review thread
  to repository _write_ access only, and refuses it to the Actions token on the
  same scope that lets it post the reply. An App token minted with
  `contents: write` may resolve, so a finding the reviewer dismisses or marks
  fixed is closed, not left open for a human to tidy.
- **A name of its own.** The reviews come from `acme-bot[bot]` rather than the
  generic Actions account, which is also the mention maintainers address
  commands to (`@acme-bot review`, `@acme-bot accept …`), so the thread reads as
  a conversation with one reviewer.

The App is _yours_: an App's identity is its private key, which only its owner
holds, so the `zuke-build` App this repository uses cannot be shared with other
repositories. Creating one takes about five minutes.

## 1. Create the App

Go to your organisation's **Settings → Developer settings → GitHub Apps → New
GitHub App** (for a personal account, the same path under your user settings).

| Field                                       | Value                                                                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub App name**                         | The name the reviews will post under and the mention people will type, e.g. `acme-bot`. GitHub requires it to be unique across all Apps. Short and pronounceable beats descriptive.                 |
| **Homepage URL**                            | Anything; your repository's URL is fine.                                                                                                                                                            |
| **Webhook → Active**                        | **Untick.** The review never receives events; it mints a token and calls the API. Leaving this on only asks you for a webhook URL you do not have.                                                  |
| **Repository permissions**                  | **Contents: Read and write**, **Issues: Read and write**, **Pull requests: Read and write**. Metadata is added read-only automatically. Nothing else — no Actions, no Workflows, no Administration. |
| **Organization / Account permissions**      | None.                                                                                                                                                                                               |
| **Where can this GitHub App be installed?** | **Only on this account.** Nobody else needs to install it.                                                                                                                                          |

What each permission is for:

- **Pull requests** — the summary comment, the review threads and the replies in
  them.
- **Issues** — the 👀 reaction on a command comment. A pull request's
  conversation comments are issue comments in GitHub's API, so this is where
  reactions on them live.
- **Contents** — resolving review threads. This is GitHub's rule, not the
  reviewer's preference: the GraphQL mutation that resolves a thread is granted
  to whoever has write access to the repository, and for an installation token
  that is what `contents: write` means. The token can therefore also push and
  tag; the build narrows what it mints to these three permissions and nothing
  touching workflows or Actions.

Click **Create GitHub App**. On the page that opens, note the **App ID** near
the top. Then scroll to **Private keys → Generate a private key**: GitHub
downloads a `.pem` file, the only copy there will ever be. Keep it; it is the
second secret below.

## 2. Install the App on the repository

On the App's settings page, open **Install App** in the sidebar, pick your
organisation, and choose **Only select repositories** with the repository the
review runs on. The App now has its permissions there and nowhere else. An App
that is created but not installed mints nothing: the token source below then
falls back to `GITHUB_TOKEN`, with a warning in the job log naming the failed
mint.

## 3. Store the credentials

In the repository, **Settings → Secrets and variables → Actions → New repository
secret**, twice:

| Secret           | Value                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `REVIEW_APP_ID`  | The App ID from step 1, a number.                                                                    |
| `REVIEW_APP_KEY` | The **contents** of the `.pem` file, both `-----BEGIN` and `-----END` lines included — not its path. |

The names are yours to choose; the build below reads them off the parameters it
declares. Nothing in **Actions → General → Workflow permissions** needs to
change: the generated jobs declare the `pull-requests: write` they need
themselves, and the App token carries the rest.

## 4. Wire the build

This mirrors this repository's own `zuke.ts`: the credentials as parameters, the
token source pinned to the repository and narrowed to what the review does, both
reviewers posting with it and taking commands under the App's name, and the
workflow handing the credentials to both jobs with egress blocked.

<!-- check -->

```ts
import { Build, parameter, run, target } from "@zuke/core";
import {
  aiReviewWorkflow,
  budget,
  genericReviewer,
  securityReviewer,
} from "@zuke/ai";
import { GhTasks } from "@zuke/gh";

class CI extends Build {
  openaiKey = parameter("OpenAI API key for the AI review")
    .secret()
    .env("OPENAI_API_KEY");

  // The App's credentials: present on both review jobs, absent locally and on
  // a fork's run, where the token source falls back to GITHUB_TOKEN.
  appId = parameter("GitHub App id of acme-bot").env("REVIEW_APP_ID");
  appKey = parameter("Private key (PEM) of acme-bot").secret().env(
    "REVIEW_APP_KEY",
  );

  // Minted once per run and shared by both reviewers. Pinned to this
  // repository, so a run anywhere else gets the fallback rather than a token
  // for this repository minted into a build running elsewhere; narrowed to
  // the three permissions the review uses, whatever else the App holds.
  botToken = GhTasks.appTokenSource((s) =>
    s.app(this.appId, this.appKey)
      .repository("acme/widgets")
      .permission("pull-requests", "write")
      .permission("issues", "write")
      .permission("contents", "write")
  );

  aiBudget = budget((b) => b.maxTokens(500_000));

  security = securityReviewer((r) =>
    r.provider("openai").apiKey(this.openaiKey).budget(this.aiBudget)
      .skipIfKeyMissing()
      .comment("append").commentToken(this.botToken)
      .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/main"))
      .maxDiffTokens(20_000)
      .fileContext()
      .verify()
      // Threads on each finding's line, and commands under the App's name:
      // `@acme-bot review` and `@acme-bot accept <id> reason`.
      .discussion((d) => d.threads().commands("@acme-bot"))
  );

  quality = genericReviewer((r) =>
    r.provider("openai").apiKey(this.openaiKey).budget(this.aiBudget)
      .skipIfKeyMissing()
      .comment("append").commentToken(this.botToken)
      .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/main"))
      .maxDiffTokens(20_000)
      .fileContext()
      .verify()
      .discussion((d) => d.threads().commands("@acme-bot"))
  );

  review = target()
    .description("AI review of the diff")
    .validateBefore(this.security, this.quality)
    .executes(() => {});

  aiReview = aiReviewWorkflow({
    reviewers: [this.security, this.quality],
    baseBranch: "main",
    // Both jobs receive the credentials, so threads answered on a push run
    // are resolved too. Only for a repository whose pull-request job you
    // would hand them to: it runs the pull request's own build, so everyone
    // who can push a branch can read what it holds. A fork's run receives
    // nothing and is skipped by the job's gate.
    secrets: [this.appId, this.appKey],
    // A job holding a key worth stealing blocks egress: what the launcher and
    // module resolution reach, plus the model provider, which the generator
    // adds itself.
    egress: "block",
    allowedEndpoints: [
      "deno.land:443",
      "dl.deno.land:443",
      "jsr.io:443",
      "github.com:443",
      "api.github.com:443",
      "codeload.github.com:443",
      "objects.githubusercontent.com:443",
      "release-assets.githubusercontent.com:443",
    ],
  });
}

await run(CI);
```

Four things to adapt: the App's name in `commands(...)`, the repository in
`.repository(...)`, the base branch, and the model key. The command job needs no
declaring — a reviewer that takes commands is what generates it, with
`@acme-bot review` and `@acme-bot accept` as its commands and push access as the
default for who may start one (`command: (c) => c.role("triage")` or
`.users("alice")` on the spec widen that).

Generate the workflow and commit it:

```sh
deno run -A zuke.ts generate-ci
git add .github/workflows/ai-review.yml
```

## 5. What a pull request looks like now

Open a pull request. The `pull_request` job runs the review with the App's
credentials, so:

- each finding arrives as a review thread from `acme-bot[bot]` on the line it is
  about, with the summary comment carrying the Commands panel;
- a maintainer who replies in a thread, or comments
  `@acme-bot accept <id>
  reason`, gets the answer on the next run — a push, or
  `@acme-bot review`, which the App reacts 👀 to before it starts;
- a finding the reviewer dismisses, accepts or marks fixed gets its thread
  **resolved**, which is the part `GITHUB_TOKEN` cannot do.

To check the identity took, look at the author of the summary comment: it is
`acme-bot[bot]`. If it is `github-actions[bot]`, see the troubleshooting below.

## Security notes

- **Who can read the key.** `secrets` on the spec hands the App's credentials to
  the pull-request job, which executes the pull request's own `zuke.ts`. On a
  repository where everyone with push access is a maintainer, that is the right
  trade: it is what closes threads on ordinary pushes. Where it is not, put the
  credentials on `command: (c) => c.secrets(this.appId, this.appKey)` instead,
  so only the comment-started job — which runs the default branch's build, never
  the pull request's — holds them; push runs then post as `github-actions[bot]`
  and leave threads for the next command run to resolve.
- **Forks.** A fork's pull request receives no secrets from GitHub at all, and
  the pull-request job's gate skips it besides. The command job covers forks
  safely because the pull request is fetched as data and never executed.
- **The token is narrow and short-lived.** Installation tokens expire after an
  hour; the source mints one per run with only the three permissions above, and
  registers it with the Actions log masker.
- **Egress.** With a key on the job, `egress: "block"` keeps a compromised
  dependency from sending it anywhere but the hosts listed.
- **Rotation.** Generate a new private key on the App's settings page, update
  `REVIEW_APP_KEY`, then delete the old key there. Nothing in the build changes.

## Troubleshooting

| Symptom                                                                                | Cause and fix                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviews post as `github-actions[bot]`                                                  | The credentials did not reach the job or did not mint. Check the job log for `gh: could not mint the app token (…)` — a `401` means the id or key is wrong or the PEM was pasted incompletely; `is the app installed on …` means step 2 was skipped; `pinned to …` means `.repository(...)` names another repository. |
| Replies land but threads stay open, Notes say `Resource not accessible by integration` | The token lacks `contents: write`: either the App was not granted Contents read and write in step 1, or the build's `.permission(...)` list omits it.                                                                                                                                                                 |
| `@acme-bot review` does nothing                                                        | The commenter is below the command's role floor (push access by default), the comment does not _start_ with the mention, or the author is a bot account. The gate step's log says which; `command: (c) => c.role(...)` or `.users(...)` widens it.                                                                    |
| No 👀 on the command comment                                                           | Issues read and write is missing on the App. Harmless — the review still runs — but it is the one visible sign the command was picked up.                                                                                                                                                                             |
