/**
 * Zuke's own GitHub workflows, declared as targets to run.
 *
 * These live here rather than in `zuke.ts` so the build file stays a list of
 * targets. Each workflow names the targets it invokes and the jobs are derived
 * from the build graph — ids and names from the targets, `needs:` edges from
 * their `dependsOn`, `./zuke <target>` as the command, and a hardened runner and
 * checkout in front of each. The file name comes from the key below, so `ci`
 * writes `.github/workflows/ci.yml`.
 *
 * What is written here is therefore only what the runner decides rather than the
 * build: when to run, which OS matrix, which token scopes, how much egress to
 * permit. Pinned action SHAs come from {@link actionPin}, which reads the root
 * `action.yml` manifest — the file Dependabot bumps and the generator never
 * writes.
 *
 * @module
 */

import { cicd, type CiFile, type TargetBuilder } from "@zuke/core";
import { actionPin } from "./action_pins.ts";

/**
 * The targets the workflows invoke.
 *
 * Structural rather than the build class itself, which would be a circular
 * import — and it doubles as the list of targets CI depends on, so removing one
 * is a compile error here rather than a workflow that runs nothing.
 */
export interface WorkflowTargets {
  /** The full pre-commit gate. */
  ci: TargetBuilder;
  /** The declared-core-floor check, which needs the network. */
  coreFloorCheck: TargetBuilder;
  /** The test suite, run through each platform's launcher. */
  test: TargetBuilder;
  /** release-please: maintains the release PR and cuts releases. */
  release: TargetBuilder;
  /** Cuts the composite action release and proposes its pin. */
  actionRelease: TargetBuilder;
  /** Publishes new package versions to JSR over OIDC. */
  publishJsr: TargetBuilder;
  /** Opens and merges the website documentation sync PR. */
  syncWebsite: TargetBuilder;
  /** The supply-chain scanners. */
  security: TargetBuilder;
  /** Uploads the Scorecard SARIF to code scanning. */
  scorecardSarif: TargetBuilder;
  /** The subprocess e2e suite, on an OS matrix. */
  integration: TargetBuilder;
}

/**
 * The hosts `./zuke ci` legitimately reaches, for the one job that runs build
 * code while holding live secrets and a write-scoped token. Egress is blocked
 * rather than audited there: even if untrusted code in the gate read a token
 * from the environment, it could not POST it anywhere. Each entry is traceable
 * to something the build does — the Deno bootstrap, module resolution (JSR, plus
 * npm for the cspell tooling), the OpenAI API for the lint fixer, GitHub for the
 * fixer's comment and push, and Codecov's CDN, API, and upload bucket.
 */
const GATE_ENDPOINTS = [
  "deno.land:443",
  "dl.deno.land:443",
  "jsr.io:443",
  "registry.npmjs.org:443",
  "api.openai.com:443",
  "api.github.com:443",
  "github.com:443",
  "codeload.github.com:443",
  "objects.githubusercontent.com:443",
  "release-assets.githubusercontent.com:443",
  "cli.codecov.io:443",
  "api.codecov.io:443",
  "ingest.codecov.io:443",
  "storage.googleapis.com:443",
];

/** What the core-floor check needs: the Deno bootstrap, JSR, and GitHub. */
const FLOOR_CHECK_ENDPOINTS = [
  "deno.land:443",
  "dl.deno.land:443",
  "jsr.io:443",
  "github.com:443",
  "api.github.com:443",
  "codeload.github.com:443",
  "objects.githubusercontent.com:443",
  "release-assets.githubusercontent.com:443",
];

/**
 * What a job that pushes a branch and opens a pull request needs. Checked
 * against the hosts a real release run actually contacted, which were
 * `github.com` and `api.github.com`; the rest cover the launcher's bootstrap
 * and module resolution.
 *
 * Used by every job here that holds a write-scoped token. Those jobs block
 * egress rather than audit it, which is the point: a token read out of the
 * environment by anything in the build graph has nowhere to be sent.
 */
const REPO_WRITE_ENDPOINTS = [
  "deno.land:443",
  "dl.deno.land:443",
  "jsr.io:443",
  "registry.npmjs.org:443",
  "api.github.com:443",
  "github.com:443",
  "codeload.github.com:443",
  "objects.githubusercontent.com:443",
  "release-assets.githubusercontent.com:443",
];

/**
 * Declare every GitHub workflow for `targets`, keyed by the file each writes.
 *
 * Assign the result to a single build field: the fields nest, so each entry is
 * discovered as `<field>.<key>` and named from the key.
 */
export function githubWorkflows(
  targets: WorkflowTargets,
): Record<string, CiFile> {
  return {
    ci: cicd({
      pins: actionPin,
      pipeline: {
        name: "CI",
        triggers: {
          // Once per change: `pullRequest` covers every PR branch, `push` the
          // post-merge commit. Both on all branches would double every run.
          push: ["master"],
          pullRequest: [],
          // `edited` on top of the defaults because `prBodyLint` reads the PR
          // description: editing it changes what release-please will parse without
          // pushing a commit, so a stale green status would otherwise let a
          // code-bearing body reach the squash-merge.
          pullRequestTypes: ["opened", "synchronize", "reopened", "edited"],
        },
        concurrency: {
          group: "ci-${{ github.workflow }}-${{ github.ref }}",
          cancelInProgress: true,
        },
      },
      invokes: [
        {
          target: targets.ci,
          name: "Build & verify with Zuke",
          // The lint fixer pushes its fix to the PR branch and comments, so this
          // job needs both scopes. On a fork PR the key is absent, the token is
          // read-only whatever is asked for, and the fixer skips.
          permissions: { contents: "write", "pull-requests": "write" },
          // Runs build code while holding live secrets and a write-scoped token,
          // so block egress rather than audit it: even if untrusted code in the
          // gate read a token, it could not POST it anywhere.
          harden: { egress: "block", allowedEndpoints: GATE_ENDPOINTS },
          checkout: {
            // Keeps the token in git config so the fixer can push, and checks out
            // the head branch rather than the detached merge ref so the push
            // targets it. A fork PR falls back to the default — the fixer cannot
            // and will not push there.
            persistCredentials: true,
            ref:
              "${{ (github.event.pull_request.head.repo.full_name == github.repository) && github.head_ref || '' }}",
          },
          env: {
            OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
            GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
            CODECOV_TOKEN: "${{ secrets.CODECOV_TOKEN }}",
            // Feeds prBodyLint; empty on a push run. It rides through this env map
            // and is never interpolated into a shell line, so an adversarial PR
            // body cannot inject a command.
            PR_BODY:
              "${{ github.event_name == 'pull_request' && github.event.pull_request.body || '' }}",
          },
        },
        {
          target: targets.coreFloorCheck,
          name: "Core version floors",
          // Its own job because it reaches JSR for each published core, which the
          // offline `ci` gate must not. Egress is blocked because this is the one
          // job that resolves modules with `--no-lock`: the generated config
          // carries only `jsr:@zuke/*` specifiers, but that governs the import map
          // and cannot stop a source file in a PR importing an absolute URL that
          // `deno check` would then follow.
          harden: { egress: "block", allowedEndpoints: FLOOR_CHECK_ENDPOINTS },
        },
        {
          target: targets.test,
          name: "Tests (${{ matrix.os }})",
          matrix: { os: ["macos-latest", "windows-latest"] },
          // Let both platforms report: cancelling the sibling hides whether a
          // failure is platform-specific, which is what this job exists to answer.
          failFast: false,
          // No hardening: this job deliberately exercises the user-facing
          // bootstrap launchers, which install a pinned Deno themselves. The token
          // is read-only and no secrets are present.
          harden: false,
          // The launchers are the point, so each OS runs its own rather than the
          // derived command.
          steps: [
            {
              name: "Run tests with the bash launcher",
              if: "runner.os != 'Windows'",
              run: "./zuke test",
              env: { DENO_VERSION: "v2.8.3" },
            },
            {
              name: "Run tests with the PowerShell launcher",
              if: "runner.os == 'Windows'",
              shell: "pwsh",
              run: "./zuke.ps1 test",
            },
          ],
        },
      ],
    }),

    release: cicd({
      pins: actionPin,
      pipeline: {
        name: "Release",
        triggers: { push: ["master"], manual: true },
        // Nothing by default here: each job below opts into exactly what it needs,
        // which is what keeps the JSR credential away from the release scopes.
        permissions: {},
        concurrency: {
          group: "release-${{ github.ref }}",
          cancelInProgress: false,
        },
      },
      invokes: [
        {
          target: targets.release,
          name: "Maintain releases (release-please)",
          // Writes contents and PRs, but must NOT hold the JSR OIDC token.
          permissions: { contents: "write", "pull-requests": "write" },
          timeoutMinutes: 15,
          env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" },
        },
        {
          target: targets.actionRelease,
          name: "Release the composite action",
          // After release-please, so two jobs are never pushing to the same
          // repository at once. It needs nothing release-please produces —
          // the action is versioned on its own tag line — so this is pipeline
          // ordering rather than a build dependency.
          after: [targets.release],
          // Cuts and moves tags, then opens a pull request with the pin: the
          // ruleset on master requires one, so a push would be refused.
          permissions: { contents: "write", "pull-requests": "write" },
          timeoutMinutes: 15,
          // The credential has to survive the checkout for the branch push, and
          // the tags have to be present or every run would read an empty list
          // and try to re-cut v1.0.0 over a tag that exists.
          checkout: { persistCredentials: true, fetchDepth: 0 },
          // Blocked, not audited, for the reason every token-holding job here
          // is: the credential has to survive the checkout so the branch push
          // has one, so bound what could be done with it instead. Anything that
          // read it out of the environment could not send it anywhere.
          harden: { egress: "block", allowedEndpoints: REPO_WRITE_ENDPOINTS },
          env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" },
        },
        {
          target: targets.publishJsr,
          name: "Publish to JSR",
          // Ordered here rather than in the build graph: publishing after
          // release-please is a property of the release *pipeline*, while
          // `./zuke publishJsr` on its own stays meaningful locally.
          after: [targets.release],
          // The only job with `id-token: write`, and it gets no GITHUB_TOKEN and
          // only read access to contents — so the publishing credential is
          // isolated from release-please's write scopes.
          permissions: { contents: "read", "id-token": "write" },
          // Backstop: publishJsr already times out a stalled publish per package.
          timeoutMinutes: 30,
        },
        {
          target: targets.syncWebsite,
          name: "Sync website docs + API reference",
          after: [targets.publishJsr],
          // Explicit even though it is the least this job could have: the
          // workflow-level default is `{}` here, so an omitted job scope means no
          // token at all — and the checkout needs to read the repository.
          permissions: { contents: "read" },
          timeoutMinutes: 15,
          // Blocked because this is the one job that hands build code an app
          // *private key* rather than a token minted from it. A minted token is
          // narrow and expires in an hour; the key mints more of them. Nothing
          // untrusted runs here — this workflow triggers only on a push to master
          // and workflow_dispatch, and fork PRs get no secrets — so this is
          // defence in depth against a compromised dependency in the build graph.
          harden: { egress: "block", allowedEndpoints: REPO_WRITE_ENDPOINTS },
          env: {
            ZUKE_BUILD_APP_ID: "${{ secrets.ZUKE_BUILD_APP_ID }}",
            ZUKE_BUILD_APP_KEY: "${{ secrets.ZUKE_BUILD_APP_KEY }}",
          },
        },
      ],
    }),

    security: cicd({
      pins: actionPin,
      pipeline: {
        name: "Security scanners",
        triggers: {
          push: ["master"],
          pullRequest: [],
          schedule: [{ cron: "42 5 * * 3" }],
        },
        checkout: {
          // Full history so gitleaks scans past commits, not just the tip. That
          // also fetches every branch, which is why the target scopes the scan to
          // the pull request's own commits — otherwise a secret-shaped string on
          // an unrelated branch would fail the scan on every open PR. A push to
          // master and the weekly run still walk the whole history.
          fetchDepth: 0,
        },
      },
      // The scanners come from the build's declared toolchain — pinned,
      // checksum-verified, cached — so there is no install step, and the findings
      // go to the job summary rather than an artifact.
      invokes: [{
        target: targets.security,
        name: "Scan with Zuke (zuke/security)",
      }],
    }),

    scorecard: cicd({
      pins: actionPin,
      pipeline: {
        name: "Scorecard supply-chain",
        triggers: {
          push: ["master"],
          // Re-score when the repository's own protections change.
          branchProtectionRule: true,
          schedule: [{ cron: "18 3 * * 2" }],
        },
      },
      invokes: [{
        target: targets.scorecardSarif,
        name: "OpenSSF Scorecard",
        permissions: {
          // Upload the SARIF to the Security tab, and publish the score to the
          // public Scorecard API.
          "security-events": "write",
          "id-token": "write",
        },
        // The one marketplace action that stays: publishing the public score is
        // something only it can do, and it must run before the target that
        // uploads its output.
        before: [{
          name: "Run Scorecard",
          uses: actionPin("ossf/scorecard-action"),
          with: {
            results_file: "results.sarif",
            results_format: "sarif",
            publish_results: "true",
          },
        }],
        env: { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" },
      }],
    }),

    integration: cicd({
      pins: actionPin,
      pipeline: {
        name: "Integration",
        triggers: {
          push: ["master"],
          pullRequest: [],
          // Weekly with no code change, so a drifting runner image (a new Deno
          // patch release's own transitive npm resolution, an OS image update)
          // surfaces on its own instead of waiting for the next PR.
          schedule: [{ cron: "0 6 * * 1" }],
        },
        concurrency: {
          group: "integration-${{ github.ref }}",
          cancelInProgress: true,
        },
      },
      invokes: [{
        target: targets.integration,
        id: "e2e",
        name: "E2E (${{ matrix.os }})",
        matrix: { os: ["ubuntu-latest", "macos-latest", "windows-latest"] },
        // Deno rather than the ./zuke launcher: a generated step has no per-OS
        // shell to switch on, and `deno` is identical everywhere. Pinned to the
        // version the launchers bootstrap, so this runs the exact Deno the repo
        // is reproducible against rather than a floating `v2.x`. It rides in the
        // prelude action, which installs it — so this job's opening is one step
        // like every other, and `setup-deno`'s pin lives in `action.yml` with
        // the rest rather than being named here.
        bootstrap: { denoVersion: "v2.8.3" },
        // Runs `deno` directly for the same reason. `--frozen` fails the run if
        // the e2e suite's resolution would diverge from the committed lock.
        steps: [{
          name: "Run the subprocess e2e suite",
          run: "deno run -A --frozen zuke.ts integration",
        }],
      }],
    }),
  };
}
