import {
  assertEquals,
  assertStringIncludes,
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
