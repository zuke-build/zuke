// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import {
  SignPathApiError,
  SignPathRequestError,
  SignPathSigningError,
  type SignPathSubmitSettings,
  SignPathTasks,
  SignPathTimeoutError,
  SignPathValidationError,
} from "../mod.ts";
import {
  API,
  ARTIFACT_URL,
  connected,
  GH_TOKEN,
  ORG,
  REQUEST,
  routes,
  type SentRequest,
  status,
  STATUS_URL,
  TOKEN,
  WEB_URL,
} from "./_fetch.ts";

/** The direct-upload endpoint. */
const SUBMIT_URL = `${API}/SigningRequests/SubmitWithArtifact`;

/** SignPath's hosted GitHub connector endpoint for {@link ORG}. */
const CONNECTOR_URL =
  `https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom/${ORG}/SigningRequests?api-version=1.0`;

/** A `201 Created` naming {@link REQUEST}. */
const created = () =>
  new Response(null, {
    status: 201,
    headers: { location: `${API}/SigningRequests/${REQUEST}` },
  });

/** The GitHub workflow environment. */
const GITHUB_ENV = new Map([
  ["GITHUB_RUN_ID", "1234567890"],
  ["GITHUB_REPOSITORY", "zuke-build/zuke"],
  ["GITHUB_TOKEN", GH_TOKEN],
]);

/** A temp file holding `content`, the artifact to sign. */
async function artifact(content = "MZ unsigned"): Promise<string> {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/zuke.exe`;
  await Deno.writeTextFile(path, content);
  return path;
}

/** An artifact most tests upload. */
const path = await artifact();

Deno.test("submit: uploads the artifact, waits, and downloads the signed file", async () => {
  const output = `${await Deno.makeTempDir()}/signed/zuke.exe`;
  const net = routes({
    [`POST ${SUBMIT_URL}`]: [created],
    [`GET ${STATUS_URL}`]: [
      status("InProgress"),
      status("InProgress"),
      status("Completed"),
    ],
    [`GET ${ARTIFACT_URL}`]: [() => new Response("MZ signed")],
  });
  const lines: string[] = [];
  const sleeps: number[] = [];
  const result = await SignPathTasks.submit((s) =>
    connected<SignPathSubmitSettings>(net, { lines, sleeps })(s)
      .projectSlug("zuke").signingPolicySlug("release-signing")
      .artifactConfigurationSlug("exe").description("v1.2.3")
      .parameter("version", "1.2.3").artifact(path).pollInterval("5s")
      .output(output)
  );
  assertEquals(result.signingRequestId, REQUEST);
  assertEquals(result.webUrl, WEB_URL);
  assertEquals(result.status.status, "Completed");
  assertEquals(result.signedArtifact, { path: output, bytes: 9 });
  assertEquals(await Deno.readTextFile(output), "MZ signed");
  assertEquals(sleeps, [5000, 5000]);
  assertEquals(lines, [
    `SignPath: submitted signing request ${REQUEST} — ${WEB_URL}`,
    `SignPath: signing request ${REQUEST} is InProgress`,
    `SignPath: signing request ${REQUEST} is Completed`,
    `SignPath: wrote the signed artifact to ${output} (9 bytes)`,
  ]);
  const form = net.sent[0].form;
  assertEquals(form?.get("projectSlug"), "zuke");
  assertEquals(form?.get("signingPolicySlug"), "release-signing");
  assertEquals(form?.get("artifactConfigurationSlug"), "exe");
  assertEquals(form?.get("description"), "v1.2.3");
  assertEquals(form?.get("parameters.version"), "1.2.3");
  const file = form?.get("artifact");
  assertEquals(file instanceof File && file.name, "zuke.exe");
  assertEquals(
    file instanceof File ? await file.text() : undefined,
    "MZ unsigned",
  );
  for (const sent of net.sent) {
    assertEquals(sent.headers.get("authorization"), `Bearer ${TOKEN}`);
  }
});

Deno.test("submit: without an output it only waits, and omits unset form fields", async () => {
  const net = routes({
    [`POST ${SUBMIT_URL}`]: [() =>
      new Response(null, {
        status: 201,
        headers: { location: `/Api/v1/${ORG}/SigningRequests/${REQUEST}` },
      })],
    [`GET ${STATUS_URL}`]: [status("Completed")],
  });
  const result = await SignPathTasks.submit((s) =>
    connected<SignPathSubmitSettings>(net)(s).projectSlug("zuke")
      .signingPolicySlug("test").artifactConfigurationSlug("").description("")
      .artifact(path)
  );
  assertEquals(result.signedArtifact, undefined);
  const form = net.sent[0].form;
  assertEquals(form?.has("artifactConfigurationSlug"), false);
  assertEquals(form?.has("description"), false);
  assertEquals(net.sent.length, 2);
});

Deno.test("submit: a submission without a usable Location is a request error", async () => {
  for (
    const location of [
      undefined,
      "https://app.signpath.io/Api/v1/x/SigningRequests/not-a-guid",
      "http://[bad",
    ]
  ) {
    const net = routes({
      [`POST ${SUBMIT_URL}`]: [() =>
        new Response(null, {
          status: 201,
          headers: location === undefined ? {} : { location },
        })],
    });
    await assertRejects(
      async () =>
        await SignPathTasks.submit((s) =>
          connected<SignPathSubmitSettings>(net)(s).projectSlug("p")
            .signingPolicySlug("q").artifact(path)
        ),
      SignPathRequestError,
      "Location",
    );
  }
});

Deno.test("submit: a refused upload is an API error and is not waited on", async () => {
  const net = routes({
    [`POST ${SUBMIT_URL}`]: [
      () => Response.json({ error: "Unknown project slug" }, { status: 400 }),
    ],
  });
  await assertRejects(
    () =>
      SignPathTasks.submit((s) =>
        connected<SignPathSubmitSettings>(net)(s).projectSlug("nope")
          .signingPolicySlug("q").artifact(path)
      ),
    SignPathApiError,
    "Unknown project slug",
  );
  assertEquals(net.sent.length, 1);
});

Deno.test("submit: a POST is retried only on 429 and 503, never on a network error", async () => {
  const busy = routes({
    [`POST ${SUBMIT_URL}`]: [
      () => new Response("", { status: 429 }),
      () => new Response("", { status: 503 }),
      created,
    ],
    [`GET ${STATUS_URL}`]: [status("Completed")],
  });
  await SignPathTasks.submit((s) =>
    connected<SignPathSubmitSettings>(busy)(s).projectSlug("p")
      .signingPolicySlug("q").artifact(path)
  );
  assertEquals(busy.sent.filter((r) => r.method === "POST").length, 3);
  const gateway = routes({
    [`POST ${SUBMIT_URL}`]: [() => new Response("", { status: 502 })],
  });
  await assertRejects(
    () =>
      SignPathTasks.submit((s) =>
        connected<SignPathSubmitSettings>(gateway)(s).projectSlug("p")
          .signingPolicySlug("q").artifact(path)
      ),
    SignPathApiError,
    "HTTP 502",
  );
  assertEquals(gateway.sent.length, 1);
  let calls = 0;
  const reset = routes({
    [`POST ${SUBMIT_URL}`]: [() => {
      calls++;
      throw new TypeError("connection reset");
    }],
  });
  await assertRejects(
    () =>
      SignPathTasks.submit((s) =>
        connected<SignPathSubmitSettings>(reset)(s).projectSlug("p")
          .signingPolicySlug("q").artifact(path)
      ),
    SignPathRequestError,
    "connection reset",
  );
  assertEquals(calls, 1);
});

Deno.test("submit: a missing artifact file is reported by path before anything is sent", async () => {
  const net = routes({});
  await assertRejects(
    () =>
      SignPathTasks.submit((s) =>
        connected<SignPathSubmitSettings>(net)(s).projectSlug("p")
          .signingPolicySlug("q").artifact("/no/such/zuke.exe")
      ),
    Error,
    "could not read the artifact to sign, /no/such/zuke.exe",
  );
  assertEquals(net.sent.length, 0);
});

Deno.test("submit: settings are validated before anything is sent", async () => {
  const net = routes({});
  const base = connected<SignPathSubmitSettings>(net);
  const cases: Array<
    [(s: SignPathSubmitSettings) => SignPathSubmitSettings, string]
  > = [
    [(s) => s.signingPolicySlug("q").artifact(path), "s.projectSlug(...)"],
    [(s) => s.projectSlug("p").artifact(path), "s.signingPolicySlug(...)"],
    [(s) => s.projectSlug("p").signingPolicySlug("q"), "needs an artifact"],
    [
      (s) =>
        s.projectSlug("p").signingPolicySlug("q").artifact(path)
          .gitHubOrigin((g) => g.artifactId(1)),
      "takes one artifact source",
    ],
    [
      (s) =>
        s.projectSlug("p").signingPolicySlug("q").artifact(path)
          .parameter("bad name", "x"),
      'parameter name "bad name"',
    ],
    [
      (s) =>
        s.projectSlug("p").signingPolicySlug("q").artifact(path).output(""),
      "s.output(...)",
    ],
  ];
  for (const [configure, message] of cases) {
    await assertRejects(
      () => SignPathTasks.submit((s) => configure(base(s))),
      Error,
      message,
    );
  }
  assertEquals(net.sent.length, 0);
});

/** Submit through the GitHub connector with `configure`, against `net`. */
function viaGitHub(
  net: typeof fetch,
  configure: (s: SignPathSubmitSettings) => SignPathSubmitSettings = (s) =>
    s.gitHubOrigin((g) => g.artifactId(42)),
  env: Map<string, string> = GITHUB_ENV,
) {
  return SignPathTasks.submit((s) =>
    configure(
      connected<SignPathSubmitSettings>(net, { env })(s).projectSlug("zuke")
        .signingPolicySlug("release-signing"),
    )
  );
}

/** The connector's success answer. */
const accepted = () =>
  Response.json({
    signingRequestId: REQUEST,
    signingRequestUrl: "https://evil.example/not-used",
    validationResult: { errors: [] },
    logs: [{ level: "Information", message: "ok" }],
  });

Deno.test("submit: a GitHub origin goes through the connector with the run's context", async () => {
  const net = routes({
    [`POST ${CONNECTOR_URL}`]: [accepted],
    [`GET ${STATUS_URL}`]: [status("Completed")],
  });
  const result = await viaGitHub(
    net,
    (s) =>
      s.artifactConfigurationSlug("zip").parameter("version", "1.2.3")
        .gitHubOrigin((g) => g.artifactId(42)),
  );
  assertEquals(result.webUrl, WEB_URL);
  const [sent] = net.sent;
  assertEquals(sent.headers.get("authorization"), `Bearer ${TOKEN}`);
  assertEquals(sent.headers.get("content-type"), "application/json");
  assertEquals(JSON.parse(sent.text), {
    artifactId: "42",
    gitHubWorkflowRunId: "1234567890",
    gitHubRepository: "zuke-build/zuke",
    gitHubToken: GH_TOKEN,
    signPathProjectSlug: "zuke",
    signPathSigningPolicySlug: "release-signing",
    signPathArtifactConfigurationSlug: "zip",
    parameters: [{ name: "version", value: "1.2.3" }],
  });
});

Deno.test("submit: explicit GitHub settings win over the environment", async () => {
  const net = routes({
    [`POST https://connector.internal/GitHub/${ORG}/SigningRequests?api-version=1.0`]:
      [accepted],
    [`GET ${STATUS_URL}`]: [status("Completed")],
  });
  await viaGitHub(
    net,
    (s) =>
      s.gitHubOrigin((g) =>
        g.artifactId("7").runId(99).repository("me/fork").token(
          "fake-other-token",
        )
          .connectorUrl("https://connector.internal/GitHub/?x=1")
      ),
    new Map(),
  );
  const body = JSON.parse(net.sent[0].text);
  assertEquals(
    [body.artifactId, body.gitHubWorkflowRunId, body.gitHubRepository],
    ["7", "99", "me/fork"],
  );
  assertEquals(body.gitHubToken, "fake-other-token");
  assertEquals("signPathArtifactConfigurationSlug" in body, false);
});

Deno.test("submit: origin validation errors are listed, scrubbed of both tokens", async () => {
  const net = routes({
    [`POST ${CONNECTOR_URL}`]: [() =>
      Response.json({
        error: "Build system validation failed",
        validationResult: {
          errors: [
            {
              error: `Job 'build' ran on a self-hosted runner (${GH_TOKEN})`,
              howToFix: `Use a GitHub-hosted runner, ${TOKEN}`,
            },
            { error: "Artifact not found" },
            {},
            "junk",
          ],
        },
      }, { status: 400 })],
  });
  const error = await assertRejects(
    () => viaGitHub(net),
    SignPathValidationError,
    "self-hosted runner",
  );
  assertEquals(error.message.includes(GH_TOKEN), false);
  assertEquals(error.message.includes(TOKEN), false);
  assertStringIncludes(error.message, "(fix: Use a GitHub-hosted runner");
  assertStringIncludes(error.message, "- Artifact not found\n");
  assertStringIncludes(error.message, "(no description)");
  assertEquals(
    error instanceof SignPathValidationError && error.issues.length,
    3,
  );
});

Deno.test("submit: a connector refusal or a foreign answer is reported plainly", async () => {
  const refused = routes({
    [`POST ${CONNECTOR_URL}`]: [() =>
      Response.json({
        error: `bad token ${GH_TOKEN}`,
        validationResult: null,
      }, { status: 401 })],
  });
  const error = await assertRejects(
    () => viaGitHub(refused),
    SignPathApiError,
    "bad token",
  );
  assertEquals(error.message.includes(GH_TOKEN), false);
  for (
    const body of [
      "<html>proxy</html>",
      JSON.stringify({ hello: 1 }),
      JSON.stringify({ signingRequestId: "x", validationResult: {} }),
    ]
  ) {
    const foreign = routes({
      [`POST ${CONNECTOR_URL}`]: [() => new Response(body)],
    });
    await assertRejects(
      () => viaGitHub(foreign),
      SignPathRequestError,
      "is the connector URL SignPath's GitHub Actions connector?",
    );
  }
});

Deno.test("submit: the GitHub context is validated before anything is sent", async () => {
  const net = routes({});
  const env = (entries: Array<[string, string]>) =>
    new Map([...GITHUB_ENV, ...entries]);
  const cases: Array<
    [
      (s: SignPathSubmitSettings) => SignPathSubmitSettings,
      Map<string, string>,
      string,
    ]
  > = [
    [
      (s) => s.gitHubOrigin((g) => g),
      GITHUB_ENV,
      "artifact id for SignPath is missing",
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId("1e3")),
      GITHUB_ENV,
      "not a number",
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId(1)),
      env([["GITHUB_RUN_ID", ""]]),
      "workflow run id for SignPath is missing",
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId(1)),
      env([["GITHUB_REPOSITORY", "no-slash"]]),
      'not "owner/name"',
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId(1)),
      env([["GITHUB_REPOSITORY", ""]]),
      "repository for SignPath is missing",
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId(1)),
      env([["GITHUB_TOKEN", ""]]),
      "GitHub token is missing",
    ],
    [
      (s) => s.gitHubOrigin((g) => g.artifactId(1).token("a b")),
      GITHUB_ENV,
      "GitHub token contains whitespace",
    ],
    [
      (s) =>
        s.gitHubOrigin((g) => g.artifactId(1).connectorUrl("ftp://connector")),
      GITHUB_ENV,
      "must be an https URL",
    ],
  ];
  for (const [configure, environment, message] of cases) {
    await assertRejects(
      () => viaGitHub(net, configure, environment),
      Error,
      message,
    );
  }
  await assertRejects(
    () =>
      viaGitHub(
        net,
        (s) =>
          s.gitHubOrigin((g) =>
            g.artifactId(1).connectorUrl("http://connector.internal")
          ),
      ),
    InsecureBackendUrlError,
  );
  assertEquals(net.sent.length, 0);
});

/** Run a submission whose status polls answer `answers`, recording sleeps. */
function waitWith(
  answers: Array<(request: SentRequest) => Response>,
  sleeps: number[],
  configure: (s: SignPathSubmitSettings) => SignPathSubmitSettings = (s) => s,
) {
  const net = routes({
    [`POST ${SUBMIT_URL}`]: [created],
    [`GET ${STATUS_URL}`]: answers,
  });
  return SignPathTasks.submit((s) =>
    configure(
      connected<SignPathSubmitSettings>(net, { sleeps })(s).projectSlug("p")
        .signingPolicySlug("q").artifact(path),
    )
  );
}

Deno.test("submit: every final status but Completed is a signing error naming the request", async () => {
  for (const final of ["Denied", "Failed", "Canceled"]) {
    const error = await assertRejects(
      () => waitWith([status("WaitingForApproval"), status(final)], []),
      SignPathSigningError,
      `${REQUEST} ended ${final} instead of Completed — see ${WEB_URL}`,
    );
    assertEquals(
      error instanceof SignPathSigningError && error.status,
      final,
    );
  }
  const scan = await assertRejects(
    () =>
      waitWith(
        [status("Failed", { workflowStatus: "MalwareDetected" })],
        [],
      ),
    SignPathSigningError,
    "ended Failed (MalwareDetected)",
  );
  assertEquals(
    scan instanceof SignPathSigningError && scan.workflowStatus,
    "MalwareDetected",
  );
});

Deno.test("submit: the wait ends at the deadline with a timeout naming the request", async () => {
  const sleeps: number[] = [];
  const error = await assertRejects(
    () =>
      waitWith(
        [status("WaitingForApproval")],
        sleeps,
        (s) => s.timeout("25s").pollInterval("10s"),
      ),
    SignPathTimeoutError,
    `${REQUEST} was still WaitingForApproval after 25000 ms — see ${WEB_URL}`,
  );
  assertEquals(sleeps, [10000, 10000, 5000]);
  assertEquals(
    error instanceof SignPathTimeoutError && error.timeoutMs,
    25000,
  );
});

Deno.test("submit: a lasting status failure ends the wait with its error", async () => {
  await assertRejects(
    () => waitWith([() => new Response("gone", { status: 404 })], []),
    SignPathApiError,
    "HTTP 404",
  );
});

Deno.test("submit: a flood of validation errors is capped", async () => {
  // Regression (adversarial review): the list was unbounded.
  const net = routes({
    [`POST ${CONNECTOR_URL}`]: [() =>
      Response.json({
        validationResult: {
          errors: Array.from({ length: 500 }, (_, i) => ({ error: `e${i}` })),
        },
      }, { status: 400 })],
  });
  const error = await assertRejects(
    () => viaGitHub(net),
    SignPathValidationError,
  );
  assertEquals(
    error instanceof SignPathValidationError && error.issues.length,
    20,
  );
});
