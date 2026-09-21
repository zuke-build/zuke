// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { Build, discoverParameters, parameter, target } from "@zuke/core";
import {
  aiReviewWorkflow,
  genericReviewer,
  type ReviewCommandSettings,
  type Reviewer,
  securityReviewer,
} from "../mod.ts";

/** A small build with two reviewers — what zuke.ts itself ends up doing. */
function dualBuild(): Build & { wf: ReturnType<typeof aiReviewWorkflow> } {
  class B extends Build {
    openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    geminiKey = parameter("Gemini key").secret().env("GEMINI_API_KEY");
    security = securityReviewer((r) =>
      r.provider("openai").apiKey(this.openaiKey).comment()
    );
    general = genericReviewer((r) =>
      r.provider("gemini").apiKey(this.geminiKey).comment()
    );
    review = target().validateBefore(this.security, this.general).executes(
      () => {},
    );
    wf = aiReviewWorkflow({
      reviewers: [this.security, this.general],
    });
  }
  const b = new B();
  discoverParameters(b); // populate the parameter `name_` so envName resolves
  return b;
}

Deno.test("aiReviewWorkflow writes to the conventional GitHub workflow path", () => {
  const b = dualBuild();
  assertEquals(b.wf.path, ".github/workflows/ai-review.yml");
  assertEquals(b.wf.provider, "github");
});

Deno.test("the generated YAML carries the right triggers, permissions, concurrency, and gate", () => {
  const yaml = dualBuild().wf.render();
  assertStringIncludes(yaml, "name: AI Review");
  // Every branch's pull requests.
  assertStringIncludes(yaml, "pull_request: {}");
  // Comment is enabled on at least one reviewer → pull-requests write, on the
  // job that posts; the workflow itself stays read-only.
  assertStringIncludes(yaml, "permissions:\n  contents: read\njobs:");
  assertStringIncludes(
    yaml,
    "    permissions:\n      contents: read\n      pull-requests: write",
  );
  // Concurrency on the job, cancel-in-progress true.
  assertStringIncludes(yaml, "    concurrency:\n      group:");
  assertStringIncludes(yaml, "cancel-in-progress: true");
  // Fork gating, on the pull_request event by name.
  assertStringIncludes(
    yaml,
    "if: \"${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false }}\"",
  );
  // Job-level timeout matches the original hand-written workflow.
  assertStringIncludes(yaml, "timeout-minutes: 15");
});

Deno.test("the steps are: the Zuke prelude, fetch base, run ./zuke <target>", () => {
  const yaml = dualBuild().wf.render();
  // One prelude step from core, rather than a harden and a checkout built here
  // from this package's own pinned constants.
  assertStringIncludes(yaml, "uses: zuke-build/zuke@");
  assertEquals(yaml.includes("step-security/harden-runner"), false);
  assertEquals(yaml.includes("actions/checkout"), false);
  // The policy those two steps carried is still stated, as the action's inputs.
  assertStringIncludes(yaml, "egress-policy: audit");
  // `false` is a string here so YAML doesn't read it as a boolean.
  assertStringIncludes(yaml, 'persist-credentials: "false"');
  // `=` in the command forces YAML to quote the run scalar.
  assertStringIncludes(yaml, '"git fetch --no-tags --depth=1 origin master"');
  assertStringIncludes(yaml, "run: ./zuke review");
});

Deno.test("every reviewer's key env var is wired into the run step's env block", () => {
  const yaml = dualBuild().wf.render();
  assertStringIncludes(yaml, 'OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}"');
  assertStringIncludes(yaml, 'GEMINI_API_KEY: "${{ secrets.GEMINI_API_KEY }}"');
  // A reviewer with .comment() pulls GITHUB_TOKEN in too.
  assertStringIncludes(yaml, 'GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}"');
  // The diff-base hint is always present.
  assertStringIncludes(yaml, "ZUKE_REVIEW_BASE: FETCH_HEAD");
});

Deno.test("no reviewer uses .comment() → permissions stays read-only, no GITHUB_TOKEN", () => {
  class B extends Build {
    key = parameter("Claude key").secret().env("ANTHROPIC_API_KEY");
    rev = securityReviewer((r) => r.provider("claude").apiKey(this.key)); // no .comment()
    review = target().validateBefore(this.rev).executes(() => {});
    wf = aiReviewWorkflow({ reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertStringIncludes(yaml, "permissions:\n  contents: read");
  assertEquals(yaml.includes("pull-requests"), false);
  assertEquals(yaml.includes("GITHUB_TOKEN"), false);
  assertStringIncludes(yaml, "ANTHROPIC_API_KEY:");
});

Deno.test("baseBranch, target, name, path, and timeoutMinutes override the defaults", () => {
  class B extends Build {
    key = parameter("Key").secret().env("K");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    wf = aiReviewWorkflow({
      reviewers: [this.rev],
      target: "audit",
      baseBranch: "main",
      name: "PR Review",
      path: ".github/workflows/audit.yml",
      timeoutMinutes: 30,
    });
  }
  const b = new B();
  discoverParameters(b);
  assertEquals(b.wf.path, ".github/workflows/audit.yml");
  const yaml = b.wf.render();
  assertStringIncludes(yaml, "name: PR Review");
  assertStringIncludes(yaml, "run: ./zuke audit");
  assertStringIncludes(yaml, '"git fetch --no-tags --depth=1 origin main"');
  assertStringIncludes(yaml, "timeout-minutes: 30");
});

Deno.test("an unsafe baseBranch is rejected before it reaches the command", () => {
  const rev = securityReviewer((r) => r.provider("openai").apiKey("k"));
  assertThrows(
    () => aiReviewWorkflow({ reviewers: [rev], baseBranch: "main; rm -rf /" }),
    Error,
    "baseBranch",
  );
  // Whitespace alone is enough to break the single-token git argument.
  assertThrows(
    () => aiReviewWorkflow({ reviewers: [rev], baseBranch: "a b" }),
    Error,
    "not a valid",
  );
});

Deno.test("an unsafe target is rejected before it reaches the command", () => {
  const rev = securityReviewer((r) => r.provider("openai").apiKey("k"));
  assertThrows(
    () => aiReviewWorkflow({ reviewers: [rev], target: "review && curl evil" }),
    Error,
    "target",
  );
});

Deno.test("slashes and dots in a branch name are accepted", () => {
  class B extends Build {
    key = parameter("Key").secret().env("K");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    wf = aiReviewWorkflow({
      reviewers: [this.rev],
      baseBranch: "release/2.0.x",
    });
  }
  const b = new B();
  discoverParameters(b);
  assertStringIncludes(
    b.wf.render(),
    "origin release/2.0.x",
  );
});

Deno.test("a custom .githubToken(param) is wired by that parameter's env var", () => {
  class B extends Build {
    apiKey = parameter("Key").secret().env("OPENAI_API_KEY");
    botToken = parameter("Bot token").secret().env("BOT_TOKEN");
    rev = securityReviewer((r) =>
      r.provider("openai").apiKey(this.apiKey).comment().githubToken(
        this.botToken,
      )
    );
    wf = aiReviewWorkflow({ reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  // The reviewer's explicit token replaces the default GITHUB_TOKEN.
  assertStringIncludes(yaml, 'BOT_TOKEN: "${{ secrets.BOT_TOKEN }}"');
  assertEquals(yaml.includes("GITHUB_TOKEN"), false);
});

Deno.test("a literal-string apiKey is skipped from env (no parameter to map)", () => {
  // Allowed but not recommended: the generator can't infer an env var.
  const rev = securityReviewer((r) =>
    r.provider("openai").apiKey("sk-literal")
  );
  const wf = aiReviewWorkflow({ reviewers: [rev as Reviewer] });
  const yaml = wf.render();
  // Only ZUKE_REVIEW_BASE remains in env — no secret reference.
  assertEquals(yaml.includes("sk-literal"), false);
  assertEquals(yaml.includes("OPENAI_API_KEY"), false);
  assertStringIncludes(yaml, "ZUKE_REVIEW_BASE: FETCH_HEAD");
});

// ─── GitLab ─────────────────────────────────────────────────────────────────

Deno.test("gitlab: defaults to the include-snippet path and an MR-only job", () => {
  class B extends Build {
    key = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    rev = securityReviewer((r) =>
      r.provider("openai").apiKey(this.key).comment()
    );
    wf = aiReviewWorkflow({ host: "gitlab", reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  assertEquals(b.wf.path, ".gitlab/ai-review.gitlab-ci.yml");
  assertEquals(b.wf.provider, "gitlab");

  const yaml = b.wf.render();
  // MR-only workflow rules.
  assertStringIncludes(yaml, "merge_request_event");
  // Single review job on the Deno image with our timeout.
  assertStringIncludes(yaml, "review:\n  stage: build");
  // The image string has a colon, so YAML emits it quoted.
  assertStringIncludes(yaml, 'image: "denoland/deno:latest"');
  assertStringIncludes(yaml, "timeout: 15 minutes");
  assertStringIncludes(yaml, "script:\n    - ./zuke review");
  // GitLab variables flow in from project settings — no env: block in YAML.
  assertEquals(yaml.includes("OPENAI_API_KEY"), false);
});

Deno.test("gitlab: target and timeoutMinutes overrides apply", () => {
  class B extends Build {
    key = parameter("Key").secret().env("K");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    wf = aiReviewWorkflow({
      host: "gitlab",
      reviewers: [this.rev],
      target: "audit",
      timeoutMinutes: 30,
    });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertStringIncludes(yaml, "- ./zuke audit");
  assertStringIncludes(yaml, "timeout: 30 minutes");
});

// ─── Azure Pipelines ────────────────────────────────────────────────────────

Deno.test("azure: defaults, PR trigger, and each secret wired as $(NAME) env", () => {
  class B extends Build {
    openaiKey = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    geminiKey = parameter("Gemini key").secret().env("GEMINI_API_KEY");
    security = securityReviewer((r) =>
      r.provider("openai").apiKey(this.openaiKey).comment()
    );
    general = genericReviewer((r) =>
      r.provider("gemini").apiKey(this.geminiKey).comment()
    );
    wf = aiReviewWorkflow({
      host: "azure",
      reviewers: [this.security, this.general],
    });
  }
  const b = new B();
  discoverParameters(b);
  assertEquals(b.wf.path, "pipelines/ai-review.azure-pipelines.yml");
  assertEquals(b.wf.provider, "azure");

  const yaml = b.wf.render();
  // PR-only — every branch.
  assertStringIncludes(yaml, 'pr:\n  branches:\n    include:\n      - "*"');
  assertStringIncludes(yaml, "- job: review");
  assertStringIncludes(yaml, "timeoutInMinutes: 15");
  // Script step + env wiring with Azure-style $(NAME) references.
  assertStringIncludes(yaml, "- script: ./zuke review");
  assertStringIncludes(yaml, 'OPENAI_API_KEY: "$(OPENAI_API_KEY)"');
  assertStringIncludes(yaml, 'GEMINI_API_KEY: "$(GEMINI_API_KEY)"');
  // Comment is enabled → SYSTEM_ACCESSTOKEN must be mapped in too.
  assertStringIncludes(yaml, 'SYSTEM_ACCESSTOKEN: "$(SYSTEM_ACCESSTOKEN)"');
});

Deno.test("azure: a custom .commentToken(param) replaces SYSTEM_ACCESSTOKEN", () => {
  class B extends Build {
    apiKey = parameter("Key").secret().env("OPENAI_API_KEY");
    botToken = parameter("Bot token").secret().env("BOT_TOKEN");
    rev = securityReviewer((r) =>
      r.provider("openai").apiKey(this.apiKey).comment().commentToken(
        this.botToken,
      )
    );
    wf = aiReviewWorkflow({ host: "azure", reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertStringIncludes(yaml, 'BOT_TOKEN: "$(BOT_TOKEN)"');
  assertEquals(yaml.includes("SYSTEM_ACCESSTOKEN"), false);
});

Deno.test("azure: no reviewer uses .comment() → no SYSTEM_ACCESSTOKEN mapping", () => {
  class B extends Build {
    key = parameter("Key").secret().env("ANTHROPIC_API_KEY");
    rev = securityReviewer((r) => r.provider("claude").apiKey(this.key)); // no .comment()
    wf = aiReviewWorkflow({ host: "azure", reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertStringIncludes(yaml, 'ANTHROPIC_API_KEY: "$(ANTHROPIC_API_KEY)"');
  assertEquals(yaml.includes("SYSTEM_ACCESSTOKEN"), false);
});

// ─── Bitbucket Pipelines ─────────────────────────────────────────────────────

Deno.test("bitbucket: defaults to bitbucket-pipelines.yml with a pull-requests step", () => {
  class B extends Build {
    key = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    rev = securityReviewer((r) =>
      r.provider("openai").apiKey(this.key).comment()
    );
    wf = aiReviewWorkflow({ host: "bitbucket", reviewers: [this.rev] });
  }
  const b = new B();
  discoverParameters(b);
  // Bitbucket has no include — the file must be at the repo root.
  assertEquals(b.wf.path, "bitbucket-pipelines.yml");
  assertEquals(b.wf.provider, "bitbucket");

  const yaml = b.wf.render();
  assertStringIncludes(yaml, "pipelines:\n  pull-requests:");
  assertStringIncludes(yaml, '"**":'); // every branch's PRs
  assertStringIncludes(yaml, "- step:");
  assertStringIncludes(yaml, "name: AI review");
  assertStringIncludes(yaml, 'image: "denoland/deno:latest"');
  assertStringIncludes(yaml, "max-time: 15");
  assertStringIncludes(yaml, "- ./zuke review");
  // Like GitLab, repo variables flow in automatically — no env block.
  assertEquals(yaml.includes("OPENAI_API_KEY"), false);
});

Deno.test("bitbucket: target and timeoutMinutes overrides apply", () => {
  class B extends Build {
    key = parameter("Key").secret().env("K");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    wf = aiReviewWorkflow({
      host: "bitbucket",
      reviewers: [this.rev],
      target: "audit",
      timeoutMinutes: 30,
    });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertStringIncludes(yaml, "- ./zuke audit");
  assertStringIncludes(yaml, "max-time: 30");
});

Deno.test("fetchBase: false drops the fetch step and the FETCH_HEAD override", () => {
  class B extends Build {
    key = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    review = target().validateBefore(this.rev).executes(() => {});
    wf = aiReviewWorkflow({ reviewers: [this.rev], fetchBase: false });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();

  // The build's own target fetches the base, so the workflow must neither
  // duplicate the fetch nor override the base the target set up.
  assertEquals(yaml.includes("git fetch"), false);
  assertEquals(yaml.includes("ZUKE_REVIEW_BASE"), false);
  // Everything else is unchanged: the prelude and the review run.
  assertStringIncludes(yaml, "uses: zuke-build/zuke@");
  assertStringIncludes(yaml, "run: ./zuke review");
});

Deno.test("fetchBase defaults to true, since a PR checkout has no base", () => {
  const yaml = dualBuild().wf.render();
  assertStringIncludes(yaml, "git fetch --no-tags --depth=1 origin master");
  assertStringIncludes(yaml, "ZUKE_REVIEW_BASE: FETCH_HEAD");
});

Deno.test("naming either action renders the two separate steps", () => {
  // The opt-out, for a repository that cannot consume a Marketplace action.
  // Naming an action means those specific actions were asked for, so rendering
  // one that runs neither would discard a pin the caller chose.
  class B extends Build {
    key = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    rev = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    review = target().validateBefore(this.rev).executes(() => {});
    wf = aiReviewWorkflow({
      reviewers: [this.rev],
      hardenRunner: "step-security/harden-runner@" + "a".repeat(40),
      checkout: "actions/checkout@" + "b".repeat(40),
    });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertEquals(yaml.includes("zuke-build/zuke"), false);
  assertStringIncludes(yaml, `harden-runner@${"a".repeat(40)}`);
  assertStringIncludes(yaml, `checkout@${"b".repeat(40)}`);
});

Deno.test("the prelude carries a pin without this package holding one", () => {
  // Why the two constants could be deleted: core's prelude ships its own pin,
  // so nothing here can go stale against a release. That mattered — those
  // constants made ai-review.yml the one generated workflow whose SHAs came
  // from a published package, and a Dependabot bump to it was reverted by the
  // next regeneration.
  const yaml = dualBuild().wf.render();
  assertEquals(/uses: zuke-build\/zuke@[0-9a-f]{40}/.test(yaml), true);
});

Deno.test("the prelude pin comes from the resolver, not core's fallback", () => {
  // Without a resolver the prelude falls back to the reference baked into the
  // core this package resolved against — a release behind the moment the action
  // is released again, and silently: this file would name a different commit
  // from every other generated workflow in the repository, and only a diff
  // would show it. That happened once here, between v1.0.1 and v1.0.2.
  class B extends Build {
    key = parameter("OpenAI key").secret().env("OPENAI_API_KEY");
    security = securityReviewer((r) => r.provider("openai").apiKey(this.key));
    review = target().validateBefore(this.security).executes(() => {});
    wf = aiReviewWorkflow({
      reviewers: [this.security],
      pins: (action) => ({ ref: `${action}@${"e".repeat(40)}`, version: "v9" }),
    });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();

  assertStringIncludes(yaml, `zuke-build/zuke@${"e".repeat(40)} # v9`);
});

// ─── command: the on-demand job ─────────────────────────────────────────────

/** A build whose workflow declares the comment command. */
function commandBuild(
  configure = (c: ReviewCommandSettings) =>
    c.text("@zuke-build review").secrets("APP_ID", "APP_KEY"),
): string {
  class B extends Build {
    key = parameter("Key").secret().env("OPENAI_API_KEY");
    security = securityReviewer((r) =>
      r.provider("openai").apiKey(this.key).comment()
    );
    review = target().validateBefore(this.security).executes(() => {});
    wf = aiReviewWorkflow({ reviewers: [this.security], command: configure });
  }
  const b = new B();
  discoverParameters(b);
  return b.wf.render();
}

Deno.test("command adds the issue_comment trigger and a job gated on the command, a human maintainer and a pull request", () => {
  const yaml = commandBuild();
  assertStringIncludes(yaml, "pull_request: {}");
  assertStringIncludes(yaml, "issue_comment:\n    types:\n      - created");
  assertStringIncludes(yaml, "commandReview:\n    name: AI review on command");
  // Every clause of the gate reads metadata GitHub asserts; the body is only
  // prefix-matched, so a reply quoting the command (`> @zuke-build review`)
  // does not match.
  const gate =
    yaml.split("\n").find((line) =>
      line.includes("github.event_name == 'issue_comment'")
    ) ?? "";
  assertStringIncludes(gate, "github.event.issue.pull_request &&");
  assertStringIncludes(gate, "github.event.comment.user.type != 'Bot'");
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assertStringIncludes(
      gate,
      `github.event.comment.author_association == '${association}'`,
    );
  }
  assertEquals(gate.includes("CONTRIBUTOR"), false);
  assertStringIncludes(
    gate,
    "startsWith(github.event.comment.body, '@zuke-build review')",
  );
  // The comment's text never reaches a `run:` line — only the number of the
  // pull request and the id of the comment do, as env.
  assertEquals(yaml.includes("github.event.comment.body }}"), false);
  assertStringIncludes(
    yaml,
    'ZUKE_REVIEW_PR: "${{ github.event.issue.number }}"',
  );
  assertStringIncludes(
    yaml,
    'ZUKE_REVIEW_COMMENT: "${{ github.event.comment.id }}"',
  );
});

Deno.test("the command job carries the named secrets and no base fetch; the pull_request job is unchanged", () => {
  const yaml = commandBuild();
  const [reviewJob, commandJob] = yaml.split("  commandReview:");
  // Only the command job receives the extra secrets.
  assertStringIncludes(commandJob, 'APP_ID: "${{ secrets.APP_ID }}"');
  assertStringIncludes(commandJob, 'APP_KEY: "${{ secrets.APP_KEY }}"');
  assertEquals(reviewJob.includes("APP_ID"), false);
  // Both get the reviewers' keys and the host token.
  assertStringIncludes(
    commandJob,
    'OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}"',
  );
  assertStringIncludes(
    commandJob,
    'GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}"',
  );
  // The reviewers fetch the pull request themselves: no base fetch step and no
  // base hint on the command job, which would point at the default branch.
  assertEquals(commandJob.includes("Fetch the base branch"), false);
  assertEquals(commandJob.includes("ZUKE_REVIEW_BASE"), false);
  assertStringIncludes(reviewJob, "Fetch the base branch");
  assertStringIncludes(reviewJob, "ZUKE_REVIEW_BASE: FETCH_HEAD");
  // The pull_request job now states its event, since the workflow has two.
  assertStringIncludes(
    reviewJob,
    "if: \"${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false }}\"",
  );
  // Same prelude and timeout on both.
  assertEquals(commandJob.includes("uses: zuke-build/zuke@"), true);
  assertStringIncludes(commandJob, "timeout-minutes: 15");
});

Deno.test("concurrency is per job and keyed on the pull request, never on the workflow", () => {
  // The review's own comment, posted as an app, fires `issue_comment` again.
  // That run is skipped by the bot check — but a workflow-level group would
  // still admit it, and cancel-in-progress would cancel the review mid-post.
  // A skipped job never enters a job-level group. `github.ref` is the default
  // branch for every comment-started run, so the key is the pull request.
  const yaml = commandBuild();
  assertEquals(yaml.includes("\nconcurrency:"), false);
  assertEquals(yaml.includes("${{ github.ref }}"), false);
  const [reviewJob, commandJob] = yaml.split("  commandReview:");
  assertStringIncludes(
    reviewJob,
    '    concurrency:\n      group: "ai-review-${{ github.workflow }}-review-${{ github.event.pull_request.number }}"\n      cancel-in-progress: true',
  );
  assertStringIncludes(
    commandJob,
    '    concurrency:\n      group: "ai-review-${{ github.workflow }}-commandReview-${{ github.event.issue.number }}"\n      cancel-in-progress: true',
  );
  // The same shape without a command: one job, its own group.
  const plain = dualBuild().wf.render();
  assertEquals(plain.includes("\nconcurrency:"), false);
  assertStringIncludes(
    plain,
    "-review-${{ github.event.pull_request.number }}",
  );
});

Deno.test("without a command there is no issue_comment trigger and no second job", () => {
  const yaml = dualBuild().wf.render();
  assertEquals(yaml.includes("issue_comment"), false);
  assertEquals(yaml.includes("commandReview"), false);
  assertEquals(yaml.includes("ZUKE_REVIEW_PR"), false);
});

Deno.test("a command that could break out of the expression, or no command text, is rejected", () => {
  for (
    const text of [
      "",
      "review') || true || ('",
      "@zuke\nreview",
      "two  spaces",
      " lead",
    ]
  ) {
    assertThrows(
      () => commandBuild((c) => c.text(text)),
      Error,
      "is not a valid comment command",
    );
  }
  assertThrows(
    () => commandBuild((c) => c),
    Error,
    "is not a valid comment command",
  );
  assertThrows(
    () => commandBuild((c) => c.text("/zuke review").secrets("BAD-NAME")),
    Error,
    "is not a valid secret name",
  );
  // The shapes the docs suggest all pass.
  for (const text of ["@zuke-build review", "/zuke review", "zuke: review"]) {
    assertStringIncludes(commandBuild((c) => c.text(text)), text);
  }
});

Deno.test("the command is GitHub-only: another host renders no comment job", () => {
  class B extends Build {
    key = parameter("Key").secret().env("K");
    rev = securityReviewer((r) => r.provider("claude").apiKey(this.key));
    review = target().validateBefore(this.rev).executes(() => {});
    wf = aiReviewWorkflow({
      host: "gitlab",
      reviewers: [this.rev],
      command: (c) => c.text("@zuke-build review"),
    });
  }
  const b = new B();
  discoverParameters(b);
  const yaml = b.wf.render();
  assertEquals(yaml.includes("issue_comment"), false);
  assertEquals(yaml.includes("commandReview"), false);
});

Deno.test("the command job checks the commenter's push access before the review", () => {
  // `author_association` admits read-only members and collaborators, so the
  // job asks the collaborators API first: admin/write pass, read/none fail.
  const commandJob = commandBuild().split("  commandReview:")[1];
  const check = commandJob.indexOf("Require push access for the commenter");
  const review = commandJob.indexOf("AI review with Zuke");
  assertEquals(check > 0 && check < review, true);
  const step = commandJob.slice(check, review);
  assertStringIncludes(step, 'GH_TOKEN: "${{ github.token }}"');
  assertStringIncludes(
    step,
    'ZUKE_REVIEW_ACTOR: "${{ github.event.comment.user.login }}"',
  );
  assertStringIncludes(step, "collaborators/$ZUKE_REVIEW_ACTOR/permission");
  assertStringIncludes(step, "admin|write)");
  assertStringIncludes(step, "exit 1");
  // Fails closed, explicitly: its own shell and flags, and an API call that
  // cannot be read refuses the run rather than falling through.
  assertStringIncludes(step, "shell: bash");
  assertStringIncludes(step, "set -euo pipefail");
  assertStringIncludes(step, "refusing to run the review");
  // The login is validated before it is put in a URL, and it reaches the
  // script only as env — never interpolated into the script text.
  assertStringIncludes(step, "*[!A-Za-z0-9-]*)");
  assertEquals(
    step.split("${{ github.event.comment.user.login }}").length,
    2,
  );
});

// ─── threads: the reply job ─────────────────────────────────────────────────

/** A build whose reviewer anchors findings to review threads. */
function threadsBuild(threads: boolean): string {
  class B extends Build {
    key = parameter("Key").secret().env("OPENAI_API_KEY");
    security = securityReviewer((r) =>
      threads
        ? r.provider("openai").apiKey(this.key).comment()
          .discussion((d) => d.threads())
        : r.provider("openai").apiKey(this.key).comment().discussion()
    );
    review = target().validateBefore(this.security).executes(() => {});
    wf = aiReviewWorkflow({ reviewers: [this.security] });
  }
  const b = new B();
  discoverParameters(b);
  return b.wf.render();
}

Deno.test("threads add the pull_request_review_comment trigger and a job gated on a maintainer's reply on a non-fork pull request", () => {
  const yaml = threadsBuild(true);
  assertStringIncludes(
    yaml,
    "pull_request_review_comment:\n    types:\n      - created",
  );
  assertStringIncludes(
    yaml,
    "replyReview:\n    name: AI review on thread reply",
  );
  const gate =
    yaml.split("\n").find((line) =>
      line.includes("github.event_name == 'pull_request_review_comment'")
    ) ?? "";
  // The event checks the pull request out, so a fork is refused exactly as
  // the pull_request job refuses it; only a reply, by a human maintainer.
  assertStringIncludes(
    gate,
    "github.event.pull_request.head.repo.fork == false &&",
  );
  assertStringIncludes(gate, "github.event.comment.in_reply_to_id &&");
  assertStringIncludes(gate, "github.event.comment.user.type != 'Bot'");
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) {
    assertStringIncludes(
      gate,
      `github.event.comment.author_association == '${association}'`,
    );
  }
  assertEquals(gate.includes("CONTRIBUTOR"), false);
  // The push-access check runs before the key is spent, then the review job's
  // own steps: the base fetch and the review against FETCH_HEAD — no
  // ZUKE_REVIEW_PR, since the checkout is the pull request itself.
  const [, replyJob] = yaml.split("  replyReview:");
  const [reply] = replyJob.split("  commandReview:");
  assertStringIncludes(reply, "Require push access for the commenter");
  assertStringIncludes(reply, "Fetch the base branch");
  assertStringIncludes(reply, "ZUKE_REVIEW_BASE: FETCH_HEAD");
  assertEquals(reply.includes("ZUKE_REVIEW_PR"), false);
  assertStringIncludes(
    reply,
    'group: "ai-review-${{ github.workflow }}-replyReview-${{ github.event.pull_request.number }}"',
  );
  assertStringIncludes(reply, "pull-requests: write");
  assertStringIncludes(reply, "timeout-minutes: 15");
});

Deno.test("without threads there is no reply job and no review-comment trigger", () => {
  const yaml = threadsBuild(false);
  assertEquals(yaml.includes("pull_request_review_comment"), false);
  assertEquals(yaml.includes("replyReview"), false);
});
