/**
 * Zuke's own build, authored with Zuke — the project builds itself.
 *
 * Every CI and release step is a target here, so the GitHub workflows collapse
 * to `deno task zuke <target>` invocations (equivalently
 * `deno run -A zuke.ts <target>`):
 *
 *   deno task zuke ci        # fmt → lint → spell → check → test → coverage gate
 *   deno task zuke test      # type-check, then run the suite with coverage
 *   deno task zuke release   # release-please: maintain release PRs & releases
 *   deno task zuke publish   # publish new package versions to JSR, core first
 *   deno task zuke --list    # show every target
 *
 * The reusable helpers behind these targets live in `./build/*.ts`; this file
 * is just the build definition (the `ZukeBuild` class) plus `run()`.
 */

import {
  type AbsolutePath,
  appendJobSummary,
  Build,
  FileTasks,
  glob,
  parameter,
  repoRoot,
  run,
  target,
  toolchain,
} from "@zuke/core";
import { GitTasks } from "@zuke/git";
import { GhTasks } from "@zuke/gh";
import { consoleRenderer, ConsoleTasks } from "@zuke/console";
import {
  aiFixer,
  aiReviewWorkflow,
  genericReviewer,
  securityReviewer,
  suppressions,
} from "@zuke/ai";
import { DenoTasks } from "@zuke/deno";
import { CspellTasks } from "@zuke/cspell";
import { CodecovTasks } from "@zuke/codecov";
import { isPublished } from "@zuke/jsr";
import {
  type ReleasePleaseGithubReleaseSettings,
  type ReleasePleaseReleasePrSettings,
  ReleasePleaseTasks,
} from "@zuke/release-please";
import { SecurityTasks } from "@zuke/security";
import { DocsTasks } from "@zuke/docs";
import { ACTION_VERSION_FILE, releaseAction } from "./build/action_release.ts";
import { localVersion, PACKAGES } from "./build/packages.ts";
import {
  CODECOV_CLI_VERSION,
  installCli,
  publishOne,
  publishPackage,
  TOOLS_ROOT,
} from "./build/publish.ts";
import {
  collectDocLintReports,
  collectPackageDocs,
  docsOptions,
} from "./build/docs.ts";
import { writeApiJson } from "./build/api_reference.ts";
import { runWebsiteSync } from "./build/website_sync.ts";
import {
  gitleaksSummary,
  parseGitleaksReport,
} from "./build/gitleaks_report.ts";
import { checkSnippets, formatSnippetFailures } from "./build/snippets.ts";
import { checkHclWrappers, generateHclWrappers } from "./build/hcl_gen.ts";
import { lintPrBody } from "./build/pr_body_lint.ts";
import { assertLockUnchanged } from "./build/lock_check.ts";
import { checkCoreFloors, formatFloorFailures } from "./build/core_floor.ts";
import {
  checkPluginSkillsSync,
  syncPluginSkills,
} from "./build/plugin_sync.ts";
import { actionPin } from "./build/action_pins.ts";
import { actionlintTool, gitleaksTool, zizmorTool } from "./build/scanners.ts";
import { githubWorkflows } from "./build/workflows.ts";

/**
 * Where the `security` target writes gitleaks' findings. The security workflow
 * uploads this path as an artifact, so the two must agree; it is git-ignored
 * because a local `./zuke security` writes it too.
 */
const GITLEAKS_REPORT = "gitleaks-report.json";

class ZukeBuild extends Build {
  clean = target()
    .description("Remove build artifacts")
    .executes(async () => {
      await FileTasks.remove("dist", { recursive: true });
    });

  restore = target()
    .description("Warm the module cache")
    .executes(async () => {
      const mods = PACKAGES.map((p) => `packages/${p}/mod.ts`);
      // Frozen so warming the cache can never *heal* a stale `deno.lock` by
      // writing the resolutions it is missing. These entrypoints reach a wider
      // module graph than loading `zuke.ts` does, so this covers a dependency
      // that only a package's `mod.ts` pulls in. The outer `deno run` that
      // loads this file is frozen too — see the launchers and the root tasks —
      // which is what stops the lock being rewritten before the build starts.
      await DenoTasks.cache((s) => s.frozen().paths(...mods));
    });

  format = target()
    .description("Check formatting (deno fmt --check)")
    .executes(async () => {
      await DenoTasks.fmt((s) => s.check());
    });

  // The OpenAI key (org secret OPENAI_API_KEY) is shared by the AI security
  // review below and the lint self-healing fixer here. Declared above `lint`
  // because a target field can only reference siblings declared above it.
  openaiKey = parameter("OpenAI API key for the AI review and lint fixer")
    .secret()
    .env("OPENAI_API_KEY");

  lint = target()
    .description("Lint the workspace (deno lint)")
    // Self-heal lint failures with @zuke/ai, dogfooding the full loop: on a
    // failing `deno lint` the fixer applies the fix, commits and pushes it to
    // the PR branch, re-runs lint to verify, and — because it auto-fixed —
    // posts an overview comment of what it changed (with the code) plus the job
    // summary. A missing key (e.g. local runs, or fork PRs where the secret is
    // withheld) is skipped cleanly and the lint failure still stands. The CI
    // workflow grants this job `contents: write` so the push can land.
    .recoverWith(
      aiFixer((f) =>
        f
          .provider("openai")
          .apiKey(this.openaiKey)
          .autoApply()
          .allowCI()
          .commitFixes()
          .allowPaths("packages/**", "tests/**", "zuke.ts")
          // Fetch the PR base branch itself (auto-detected from the CI env) for
          // diff context — no manual `git fetch` step in the workflow.
          .diff((d) => d.fetchBase())
      ),
    )
    .executes(async () => {
      await DenoTasks.lint();
    });

  spell = target()
    .description("Spell-check the repository (cspell)")
    .executes(async () => {
      const cspell = await installCli(
        "npm:cspell@9",
        "cspell",
        (s) => s.allow("read").allow("env").allow("sys"),
      );
      await CspellTasks.lint((s) =>
        s.toolPath(cspell).files("**").noProgress()
      );
    });

  check = target()
    .description("Type-check the whole workspace")
    .dependsOn(this.restore)
    .executes(async () => {
      await DenoTasks.task((s) => s.name("check"));
    });

  test = target()
    .description("Run the test suite with coverage")
    .dependsOn(this.check)
    .executes(async () => {
      // Blank GITHUB_STEP_SUMMARY for the test subprocess: tests that exercise
      // the job-summary and AI-reviewer/fixer code paths would otherwise append
      // to the real Actions summary, polluting it. The parent `./zuke ci` run
      // keeps the env var and still writes the build table and any fixer section.
      await DenoTasks.test((s) =>
        s.allowAll().coverage("cov_profile").frozen().env({
          GITHUB_STEP_SUMMARY: "",
        })
      );
    });

  // The subprocess e2e suite (tests/e2e/), kept OUT of `test`/`ci` so the fast
  // gate stays hermetic and quick. These tests spawn real `deno` processes to
  // exercise what an in-process test cannot — genuine inter-process races (e.g.
  // exactly-once resume). Their files are named `*_e2e.ts` so the default test
  // discovery skips them; this target runs them by explicit path. The dedicated
  // `integration.yml` workflow (declared below) runs this on an OS matrix, where
  // Windows filesystem-lock semantics get real coverage.
  integration = target()
    .description("Run the subprocess e2e suite (real processes, OS matrix)")
    .executes(async () => {
      // Discovered by glob (sorted, so run order stays deterministic) rather
      // than a hardcoded list — a new `*_e2e.ts` file is picked up on its own
      // instead of silently running nowhere until someone remembers to add it
      // here.
      const paths = await glob("tests/e2e/*_e2e.ts");
      // Blank GITHUB_STEP_SUMMARY for the suite, as the `test` target does.
      // These fixtures are whole builds run as real subprocesses, so each one
      // appends its own result table to the Actions summary — including the
      // ones that are *meant* to fail or suspend (a target reaped by a timeout,
      // a `waitsFor` gate that never opens). The job then displays a red,
      // half-finished build table while passing, which reads as a broken suite
      // and buries the one table that describes the actual run.
      await DenoTasks.test((s) =>
        s.allowAll().paths(...paths).env({ GITHUB_STEP_SUMMARY: "" })
      );
    });

  coverage = target()
    .description("Enforce the 95% coverage gate")
    .dependsOn(this.test)
    .executes(async () => {
      // A 95% aggregate gate, plus a per-file floor so a wholly-untested file or
      // package can't hide inside the average. The floor (50%) sits well below
      // the current lowest src file (~82%), so it flags only a genuinely
      // neglected file rather than churning on the existing spread.
      await DenoTasks.coverage((s) =>
        s.dir("cov_profile").exclude("tests/").output("cov.lcov")
          .threshold(95).perFileThreshold(50)
      );
    });

  // The Codecov upload token, as a masked secret build input. `.secret()` makes
  // Zuke emit a `::add-mask::` for the value, so it never leaks into CI logs.
  // It is optional: absent on local runs and fork PRs, where the upload skips.
  codecovToken = parameter("Codecov upload token")
    .secret()
    .env("CODECOV_TOKEN");

  // The build's external CLIs, declared with `toolchain()` so the build file
  // describes the environment it needs — dogfooding the toolchain provisioner.
  // `install()` fetches each on demand (concurrently), caches it, and returns
  // its path for a wrapper's `.toolPath(...)`. Codecov publishes a rolling
  // artifact per version, so no `checksum` is pinned here; when a tool ships a
  // stable per-platform hash, add
  // `.checksum(({ os, arch }) => sums[`${os}-${arch}`])` to verify and cache it
  // (see docs/installing-tools.md).
  tools = toolchain((t) =>
    t.tool((s) =>
      s
        .name("codecov")
        .destDir(TOOLS_ROOT)
        // Codecov ships a standalone CLI binary per platform, on its own CDN.
        // Its directory names (macos/linux/windows) are exactly Zuke's `os`.
        .url((p) =>
          `https://cli.codecov.io/${CODECOV_CLI_VERSION}/${p.os}/codecov${
            p.os === "windows" ? ".exe" : ""
          }`
        )
    )
      // The three scanners the `security` target drives, pinned and
      // checksum-verified in build/scanners.ts. Declaring them here is what
      // lets the security workflow drop its install step — and what makes
      // `./zuke security` runnable on a laptop with nothing installed.
      .tool((s) => zizmorTool(s).destDir(TOOLS_ROOT))
      .tool((s) => actionlintTool(s).destDir(TOOLS_ROOT))
      .tool((s) => gitleaksTool(s).destDir(TOOLS_ROOT))
  );

  // Publish the coverage report to Codecov, dogfooding @zuke/codecov. True to
  // Zuke's model, the build owns its own tooling: it provisions the Codecov CLI
  // from the `tools` toolchain above (no global install, no extra CI step) and
  // points the wrapper at it. Depends on `coverage`, so it has a fresh
  // `cov.lcov`. Skips with a message when the token is absent (local, fork PRs).
  coverageUpload = target()
    .description("Upload the coverage report to Codecov")
    .dependsOn(this.coverage)
    .executes(async () => {
      const token = this.codecovToken.value;
      if (token === undefined || token === "") {
        ConsoleTasks.warn(
          "CODECOV_TOKEN not set — skipping the Codecov upload.",
        );
        return;
      }
      // Provision the CLI from the declared toolchain (fetched on demand).
      const bin = (await this.tools.install()).get("codecov");
      if (bin === undefined) {
        throw new Error("codecov was not provisioned by the toolchain.");
      }
      // The token rides through the masked `.env(...)` chainer, never argv;
      // fail-on-error makes a failed upload loud.
      await CodecovTasks.upload((s) =>
        s
          .toolPath(bin)
          .files("cov.lcov")
          .slug("zuke-build/zuke")
          .failOnError()
          .env({ CODECOV_TOKEN: token })
      );
    });

  apiDocs = target()
    .description(
      "Generate agent-readable API docs (llms.txt, llms-full.txt, READMEs)",
    )
    .executes(async () => {
      const written = await DocsTasks.apiDocs(
        await collectPackageDocs(),
        docsOptions(this),
      );
      ConsoleTasks.info(
        written.length === 0
          ? "API docs already up to date."
          : `Regenerated ${written.length} file(s):\n  ${written.join("\n  ")}`,
      );
    });

  apiDocsCheck = target()
    .description("Verify the generated API docs are current")
    .executes(async () => {
      const stale = await DocsTasks.checkApiDocs(
        await collectPackageDocs(),
        docsOptions(this),
      );
      if (stale.length > 0) {
        throw new Error(
          `API docs are out of date:\n  ${stale.join("\n  ")}\n` +
            "Run `./zuke apiDocs` and commit the result.",
        );
      }
    });

  apiReference = target()
    .description(
      "Generate the structured API reference (dist/api.json) for the website",
    )
    .executes(async () => {
      const reference = await writeApiJson();
      ConsoleTasks.info(
        `Wrote dist/api.json (${reference.packages.length} packages).`,
      );
    });

  syncWebsite = target()
    .description(
      "Open and merge a website PR with refreshed llms.txt + api.json",
    )
    .executes(async () => {
      await runWebsiteSync(this);
    });

  docLint = target()
    .description(
      "Fail on missing JSDoc or first-party private-type refs (deno doc --lint)",
    )
    .executes(async () => {
      const violations = DocsTasks.checkDocLint(await collectDocLintReports());
      if (violations.length > 0) {
        const lines = violations.map(
          (v) => `  ${v.pkg}: [${v.kind}] ${v.message}`,
        );
        throw new Error(
          `Documentation lint found ${violations.length} issue(s):\n` +
            `${lines.join("\n")}\n` +
            "Export the referenced first-party type, or add the missing JSDoc.",
        );
      }
      ConsoleTasks.info("Documentation lint clean.");
    });

  snippetsCheck = target()
    .description("Type-check the marked ts snippets in docs and skills")
    .executes(async () => {
      // Opt-in: only `<!-- check -->`-marked ```ts blocks are checked (the rest
      // of the corpus is intentionally-elided prose). Snippets resolve `@zuke/…`
      // against the local workspace, so the gate holds every checkable example
      // to the real API — never a published version that could drift.
      const files = [
        ...await glob("docs/*.md"),
        ...await glob("skills/**/*.md"),
      ];
      const failures = await checkSnippets(files);
      if (failures.length > 0) {
        throw new Error(formatSnippetFailures(failures));
      }
      ConsoleTasks.info("Doc snippets type-check clean.");
    });

  hclGen = target()
    .description("Regenerate the Terraform/OpenTofu wrappers from one template")
    .executes(async () => {
      const written = await generateHclWrappers();
      ConsoleTasks.info(
        `Regenerated ${written.length} wrapper(s):\n  ${written.join("\n  ")}`,
      );
    });

  hclSyncCheck = target()
    .description("Verify the Terraform/OpenTofu wrappers match their template")
    .executes(async () => {
      const stale = await checkHclWrappers();
      if (stale.length > 0) {
        throw new Error(
          `Terraform/OpenTofu wrappers are out of date:\n  ${
            stale.join("\n  ")
          }\n` +
            "Run `./zuke hclGen` and commit the result (edit " +
            "internal/hcl_tool.ts.tmpl, not the generated package files).",
        );
      }
      ConsoleTasks.info("Terraform/OpenTofu wrappers are in sync.");
    });

  pluginSync = target()
    .description(
      "Sync plugins/zuke/skills/ from skills/ (real copies, not a symlink)",
    )
    .executes(async () => {
      const written = await syncPluginSkills();
      ConsoleTasks.info(
        `Synced ${written.length} file(s):\n  ${written.join("\n  ")}`,
      );
    });

  pluginSyncCheck = target()
    .description("Verify plugins/zuke/skills/ matches skills/ (no drift)")
    .executes(async () => {
      const stale = await checkPluginSkillsSync();
      if (stale.length > 0) {
        throw new Error(
          `plugins/zuke/skills/ has drifted from skills/:\n  ${
            stale.join("\n  ")
          }\n` +
            "Run `./zuke pluginSync` and commit the result.",
        );
      }
      ConsoleTasks.info("plugins/zuke/skills/ is in sync with skills/.");
    });

  // Only meaningful on a `pull_request`-triggered run (the workflow passes it
  // via env from `github.event.pull_request.body` — never interpolated into
  // a shell line, so an adversarial PR body can't inject a command). Unset
  // locally and empty on a `push` run, where `prBodyLint` is then a no-op.
  prBody = parameter(
    "Pull request body to lint for code fragments that break release-please's parser",
  )
    .env("PR_BODY");

  prBodyLint = target()
    .description(
      "Fail if the PR body has code release-please's parser can't handle",
    )
    .executes(() => {
      const body = this.prBody.value;
      // The workflow sets PR_BODY to "" on a non-`pull_request` run (a GitHub
      // Actions `env:` value can't be conditionally absent), so treat an
      // empty body the same as an unset one.
      if (body === undefined || body === "") {
        ConsoleTasks.info("No PR body to lint (not a pull_request run).");
        return;
      }
      const findings = lintPrBody(body);
      if (findings.length > 0) {
        throw new Error(
          `The PR body has ${findings.length} issue(s) release-please's ` +
            `parser can choke on and silently drop from the release:\n  ${
              findings.join("\n  ")
            }\n` +
            "Describe the change in prose; see RELEASING.md.",
        );
      }
      ConsoleTasks.info("PR body is clean.");
    });

  coreFloorCheck = target()
    .description(
      "Type-check every package against the @zuke/core version it declares",
    )
    .executes(async () => {
      // Deliberately not part of `ci`: this reaches JSR for the published core,
      // and the gate must stay runnable offline.
      const results = await checkCoreFloors(PACKAGES);
      const failures = formatFloorFailures(results);
      if (failures.length > 0) throw new Error(failures.join("\n"));
      ConsoleTasks.info(
        `${results.length} package(s) type-check against their declared ` +
          `@zuke/core floor.`,
      );
    });

  lockCheck = target()
    .description("Verify the run did not rewrite deno.lock")
    // Soft-ordered last: it reports what the whole run did to the lock, so
    // every step that resolves modules must already have run. A `dependsOn`
    // would be a lie — it needs nothing these produce, only their side effects.
    .after(this.coverage, this.apiDocsCheck, this.prBodyLint)
    .executes(async () => {
      const verdict = await assertLockUnchanged();
      ConsoleTasks.info(
        verdict.checked
          ? "deno.lock is unchanged."
          : `Skipped the deno.lock check — ${verdict.reason}.`,
      );
    });

  // Supply-chain scanning, dogfooding @zuke/security. The scanners come from
  // the `tools` toolchain above — pinned, checksum-verified, and cached — so
  // this target needs nothing on PATH and the workflow needs no install step.
  // Every scanner runs (noThrow) so one finding doesn't mask the rest, then the
  // target fails if any reported issues.
  security = target()
    .description("Run supply-chain security scanners (zuke/security)")
    .executes(async () => {
      const failures: string[] = [];
      const gate = async (name: string, output: Promise<{ code: number }>) => {
        const { code } = await output;
        if (code !== 0) failures.push(`${name} (exit ${code})`);
      };
      const installed = await this.tools.install();
      const scanner = (name: string): AbsolutePath => {
        const bin = installed.get(name);
        if (bin === undefined) {
          throw new Error(`${name} was not provisioned by the toolchain.`);
        }
        return bin;
      };
      await gate(
        "zizmor",
        // `action.yml` as well as the workflows: the root composite action is
        // audited by the same rules and is *more* exposed, since another
        // repository can consume it. Scoping the scan to the workflow directory
        // let a template injection in it reach CI — the finding that added this
        // path.
        SecurityTasks.zizmor((s) =>
          s.toolPath(scanner("zizmor"))
            .paths(".github/workflows", "action.yml")
            .noThrow()
        ),
      );
      await gate(
        "actionlint",
        SecurityTasks.actionlint((s) =>
          s.toolPath(scanner("actionlint")).noThrow()
        ),
      );
      // `gitleaks detect` walks the history reachable from every ref in the
      // checkout, and the security workflow fetches all of them — so without a
      // range, one secret-shaped string on any branch fails the scan on every
      // open pull request, blaming whichever one is looked at. On a pull request
      // (`GITHUB_BASE_REF` is set only there) the scan is scoped to the commits
      // under review; a push to the default branch and the weekly schedule still
      // walk the whole history, so nothing stops being covered.
      const prBase = Deno.env.get("GITHUB_BASE_REF");
      // The report stays redacted — it carries the file, line, rule and
      // fingerprint of each finding but not the secret itself, which is what
      // makes a failure diagnosable from the uploaded artifact instead of only
      // from a bare count in the log.
      await gate(
        "gitleaks",
        SecurityTasks.gitleaks((s) => {
          const settings = s.toolPath(scanner("gitleaks")).source(".").redact()
            .reportFormat("json").reportPath(GITLEAKS_REPORT).noThrow();
          return prBase === undefined || prBase === ""
            ? settings
            : settings.logOpts(`origin/${prBase}..HEAD`);
        }),
      );
      // osv-scanner is omitted here: it has no extractor for Deno's lockfile.
      // The @zuke/security wrapper still ships it for projects with npm/cargo/
      // go/etc. lockfiles it does understand.
      //
      // Publish the redacted findings to the job summary. This replaced the
      // workflow's `upload-artifact` step: the artifact existed only so a
      // failure was diagnosable (the log carries a bare count), and the summary
      // carries the same file/line/rule/fingerprint with no step, no retention
      // window, and no download.
      const report = await FileTasks.exists(GITLEAKS_REPORT)
        ? await FileTasks.readText(GITLEAKS_REPORT)
        : "";
      const summary = gitleaksSummary(parseGitleaksReport(report));
      if (summary !== null) appendJobSummary(summary);
      if (failures.length > 0) {
        throw new Error(
          `Security scan reported issues: ${failures.join("; ")}`,
        );
      }
    });

  ci = target()
    .description("Full pre-commit / CI gate")
    .dependsOn(
      this.format,
      this.lint,
      this.spell,
      this.coverage,
      this.coverageUpload,
      this.apiDocsCheck,
      this.docLint,
      this.snippetsCheck,
      this.hclSyncCheck,
      this.pluginSyncCheck,
      this.prBodyLint,
      // In the gate now that the scanners are provisioned by the `tools`
      // toolchain rather than assumed on PATH — the reason it used to be
      // excluded. The dedicated security workflow still runs it separately,
      // where a full-depth checkout lets gitleaks walk the whole history.
      this.security,
      // Last: it asserts what the whole run did to the lock, so anything that
      // rewrites it must already have run.
      this.lockCheck,
    )
    .executes(() => {});

  // Publish the OpenSSF Scorecard run's SARIF to code scanning, dogfooding
  // @zuke/gh's `uploadSarif`. This replaced two steps in scorecard.yml — the
  // `upload-artifact` and the `codeql-action/upload-sarif` — with one target;
  // the scorecard action itself stays, because publishing the public score
  // (`publish_results`) is something only it can do.
  scorecardSarif = target()
    .description("Upload the Scorecard SARIF to GitHub code scanning")
    .executes(async () => {
      const report = "results.sarif";
      if (!await FileTasks.exists(report)) {
        throw new Error(
          `${report} is missing — run the scorecard step before this target.`,
        );
      }
      const { url } = await GhTasks.uploadSarif((s) => s.file(report));
      ConsoleTasks.success(`Uploaded ${report} to code scanning (${url}).`);
    });

  // Dogfood @zuke/ai: two reviewers on different providers gate the `review`
  // target — an OpenAI security scan and a Gemini code-quality review. The keys
  // are org secrets (OPENAI_API_KEY / GEMINI_API_KEY) available in Actions;
  // `skipIfKeyMissing()` skips a review (announcing it on the console and in the
  // summary) when its key is absent, e.g. on local runs. `onError("warn")` keeps
  // an API hiccup from breaking the build, and each assessment lands in the job
  // summary and as a PR comment. The `openaiKey` parameter is declared above,
  // beside the `lint` target that shares it.
  securityReview = securityReviewer((r) =>
    r
      .provider("openai")
      .apiKey(this.openaiKey)
      .skipIfKeyMissing()
      .comment() // upsert the assessment onto the PR (uses GITHUB_TOKEN)
      .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/master"))
      .maxDiffTokens(20000)
      // Dismissed false positives, kept auditable under "Suppressed": a build's
      // own readiness probe / tcpReachable run build-author code that connects
      // to an address the author typed — no more capability than any other line
      // in the build file, and no untrusted input. `1xwg7am` is AlreadyResumedError
      // naming the `--actor` that won a resume race — operator attribution by
      // design (like LockConflictError naming the holder), not a secret leak.
      // `3f7a0g` is `zuke runs`, a local read-only inspect of an operator-owned
      // store of non-secret records — the FS/HTTP layer already owns access;
      // agent/network authz is the M5 MCP surface. `z2fmcx` is a forEach item
      // key in a sub-target name: keys are author-chosen identifiers (console
      // output is redacted; secrets belong in excluded `.secret()` params), as
      // documented in docs/orchestration.md. `1ownw8s` is a false positive —
      // signal_run/resume_check DO enforce the operator token (runtools.ts
      // gates on deps.authorize → #authorizeTarget → #checkOperatorToken, with
      // tests). `1eav335` is by design: list_runs/show_run are read-only over
      // non-secret records, "always exposed when a store resolves" per M5, and
      // gated by the transport's auth. (IDs are opaque fingerprints.)
      // `3ud7i3zbigfl0` is a false positive: a static, author-written workflow
      // comment documenting the website-sync job — it does not execute and
      // feeds no runtime model, so there is no prompt-injection surface.
      // `pm3oldslqkyj` and `io22vnfjvb1t` are two phrasings of one false
      // positive on the `jsr:@zuke/core@^1` pin in the `import` scaffold: it
      // cannot "pull in future major releases" (`^1` is `>=1.0.0 <2.0.0`, so a
      // 2.0.0 never satisfies it) and it cannot "bypass lockfile pinning" (a
      // range in a source file is resolved *through* the consumer's lock). The
      // line replaced an unpinned specifier that did resolve any future major,
      // so the change narrows exposure rather than widening it.
      // `3bja5rj1xp93t` — dropping `@zuke/tsgo` with no in-repo shim — is a
      // deliberate decision, not an oversight: JSR versions are immutable, so
      // `@zuke/tsgo@0.1.3` keeps resolving for anyone pinned to it, and a shim
      // package would have to carry its own semver promise for a wrapper that
      // duplicated `TscSettings`. The migration is documented in the root
      // CHANGELOG; the residual cost is that the package's JSR page keeps its
      // last-published README.
      // `27b6343dtit6d`, `22uhzbksic6rf`, `trsbgqqlurzb` and `3u2ilv23j9jb2`
      // all say the automated website merge removes the approval on that repo.
      // They are right that it does — an earlier answer here claimed the repo's
      // default branch was unprotected and the token could already write to it
      // directly, which was wrong: protection lives in a *ruleset* (invisible
      // to the branch-protection API), and it required an approving review.
      // They are suppressed because the gate was replaced, not deleted: that
      // ruleset now requires the website's own `Build the site` check instead
      // of an approval, and the sync merges with `--auto`, so a PR lands only
      // when that build accepts the artifacts. The trade and its limits are
      // written next to the job in release.yml.
      // `3lk27fag8hqxu` additionally claims release.yml "now grants" the sync
      // job new ability — false about the diff: `permissions:` and every
      // `permission-*` input are byte-identical; only comments and a step name
      // changed.
      // cspell:ignore myee fmcx ownw eav zbigfl oldslqkyj vnfjvb bja rj xp dtit
      // cspell:ignore uhzbksic lk fag hqxu trsbgqqlurzb ilv
      .suppress(
        suppressions((s) =>
          s.add(
            "1g3myee",
            "1mwn3kn",
            "1xwg7am",
            "3f7a0g",
            "z2fmcx",
            "1ownw8s",
            "1eav335",
            "3ud7i3zbigfl0",
            "pm3oldslqkyj",
            "io22vnfjvb1t",
            "3bja5rj1xp93t",
            "27b6343dtit6d",
            "22uhzbksic6rf",
            "3lk27fag8hqxu",
            "trsbgqqlurzb",
            "3u2ilv23j9jb2",
          )
        ),
      )
      .failWhen((g) => g.scoreAbove(8))
      .onError("warn")
  );

  // A second reviewer on a different provider (Gemini), to showcase two AI
  // providers gating the same target. This one is a general code-quality review
  // with explicit criteria rather than a security scan.
  geminiKey = parameter("Gemini API key for the AI code-quality review")
    .secret()
    .env("GEMINI_API_KEY");

  generalReview = genericReviewer((r) =>
    r
      .provider("gemini")
      .apiKey(this.geminiKey)
      .skipIfKeyMissing()
      .comment() // a separate PR comment, keyed by the reviewer name
      // The built-in rubric already covers clarity, cohesion, tests, and docs;
      // `.criteria(...)` adds just the project-specific conventions on top.
      .criteria(
        "This is a strict, dependency-free TypeScript codebase on Deno: no " +
          "`any`, no `as` or non-null assertions, and the public API is shaped " +
          "as namespaced `*Tasks` objects rather than loose exported functions.",
      )
      .diff((d) => d.base(Deno.env.get("ZUKE_REVIEW_BASE") ?? "origin/master"))
      .maxDiffTokens(20000)
      .failWhen((g) => g.scoreAbove(8))
      .onError("warn")
  );

  // The reviewers diff against `origin/master`, which a shallow pull-request
  // checkout does not have — so the base has to be fetched first. This used to
  // be a `git fetch` step in ai-review.yml; as a target it works the same way
  // locally. The refspec updates the remote-tracking ref, so the reviewers'
  // default base resolves and no `ZUKE_REVIEW_BASE` env is needed.
  reviewBase = target()
    .description("Fetch the base branch the AI review diffs against")
    .executes(async () => {
      const { code } = await GitTasks.fetch((s) =>
        s
          .remote("origin")
          // Forced (`+`): with `--depth=1` the fetched commit is not a
          // fast-forward of whatever shallow `origin/master` the checkout
          // already has, and git refuses such an update without it — which
          // would leave the review diffing against a stale base.
          .refspec("+master:refs/remotes/origin/master")
          .noTags()
          .depth(1)
          .noThrow()
          .quiet()
      );
      ConsoleTasks.info(
        code === 0
          ? "Fetched origin/master for the review diff."
          : `Could not fetch origin/master (exit ${code}) — the review will ` +
            "diff against whatever base is already present.",
      );
    });

  review = target()
    .description("AI review of the diff (security + code quality)")
    .dependsOn(this.reviewBase)
    .validateBefore(this.securityReview, this.generalReview)
    .executes(() => {});

  // Generate `.github/workflows/ai-review.yml` from the reviewers above —
  // their key env vars become the workflow's `env:` block, and `.comment()`
  // on either pulls in `pull-requests: write` and `GITHUB_TOKEN`. The
  // committed YAML is regenerated whenever the build runs, and CI verifies
  // it is current.
  aiReviewYaml = aiReviewWorkflow({
    reviewers: [this.securityReview, this.generalReview],
    // No fetch step: the `review` target depends on `reviewBase`, which fetches
    // the base itself — so the same command works locally, where no workflow
    // step exists to do it.
    fetchBase: false,
    // Pins from the committed workflows rather than @zuke/ai's own constants.
    // Without this the file is the one generated workflow whose SHA comes from a
    // published package: a Dependabot bump lands in ai-review.yml, the next run
    // regenerates it from the stale constant, and the bump is reverted. That has
    // already happened once here — the constant had to be hand-updated to match
    // what Dependabot set.
    hardenRunner: actionPin("step-security/harden-runner").ref,
    checkout: actionPin("actions/checkout").ref,
  });

  release = target()
    .description("Maintain release PRs and GitHub releases (release-please)")
    .executes(async () => {
      const token = Deno.env.get("GITHUB_TOKEN");
      const repo = Deno.env.get("GITHUB_REPOSITORY");
      if (token === undefined || repo === undefined) {
        throw new Error(
          "release requires GITHUB_TOKEN and GITHUB_REPOSITORY in the env.",
        );
      }
      const bin = await installCli(
        "npm:release-please@16.18.0",
        "release-please",
        (s) => s.allowAll(),
      );
      // Both subcommands take the same connection/config flags. Apply them with
      // a settings object already narrowed to its concrete type at each call.
      const apply = (
        s: ReleasePleaseReleasePrSettings | ReleasePleaseGithubReleaseSettings,
      ) =>
        s
          .toolPath(bin)
          .token(token)
          .repoUrl(repo)
          .targetBranch("master")
          .configFile(".release-please-config.json")
          .manifestFile(".release-please-manifest.json");
      await ReleasePleaseTasks.releasePr((s) => {
        apply(s);
        return s;
      });
      await ReleasePleaseTasks.githubRelease((s) => {
        apply(s);
        return s;
      });
    });

  actionRelease = target()
    .description("Tag a new version of the Marketplace action when it changed")
    .executes(async () => {
      const result = await releaseAction({
        state: async () => {
          const branch = await GitTasks.run((s) =>
            s.command("symbolic-ref", "--quiet", "--short", "HEAD").noThrow()
          );
          const status = await GitTasks.run((s) =>
            s.command("status", "--porcelain")
          );
          // `@{u}` is the tracked upstream. `rev-list --count` of the symmetric
          // difference is 0 only when the two are the same commit; a missing
          // upstream exits non-zero, which counts as out of sync rather than
          // in it.
          const divergence = await GitTasks.run((s) =>
            s.command("rev-list", "--count", "HEAD...@{u}").noThrow()
          );
          return {
            branch: branch.code === 0 ? branch.text() : undefined,
            dirty: status.text() !== "",
            syncedWithRemote: divergence.code === 0 &&
              divergence.text() === "0",
          };
        },
        tags: async () => {
          // The tags a shallow CI checkout has are whatever it fetched, which
          // is none — and an empty list reads as "no release yet", which would
          // re-cut v1.0.0 over a tag that exists.
          await GitTasks.fetch((s) => s.remote("origin").tags().quiet());
          const { stdout } = await GitTasks.run((s) =>
            s.command("tag", "--list")
          );
          return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
        },
        changedSince: async (ref) => {
          // `--quiet` makes the exit code the answer: 0 identical, 1 differ.
          // Anything else is git failing (an unknown ref exits 128), and that
          // must not read as "changed" — failing open here would cut a release
          // on every run whose tag lookup broke.
          const { code } = await GitTasks.run((s) =>
            s
              .command("diff", "--quiet", ref, "HEAD", "--", "action.yml")
              .noThrow()
          );
          if (code === 0) return false;
          if (code === 1) return true;
          throw new Error(
            `could not diff action.yml against ${ref} (git exited ${code}). ` +
              `Refusing to guess: treating this as a change would cut a ` +
              `release, and every run with the same fault would cut another.`,
          );
        },
        headSha: async () =>
          (await GitTasks.run((s) => s.command("rev-parse", "HEAD"))).text(),
        tag: async (name, message, force) => {
          await GitTasks.tag((s) => {
            const settings = s.name(name).message(message);
            return force ? settings.force() : settings;
          });
        },
        push: async (name, force) => {
          // `--force-with-lease` is the typed option, and it is the wrong one
          // here: a tag has no remote-tracking ref for git to compare against,
          // so the lease has nothing to check and the push is refused as stale.
          // Moving `v1` is a deliberate overwrite of a ref only this target
          // writes, so a plain force is what the operation actually is.
          await GitTasks.run((s) =>
            force
              ? s.command("push", "--force", "origin", name)
              : s.command("push", "origin", name)
          );
        },
        writePin: async (pin) => {
          await FileTasks.writeText(
            repoRoot(ACTION_VERSION_FILE),
            `${JSON.stringify(pin, null, 2)}\n`,
          );
        },
        info: ConsoleTasks.info,
      });
      if (result.released === undefined) return;
      // The workflows reference the action at the pin that just changed, so
      // they are now stale — and the gate's `generate-ci --check` would fail on
      // that drift rather than heal it. Regeneration has to happen in a *fresh*
      // process: `build/workflows.ts` reads the pin while this build's fields
      // initialise, so this one is still holding the old value.
      await DenoTasks.run((s) =>
        s.allowAll().frozen().script("zuke.ts").scriptArgs("generate-ci")
      );
      ConsoleTasks.info(
        `Regenerated the workflows against ${result.released}. Commit ` +
          `${ACTION_VERSION_FILE} and .github/workflows together.`,
      );
    });

  publishJsr = target()
    .description("Publish new package versions to JSR, core first")
    .executes(async () => {
      for (const pkg of PACKAGES) {
        const version = await localVersion(pkg);
        if (version === "0.0.0") {
          ConsoleTasks.info(`@zuke/${pkg} has no released version yet.`);
          continue;
        }
        await publishOne(pkg, version, {
          isPublished,
          publishPackage,
          info: ConsoleTasks.info,
          success: ConsoleTasks.success,
        });
      }
    });

  // `release` (release-please) needs a GITHUB_TOKEN; `publishJsr` needs JSR
  // OIDC. The release workflow runs them as two least-privilege jobs. This
  // aggregate keeps the single-command `./zuke publish` working locally and
  // runs release first (declared earlier) so versions are current before JSR.
  publish = target()
    .description("Release then publish new versions to JSR")
    .dependsOn(this.release, this.publishJsr)
    .executes(() => {});

  // Convention: the `default` target runs when none is named.
  default = target()
    .description("Default: run the full CI gate")
    .dependsOn(this.ci)
    .executes(() => {});

  /**
   * Every generated GitHub workflow, declared in `build/workflows.ts`.
   *
   * One field, because the entries nest: each is discovered as
   * `workflows.<key>` and writes `.github/workflows/<key>.yml`. It sits last
   * because it references the targets above it — class fields initialise
   * top-to-bottom, the same constraint `dependsOn` has.
   */
  workflows = githubWorkflows(this);
}

await run(ZukeBuild, { renderer: consoleRenderer });
