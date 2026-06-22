# @zuke/ai

AI code review as a target validation for
[Zuke](https://github.com/zuke-build/zuke#readme) builds. Define a reviewer
fluently — provider and API key are the only required options — and plug it into
a target with `.validateBefore(...)` / `.validateAfter(...)`. The reviewer
fetches the diff, asks the model for a structured assessment, prints the
findings, and **breaks the build** when the assessed risk crosses the threshold
you choose.

```ts
import { Build, parameter, run, target } from "jsr:@zuke/core";
import { securityReviewer } from "jsr:@zuke/ai";

class Pipeline extends Build {
  key = parameter("Anthropic API key").secret().required();

  // Provider + key is all that's required; everything else is defaulted.
  security = securityReviewer((r) =>
    r.provider("claude").apiKey(this.key).failWhen((g) => g.scoreAbove(7))
  );

  deploy = target()
    .validateBefore(this.security) // gate before deploying
    .executes(async () => {/* … */});
}

if (import.meta.main) await run(Pipeline);
```

## Reviewers

`genericReviewer` (needs `.criteria(...)`), `securityReviewer`,
`secretsReviewer`, `correctnessReviewer`, and `licenseReviewer` — all share the
same fluent `Reviewer` and return a `Validation`.

## Providers

`"claude"` (default model `claude-opus-4-8`), `"openai"`, and `"gemini"`. The
API key comes from a `parameter().secret()` (masked in CI) or a string.

## Options (all optional, with defaults)

`.model(...)`, `.effort(...)`, `.diff((d) => d.base("origin/main"))`,
`.include(...)`/`.exclude(...)`, `.maxDiffTokens(n)`,
`.failWhen((g) => g.scoreAbove(7) / g.severityAtLeast("high"))`,
`.onError("fail" | "warn")`, `.quiet()`.

See [Zuke](https://github.com/zuke-build/zuke#readme) for the full guide.
