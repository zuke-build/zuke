// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import type { JsonValue, TargetStateHandle } from "@zuke/core";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  type AwsLambdaCanarySettings,
  AwsOutputError,
  lambdaCanary,
} from "../mod.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import { withEmptyPath } from "./_fake.ts";
import { flagValue, LambdaModel } from "./_lambda_model.ts";

/** A state handle backed by a plain object, as the engine's in-memory one is. */
function memoryState(accept = true): TargetStateHandle & {
  data: Record<string, JsonValue>;
} {
  const data: Record<string, JsonValue> = {};
  return {
    data,
    set: (patch) => {
      Object.assign(data, patch);
      return Promise.resolve();
    },
    trySet: (patch) => {
      if (accept) Object.assign(data, patch);
      return Promise.resolve(accept);
    },
    get: () => ({ ...data }),
  };
}

/** An engine-like context with a recorded summary. */
function context(state = memoryState()) {
  const summary: Record<string, string | number> = {};
  return {
    state,
    summary,
    reportSummary: (pairs: Record<string, string | number>) => {
      Object.assign(summary, pairs);
    },
  };
}

/** The platform against `model`, shipping `dist/api.zip` unless changed. */
function platform(
  model: LambdaModel,
  extra: (l: AwsLambdaCanarySettings) => AwsLambdaCanarySettings = (l) =>
    l.zipFile("dist/api.zip"),
) {
  return lambdaCanary((l) =>
    extra(
      l.functionName("api").alias("live")
        .aws((a) => a.region("eu-west-1").runner(model.runner)),
    )
  );
}

/** A rollout staged with the default configuration, and its model. */
async function staged() {
  const model = new LambdaModel();
  const ctx = context();
  await platform(model).stage(ctx);
  return { model, ctx };
}

Deno.test("lambdaCanary: stage publishes the candidate and records the rollout without touching the alias", async () => {
  const { model, ctx } = await staged();
  assertEquals(model.calls.map((argv) => argv.slice(1, 3)), [
    ["get-alias", "--function-name=api"],
    ["get-function", "--function-name=api"],
    ["wait", "function-updated-v2"],
    ["update-function-code", "--function-name=api"],
    ["get-function", "--function-name=api"],
    ["wait", "published-version-active"],
  ]);
  const publish = model.calls[3];
  assertEquals(flagValue(publish, "--function-name"), "api");
  assertEquals(publish.includes("--publish"), true);
  assertEquals(flagValue(publish, "--zip-file"), "fileb://dist/api.zip");
  assertEquals(flagValue(publish, "--region"), "eu-west-1");
  assertEquals(flagValue(model.calls[1], "--qualifier"), "3");
  assertEquals(flagValue(model.calls[4], "--qualifier"), "4");
  assertEquals(flagValue(model.calls[5], "--qualifier"), "4");
  assertEquals(model.live, { version: "3", weights: {}, revision: "rev-0" });
  assertEquals(ctx.state.get(), {
    lambdaCanaryStage: "staged",
    lambdaCanaryFunction: "api",
    lambdaCanaryAlias: "live",
    lambdaCanaryAwsFlags: ["--region", "eu-west-1"],
    lambdaCanaryAliasArn:
      "arn:aws:lambda:eu-west-1:111111111111:function:api:live",
    lambdaCanaryStable: "3",
    lambdaCanaryStableCodeSha256: "sha-3",
    lambdaCanaryCandidate: "4",
    lambdaCanaryCodeSha256: "sha-fileb://dist/api.zip",
  });
  assertEquals(ctx.summary, { Candidate: "version 4", Stable: "version 3" });
});

Deno.test("lambdaCanary: expose weights the candidate on the alias, promote moves the alias", async () => {
  const { model, ctx } = await staged();
  const lambda = platform(model);
  assertEquals(await lambda.expose(10, ctx), 10);
  assertEquals(model.live.weights, { "4": 0.1 });
  const update = model.calls.at(-1) ?? [];
  assertEquals(flagValue(update, "--revision-id"), "rev-0");
  assertEquals(await lambda.expose(50, ctx), 50);
  assertEquals(model.live.weights, { "4": 0.5 });
  await lambda.promote(ctx);
  assertEquals(model.live.version, "4");
  assertEquals(model.live.weights, {});
  assertEquals(model.aliasUpdates(), [
    ['--routing-config={"AdditionalVersionWeights":{"4":0.1}}'],
    ['--routing-config={"AdditionalVersionWeights":{"4":0.5}}'],
    [
      "--function-version=4",
      '--routing-config={"AdditionalVersionWeights":{}}',
    ],
  ]);
  // A promote run again finds the alias already on the candidate.
  const before = model.mutations().length;
  await lambda.promote(ctx);
  assertEquals(model.mutations().length, before);
});

Deno.test("lambdaCanary: exposing 0 % clears the routing and 100 % is a whole weight", async () => {
  const { model, ctx } = await staged();
  const lambda = platform(model);
  await lambda.expose(100, ctx);
  assertEquals(model.live.weights, { "4": 1 });
  await lambda.expose(0, ctx);
  assertEquals(model.live.weights, {});
});

Deno.test("lambdaCanary: a version given is rolled out without publishing", async () => {
  const model = new LambdaModel();
  const ctx = context();
  await platform(model, (l) => l.version("2")).stage(ctx);
  assertEquals(model.calls.map((argv) => argv[1]), [
    "get-alias",
    "get-function",
    "get-function",
    "wait",
  ]);
  assertEquals(ctx.state.get().lambdaCanaryCandidate, "2");
  assertEquals(ctx.state.get().lambdaCanaryCodeSha256, "sha-2");
});

Deno.test("lambdaCanary: stage refuses what it cannot split", async () => {
  const cases: ReadonlyArray<
    readonly [
      label: string,
      setup: (model: LambdaModel) => void,
      extra: (l: AwsLambdaCanarySettings) => AwsLambdaCanarySettings,
      message: string,
    ]
  > = [
    [
      "$LATEST",
      (m) => m.live.version = "$LATEST",
      (l) => l.version("2"),
      "only between published versions",
    ],
    [
      "a split",
      (m) => m.live.weights = { "2": 0.2 },
      (l) => l.version("1"),
      "already sends traffic to version 2",
    ],
    [
      "the stable version",
      () => {},
      (l) => l.version("3"),
      "nothing to roll out",
    ],
    [
      "unchanged code",
      (m) =>
        m.functions["111111111111/eu-west-1/api"].versions["3"] =
          "sha-fileb://dist/api.zip",
      (l) => l.zipFile("dist/api.zip"),
      "Lambda publishes no new version",
    ],
    ["no candidate", () => {}, (l) => l, "name the candidate once"],
    [
      "two candidates",
      () => {},
      (l) => l.version("2").zipFile("a.zip"),
      "name the candidate once",
    ],
    [
      "an S3 key with no bucket",
      () => {},
      (l) => l.s3Key("api.zip"),
      "name exactly one source",
    ],
    [
      "a candidate that never becomes Active",
      (m) => m.failingWaiter = "published-version-active",
      (l) => l.version("2"),
      "Waiter published-version-active failed",
    ],
    [
      "an update that never finishes",
      (m) => m.failingWaiter = "function-updated-v2",
      (l) => l.zipFile("a.zip"),
      "Waiter function-updated-v2 failed",
    ],
    ["a version that is no number", () => {}, (l) => l.version("v2"), "not a"],
  ];
  for (const [label, setup, extra, message] of cases) {
    const model = new LambdaModel();
    setup(model);
    const ctx = context();
    await assertRejects(
      () => platform(model, extra).stage(ctx),
      Error,
      message,
    );
    assertEquals(
      model.calls.some((argv) => argv[1] === "update-alias"),
      false,
      label,
    );
    // The marker says the alias was never reached, so a rollback is a no-op.
    assertEquals(ctx.state.get().lambdaCanaryStage, "publishing", label);
    await platform(model, extra).abort(ctx);
    assertEquals(model.mutations().filter((a) => a[1] === "update-alias"), []);
  }
});

Deno.test("lambdaCanary: a publish whose version reads back with other code is refused", async () => {
  const model = new LambdaModel();
  const run = model.runner;
  // Another update reaches the function between the publish and the read.
  const lambda = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("dist/api.zip").aws((a) =>
      a.runner((s) => {
        if (s.argv().includes("--qualifier=4")) {
          model.functions["111111111111/eu-west-1/api"].versions["4"] = "x";
        }
        return run(s);
      })
    )
  );
  const ctx = context();
  await assertRejects(
    () => lambda.stage(ctx),
    Error,
    "another update reached the function in between",
  );
  assertEquals(ctx.state.get().lambdaCanaryStage, "publishing");
  assertEquals(model.aliasUpdates(), []);
});

Deno.test("lambdaCanary: a code source is shipped to the function the alias belongs to", async () => {
  const sources: ReadonlyArray<
    readonly [
      label: string,
      configure: (l: AwsLambdaCanarySettings) => AwsLambdaCanarySettings,
      expected: readonly string[],
    ]
  > = [
    [
      "an S3 object",
      (l) => l.s3Bucket("b").s3Key("api.zip").s3ObjectVersion("v1"),
      ["--s3-bucket=b", "--s3-key=api.zip", "--s3-object-version=v1"],
    ],
    [
      "an image",
      (l) => l.imageUri("1.dkr.ecr/api:2"),
      ["--image-uri=1.dkr.ecr/api:2"],
    ],
  ];
  for (const [label, configure, expected] of sources) {
    const model = new LambdaModel();
    await platform(model, configure).stage(context());
    const publish = model.calls.find((argv) =>
      argv[1] === "update-function-code"
    ) ?? [];
    for (const token of expected) {
      assertEquals(publish.includes(token), true, `${label}: ${token}`);
    }
    assertEquals(publish.includes("--publish"), true, label);
    assertEquals(flagValue(publish, "--function-name"), "api", label);
  }
});

Deno.test("lambdaCanary: a read-back reporting another version is refused", async () => {
  const model = new LambdaModel();
  const run = model.runner;
  const lambda = lambdaCanary((l) =>
    l.functionName("api").alias("live").version("2").aws((a) =>
      a.runner((s) =>
        s.argv().includes("--qualifier=2")
          ? Promise.resolve(
            new CommandOutput(0, '{"version":"9","sha":"x"}', ""),
          )
          : run(s)
      )
    )
  );
  await assertRejects(
    () => lambda.stage(context()),
    Error,
    "asked api for version 2, and it reported version 9",
  );
});

Deno.test("lambdaCanary: an unrecordable rollout stops before any traffic moves", async () => {
  const model = new LambdaModel();
  const ctx = context(memoryState(false));
  await assertRejects(
    () => platform(model).stage(ctx),
    Error,
    "could not record the staged rollout",
  );
  assertEquals(model.aliasUpdates(), []);
});

Deno.test("lambdaCanary: a stage run again over its record checks it and publishes nothing", async () => {
  const { model, ctx } = await staged();
  model.calls = [];
  await platform(model).stage(ctx);
  assertEquals(model.calls.map((argv) => argv[1]), ["get-alias"]);
  assertEquals(ctx.summary.Candidate, "version 4");
  // …and refuses when the same configuration now reaches another account.
  model.accounts.default = "222222222222";
  model.functions["222222222222/eu-west-1/api"] = {
    versions: { "1": "sha-1" },
    aliases: { live: { version: "1", weights: {}, revision: "o" } },
    latest: "sha-1",
  };
  await assertRejects(
    () => platform(model).stage(ctx),
    Error,
    "the alias the AWS CLI reaches now is " +
      '"arn:aws:lambda:eu-west-1:222222222222:function:api:live"',
  );
});

Deno.test("lambdaCanary: an unknown stage marker is never acted on", async () => {
  for (const call of ["stage", "expose", "abort"] as const) {
    const model = new LambdaModel();
    const ctx = context();
    await ctx.state.set({ lambdaCanaryStage: "half-done" });
    const lambda = platform(model);
    await assertRejects(
      () =>
        call === "stage"
          ? lambda.stage(ctx)
          : call === "expose"
          ? lambda.expose(10, ctx).then(() => {})
          : lambda.abort(ctx),
      Error,
      "the rollout's record is damaged",
    );
    assertEquals(model.calls, [], call);
  }
});

Deno.test("lambdaCanary: a record missing a part changes nothing", async () => {
  const keys = [
    "lambdaCanaryFunction",
    "lambdaCanaryAlias",
    "lambdaCanaryAwsFlags",
    "lambdaCanaryAliasArn",
    "lambdaCanaryStable",
    "lambdaCanaryStableCodeSha256",
    "lambdaCanaryCandidate",
    "lambdaCanaryCodeSha256",
  ];
  for (const key of keys) {
    const { model, ctx } = await staged();
    await ctx.state.set({ [key]: key === "lambdaCanaryAwsFlags" ? [1] : "" });
    model.calls = [];
    await assertRejects(
      () => platform(model).expose(10, ctx),
      Error,
      "the rollout's record is damaged",
    );
    assertEquals(model.calls, [], key);
  }
});

Deno.test("lambdaCanary: a call configured for another alias, function or flags changes nothing", async () => {
  const changes: ReadonlyArray<
    readonly [
      label: string,
      change: (l: AwsLambdaCanarySettings) => AwsLambdaCanarySettings,
    ]
  > = [
    ["function", (l) => l.functionName("billing")],
    ["alias", (l) => l.alias("prod")],
  ];
  for (const [label, change] of changes) {
    for (const call of ["expose", "promote", "abort"] as const) {
      const { model, ctx } = await staged();
      model.calls = [];
      const lambda = platform(
        model,
        (l) => change(l.zipFile("dist/api.zip")),
      );
      await assertRejects(
        () =>
          call === "expose"
            ? lambda.expose(10, ctx).then(() => {})
            : call === "promote"
            ? lambda.promote(ctx)
            : lambda.abort(ctx),
        Error,
        `this rollout staged with the ${label}`,
      );
      assertEquals(model.calls, [], `${label} ${call}`);
    }
  }
  const { model, ctx } = await staged();
  model.calls = [];
  const other = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("dist/api.zip")
      .aws((a) => a.region("us-east-1").runner(model.runner))
  );
  await assertRejects(
    () => other.expose(10, ctx),
    Error,
    "this rollout staged with the AWS flags `--region eu-west-1`",
  );
  assertEquals(model.calls, []);
});

Deno.test("lambdaCanary: an alias the CLI now reaches in another region is neither moved nor rolled back", async () => {
  // No flags: the CLI's own default decides the region, as AWS_REGION does.
  const model = new LambdaModel();
  const lambda = lambdaCanary((l) =>
    l.functionName("api").alias("live").version("2")
      .aws((a) => a.runner(model.runner))
  );
  const ctx = context();
  await lambda.stage(ctx);
  await lambda.expose(10, ctx);
  model.defaultRegion = "us-east-1";
  model.functions["111111111111/us-east-1/api"] = {
    versions: { "2": "sha-2" },
    aliases: { live: { version: "3", weights: {}, revision: "r" } },
    latest: "",
  };
  for (const call of ["expose", "promote", "abort"] as const) {
    model.calls = [];
    const error = await assertRejects(
      () =>
        call === "expose"
          ? lambda.expose(50, ctx).then(() => {})
          : call === "promote"
          ? lambda.promote(ctx)
          : lambda.abort(ctx),
      Error,
      "the alias the AWS CLI reaches now is " +
        '"arn:aws:lambda:us-east-1:111111111111:function:api:live"',
    );
    assertStringIncludes(error.message, "This call changed nothing", call);
    assertEquals(model.mutations(), [], call);
  }
  // The staged alias keeps its share; the other one was never touched.
  assertEquals(model.live.weights, { "2": 0.1 });
  assertEquals(
    model.functions["111111111111/us-east-1/api"].aliases.live.weights,
    {},
  );
  assertEquals(lambda.describe(), "Lambda alias api:live");
});

Deno.test("lambdaCanary: an alias changed by someone else is not moved", async () => {
  const changes: ReadonlyArray<
    readonly [label: string, change: (m: LambdaModel) => void]
  > = [
    ["a new stable version", (m) => m.live.version = "2"],
    [
      "a new version and no routing",
      (m) => {
        m.live.version = "2";
        m.live.weights = {};
      },
    ],
    ["a foreign weight", (m) => m.live.weights = { "4": 0.1, "1": 0.2 }],
  ];
  for (const [label, change] of changes) {
    for (const call of ["expose", "promote"] as const) {
      const { model, ctx } = await staged();
      await platform(model).expose(10, ctx);
      change(model);
      model.calls = [];
      await assertRejects(
        () =>
          call === "expose"
            ? platform(model).expose(50, ctx).then(() => {})
            : platform(model).promote(ctx),
        Error,
        "something else changed it",
      );
      assertEquals(model.mutations(), [], `${label} ${call}`);
    }
  }
});

Deno.test("lambdaCanary: a candidate whose code changed is never sent traffic", async () => {
  for (const call of ["expose", "promote"] as const) {
    const { model, ctx } = await staged();
    // Deleted and created again: version numbers start over with other code.
    model.functions["111111111111/eu-west-1/api"].versions["4"] = "sha-other";
    model.calls = [];
    const error = await assertRejects(
      () =>
        call === "expose"
          ? platform(model).expose(10, ctx).then(() => {})
          : platform(model).promote(ctx),
      Error,
      "now has the code hash sha-other",
    );
    assertStringIncludes(error.message, "aws lambda update-alias", call);
    assertEquals(model.mutations(), [], call);
  }
});

Deno.test("lambdaCanary: an alias changed between the read and the update fails the update", async () => {
  const { model, ctx } = await staged();
  const run = model.runner;
  const racing = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("dist/api.zip")
      .aws((a) =>
        a.region("eu-west-1").runner((s) => {
          // Someone touches the alias just before the platform's update.
          if (s.argv().includes("update-alias")) model.live.revision = "rev-x";
          return run(s);
        })
      )
  );
  const error = await assertRejects(
    () => racing.expose(10, ctx),
    CommandError,
  );
  assertStringIncludes(error.message, "update-alias");
  assertEquals(model.live.weights, {});
});

Deno.test("lambdaCanary: a failed update fails the call even under noThrow", async () => {
  const { model, ctx } = await staged();
  const run = model.runner;
  const failing = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("dist/api.zip")
      .aws((a) =>
        a.region("eu-west-1").noThrow().runner((s) =>
          s.argv().includes("update-alias")
            ? Promise.resolve(new CommandOutput(254, "", "AccessDenied"))
            : run(s)
        )
      )
  );
  await assertRejects(() => failing.expose(10, ctx), CommandError);
  await platform(model).expose(10, ctx);
  await assertRejects(() => failing.abort(ctx), CommandError);
  assertEquals(model.live.weights, { "4": 0.1 });
});

Deno.test("lambdaCanary: an aws lambda that resolves differently per command runs nothing it disagrees with", async () => {
  const { model, ctx } = await staged();
  let calls = 0;
  const flaky = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("dist/api.zip")
      .aws((a) => {
        calls += 1;
        return a.region(calls > 1 ? "us-east-1" : "eu-west-1").runner(
          model.runner,
        );
      })
  );
  model.calls = [];
  await assertRejects(
    () => flaky.expose(10, ctx),
    Error,
    "gave this command other flags than the ones this call resolved",
  );
  assertEquals(model.calls, []);
});

Deno.test("lambdaCanary: flags checked are the flags the command runs with", async () => {
  // The lambda resolves the staged region until the publish, then another:
  // the publish is refused before it runs, so no other region is changed.
  const model = new LambdaModel();
  model.functions["111111111111/us-east-1/api"] = {
    versions: { "1": "sha-1" },
    aliases: {},
    latest: "sha-1",
  };
  let calls = 0;
  const flipping = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("new.zip")
      .aws((a) => {
        calls += 1;
        // 1: the call's own flags; 2: get-alias; 3: get-function (stable);
        // 4: the wait; 5: the publish.
        return a.region(calls === 5 ? "us-east-1" : "eu-west-1").runner(
          model.runner,
        );
      })
  );
  const ctx = context();
  await assertRejects(
    () => flipping.stage(ctx),
    Error,
    "gave this command other flags",
  );
  assertEquals(
    model.calls.some((argv) => argv[1] === "update-function-code"),
    false,
  );
  assertEquals(model.functions["111111111111/us-east-1/api"].latest, "sha-1");
  assertEquals(ctx.state.get().lambdaCanaryStage, "publishing");
});

Deno.test("lambdaCanary: a rollback takes only the candidate's weight off", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(10, ctx);
  // Another version was given a share after the stage — the rollback keeps it.
  model.live.weights = { "4": 0.1, "2": 0.05 };
  await platform(model).abort(ctx);
  assertEquals(model.live, {
    version: "3",
    weights: { "2": 0.05 },
    revision: model.live.revision,
  });
  // Run again, the candidate has no share left: the alias keeps its shape,
  // though the rollback still writes it — see the race below.
  await platform(model).abort(ctx);
  assertEquals(model.live.version, "3");
  assertEquals(model.live.weights, { "2": 0.05 });
});

Deno.test("lambdaCanary: a rollback writes the alias even with nothing to take back, so a racing expose cannot land after it", async () => {
  // A zuke cancel from another process rolls back while this rollout's
  // expose is between its read and its update: the update carries the
  // revision it read, and the rollback's write makes that revision stale.
  const { model, ctx } = await staged();
  const stale = model.live.revision;
  await platform(model).abort(ctx);
  assertEquals(model.live.revision === stale, false);
  const racing = model.run([
    "lambda",
    "update-alias",
    "--function-name=api",
    "--name=live",
    '--routing-config={"AdditionalVersionWeights":{"4":0.1}}',
    `--revision-id=${stale}`,
  ]);
  assertEquals(racing.code, 254);
  assertEquals(model.live.weights, {});
});

Deno.test("lambdaCanary: a rollback that loses a race to another write reads again and retries", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(10, ctx);
  const run = model.runner;
  let raced = 0;
  const racing = (times: number) =>
    lambdaCanary((l) =>
      l.functionName("api").alias("live").zipFile("dist/api.zip").aws((a) =>
        a.region("eu-west-1").runner((s) => {
          // The rollout's own expose lands just before the rollback's write.
          if (s.argv().includes("update-alias") && raced < times) {
            raced += 1;
            model.live.weights = { "4": 0.5 };
            model.live.revision = `raced-${raced}`;
          }
          return run(s);
        })
      )
    );
  await racing(2).abort(ctx);
  assertEquals(raced, 2);
  assertEquals(model.live.weights, {});
  // One that keeps losing gives up and says why.
  raced = 0;
  await platform(model).expose(10, ctx);
  const error = await assertRejects(() => racing(99).abort(ctx), CommandError);
  assertStringIncludes(error.message, "PreconditionFailedException");
  assertEquals(raced, 5);
});

Deno.test("lambdaCanary: a rollback clears the routing the candidate had alone", async () => {
  const { model, ctx } = await staged();
  await platform(model).expose(25, ctx);
  await platform(model).abort(ctx);
  assertEquals(model.live.weights, {});
  assertEquals(model.aliasUpdates().at(-1), [
    '--routing-config={"AdditionalVersionWeights":{}}',
  ]);
});

Deno.test("lambdaCanary: a rollback after the alias reached the candidate returns it to the stable version", async () => {
  const { model, ctx } = await staged();
  await platform(model).promote(ctx);
  await platform(model).abort(ctx);
  assertEquals(model.live.version, "3");
  assertEquals(model.live.weights, {});
});

Deno.test("lambdaCanary: a rollback never undoes a newer rollout built on the candidate", async () => {
  // Version 4 was promoted, and a newer rollout now canaries version 5 on it.
  const { model, ctx } = await staged();
  await platform(model).promote(ctx);
  model.functions["111111111111/eu-west-1/api"].versions["5"] = "sha-5";
  model.live.weights = { "5": 0.1 };
  model.calls = [];
  await assertRejects(
    () => platform(model).abort(ctx),
    Error,
    "a newer rollout built on it",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.live.version, "4");
  assertEquals(model.live.weights, { "5": 0.1 });
});

Deno.test("lambdaCanary: a rollback never returns the alias to a stable version whose code changed", async () => {
  // The function was deleted and created again: version 3 is other code now.
  const { model, ctx } = await staged();
  await platform(model).promote(ctx);
  model.functions["111111111111/eu-west-1/api"].versions["3"] = "sha-other";
  model.calls = [];
  await assertRejects(
    () => platform(model).abort(ctx),
    Error,
    "the stable version 3 of api now has the code hash sha-other",
  );
  assertEquals(model.mutations(), []);
  assertEquals(model.live.version, "4");
});

Deno.test("lambdaCanary: a rollback run by hand goes to the configured stable version", async () => {
  const model = new LambdaModel();
  model.live.weights = { "2": 0.3 };
  await platform(model, (l) => l.stable("2")).abort(context());
  assertEquals(model.live, { version: "2", weights: {}, revision: "rev-1" });
});

Deno.test("lambdaCanary: a rollback run by hand without a usable stable version refuses", async () => {
  const model = new LambdaModel();
  await assertRejects(
    () => platform(model).abort(context()),
    Error,
    "l.stable('<version>')",
  );
  await assertRejects(
    () => platform(model, (l) => l.stable("$LATEST")).abort(context()),
    Error,
    "is not a published version number",
  );
  assertEquals(model.calls, []);
});

Deno.test("lambdaCanary: promote needs a staged rollout", async () => {
  const model = new LambdaModel();
  await assertRejects(
    () => platform(model).promote(context()),
    Error,
    "no staged candidate is recorded",
  );
  assertEquals(model.calls, []);
});

Deno.test("lambdaCanary: expose refuses a share outside 0 to 100 and an unstaged rollout", async () => {
  const model = new LambdaModel();
  for (const percent of [-1, 101, Number.NaN]) {
    await assertRejects(
      () => platform(model).expose(percent, context()),
      Error,
      "a share from 0 to 100",
    );
  }
  await assertRejects(
    () => platform(model).expose(10, context()),
    Error,
    "the rollout's record is damaged",
  );
  assertEquals(model.calls, []);
});

Deno.test("lambdaCanary: names Lambda would not take are refused before any command", async () => {
  const bad: ReadonlyArray<
    readonly [
      label: string,
      configure: (l: AwsLambdaCanarySettings) => AwsLambdaCanarySettings,
      message: string,
    ]
  > = [
    ["no function", (l) => l.alias("live"), "l.functionName('api')"],
    [
      "an option-like function",
      (l) => l.functionName("--endpoint-url=x").alias("live"),
      "l.functionName('api')",
    ],
    ["no alias", (l) => l.functionName("api"), "l.alias('live')"],
    ["a numeric alias", (l) => l.functionName("api").alias("12"), "l.alias"],
  ];
  for (const [label, configure, message] of bad) {
    const model = new LambdaModel();
    const lambda = lambdaCanary((l) =>
      configure(l).version("2").aws((a) => a.runner(model.runner))
    );
    await assertRejects(() => lambda.stage(context()), Error, message);
    assertEquals(model.calls, [], label);
  }
  assertEquals(lambdaCanary((l) => l).describe(), "Lambda alias");
});

Deno.test("lambdaCanary: answers that are not what was asked for are refused", async () => {
  const answers: ReadonlyArray<readonly [stdout: string, message: string]> = [
    ["[]", "get-alias did not answer with an object"],
    ['{"arn":"a","revision":"r","weights":null}', "no FunctionVersion"],
    ['{"version":"3","revision":"r","weights":null}', "no AliasArn"],
    ['{"version":"3","arn":"a","weights":null}', "no RevisionId"],
    [
      '{"version":"3","arn":"a","revision":"r","weights":[1]}',
      "AdditionalVersionWeights that are not an object",
    ],
    [
      '{"version":"3","arn":"a","revision":"r","weights":{"4":"x"}}',
      "a weight for version 4 that is not a number",
    ],
  ];
  for (const [stdout, message] of answers) {
    const lambda = lambdaCanary((l) =>
      l.functionName("api").alias("live").version("2").aws((a) =>
        a.runner(() => Promise.resolve(new CommandOutput(0, stdout, "")))
      )
    );
    await assertRejects(
      () => lambda.stage(context()),
      AwsOutputError,
      message,
    );
  }
  const versions: ReadonlyArray<readonly [stdout: string, message: string]> = [
    ["null", "get-function did not answer with an object"],
    ['{"sha":"s"}', "get-function reported no Version"],
    ['{"version":"2"}', "get-function reported no CodeSha256"],
  ];
  for (const [stdout, message] of versions) {
    const model = new LambdaModel();
    const run = model.runner;
    const lambda = lambdaCanary((l) =>
      l.functionName("api").alias("live").version("2").aws((a) =>
        a.runner((s) =>
          s.argv().includes("get-function")
            ? Promise.resolve(new CommandOutput(0, stdout, ""))
            : run(s)
        )
      )
    );
    await assertRejects(
      () => lambda.stage(context()),
      AwsOutputError,
      message,
    );
  }
  const model = new LambdaModel();
  const run = model.runner;
  const lambda = lambdaCanary((l) =>
    l.functionName("api").alias("live").zipFile("a.zip")
      .aws((a) =>
        a.runner((s) =>
          s.argv().includes("update-function-code")
            ? Promise.resolve(new CommandOutput(0, '{"version":"4"}', ""))
            : run(s)
        )
      )
  );
  await assertRejects(
    () => lambda.stage(context()),
    AwsOutputError,
    "update-function-code reported no CodeSha256",
  );
});

Deno.test("lambdaCanary: with no .aws(...) it runs the aws CLI found on PATH", async () => {
  await withEmptyPath(async () => {
    const lambda = lambdaCanary((l) =>
      l.functionName("api").alias("live").version("2")
    );
    await assertRejects(() => lambda.stage(context()), ToolNotFoundError);
  });
});
