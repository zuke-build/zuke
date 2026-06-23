import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { Build, discoverParameters, parameter, target } from "@zuke/core";
import {
  aiReviewWorkflow,
  genericReviewer,
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
  // Comment is enabled on at least one reviewer → pull-requests write.
  assertStringIncludes(yaml, "permissions:\n  contents: read");
  assertStringIncludes(yaml, "pull-requests: write");
  // Concurrency keyed by workflow + ref, cancel-in-progress true.
  assertStringIncludes(yaml, "concurrency:\n  group:");
  assertStringIncludes(yaml, "cancel-in-progress: true");
  // Fork gating.
  assertStringIncludes(
    yaml,
    'if: "${{ github.event.pull_request.head.repo.fork',
  );
  // Job-level timeout matches the original hand-written workflow.
  assertStringIncludes(yaml, "timeout-minutes: 15");
});

Deno.test("the steps are: harden, checkout (no credentials), fetch base, run ./zuke <target>", () => {
  const yaml = dualBuild().wf.render();
  assertStringIncludes(
    yaml,
    "uses: step-security/harden-runner@9af89fc71515a100421586dfdb3dc9c984fbf411",
  );
  assertStringIncludes(yaml, "egress-policy: audit");
  assertStringIncludes(
    yaml,
    "uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
  );
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
