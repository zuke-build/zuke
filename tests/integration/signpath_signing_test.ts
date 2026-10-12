// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a real build signs a Windows binary through SignPath, driven
 * through the CLI `main()`. The signing target submits a GitHub-origin request
 * with the token from a secret parameter, waits through an approval and
 * downloads the signed file; a later target reads the request's status. One
 * injected `fetch` answers every SignPath call. A denied request fails the
 * build naming the request and its web page, and a SignPath answer that
 * echoes the API token back never gets it printed — even when the token is a
 * plain string the build's own redactor knows nothing about.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, parameter, target } from "../../packages/core/mod.ts";
import {
  type SignPathConnectionSettings,
  SignPathTasks,
} from "../../packages/signpath/mod.ts";
import {
  ARTIFACT_URL,
  ORG,
  REQUEST,
  routes,
  status,
  STATUS_URL,
  TOKEN,
  WEB_URL,
} from "../../packages/signpath/tests/_fetch.ts";
import { runCli, withoutMaskDirectives } from "./_harness.ts";

/** SignPath's hosted GitHub connector endpoint for {@link ORG}. */
const CONNECTOR =
  `https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom/${ORG}/SigningRequests?api-version=1.0`;

/** The workflow environment the build runs in. */
const ENV = new Map([
  ["GITHUB_RUN_ID", "4242"],
  ["GITHUB_REPOSITORY", "zuke-build/zuke"],
  ["GITHUB_TOKEN", "fake-workflow-token"],
]);

/** How SignPath answers the final status poll. */
let finalStatus = "Completed";

/** Every request the build sends. */
let net = server();

/** One fake for the connector and the REST API. */
function server() {
  return routes({
    [`POST ${CONNECTOR}`]: [() =>
      Response.json({
        signingRequestId: REQUEST,
        validationResult: { errors: [] },
      })],
    [`GET ${STATUS_URL}`]: [
      status("InProgress"),
      status("WaitingForApproval"),
      status(finalStatus),
    ],
    [`GET ${ARTIFACT_URL}`]: [() => new Response("MZ signed by SignPath")],
  });
}

/** Where the signed binary lands. */
const dir = await Deno.makeTempDir();
const output = `${dir}/signed/zuke.exe`;

/** The seams every call shares. */
const seams = <S extends SignPathConnectionSettings>(s: S): S =>
  s.fetch(net).readEnv((name) => ENV.get(name)).sleep(() => Promise.resolve())
    .organizationId(ORG);

/** The statuses the build read. */
const seen: string[] = [];

class Release extends Build {
  signpathToken = parameter("SignPath API token").secret().required();

  sign = target().description("sign the Windows binary").executes(async () => {
    await SignPathTasks.submit((s) =>
      seams(s).apiToken(this.signpathToken.value).projectSlug("zuke")
        .signingPolicySlug("release-signing")
        .gitHubOrigin((g) => g.artifactId(17)).output(output)
    );
  });

  check = target().dependsOn(this.sign).executes(async () => {
    const result = await SignPathTasks.status((s) =>
      seams(s).apiToken(this.signpathToken.value).signingRequestId(REQUEST)
    );
    seen.push(result.status);
  });
}

Deno.test("a build signs through SignPath with GitHub origin verification", async () => {
  finalStatus = "Completed";
  net = server();
  seen.length = 0;
  const { code, out, err } = await runCli(Release, [
    "check",
    "--signpath-token",
    TOKEN,
  ]);
  assertEquals(code, 0, err);
  assertEquals(await Deno.readTextFile(output), "MZ signed by SignPath");
  assertEquals(seen, ["Completed"]);
  assertStringIncludes(
    out,
    `submitted signing request ${REQUEST} — ${WEB_URL}`,
  );
  assertStringIncludes(out, `signing request ${REQUEST} is WaitingForApproval`);
  const body = JSON.parse(net.sent[0].text);
  assertEquals(
    [body.artifactId, body.gitHubWorkflowRunId, body.gitHubRepository],
    ["17", "4242", "zuke-build/zuke"],
  );
  assertEquals(
    net.sent.every((r) => r.headers.get("authorization") === `Bearer ${TOKEN}`),
    true,
  );
  assertEquals(withoutMaskDirectives(out + err).includes(TOKEN), false);
});

Deno.test("a denied signing request fails the build, naming it and its page", async () => {
  finalStatus = "Denied";
  net = server();
  const { code, out, err } = await runCli(Release, [
    "sign",
    "--signpath-token",
    TOKEN,
  ]);
  assertEquals(code, 1);
  assertStringIncludes(
    out + err,
    `SignPath signing request ${REQUEST} ended Denied instead of Completed — see ${WEB_URL}`,
  );
});

Deno.test("a SignPath answer echoing the token never gets it printed", async () => {
  class Leaky extends Build {
    sign = target().executes(async () => {
      await SignPathTasks.status((s) =>
        s.fetch(() =>
          Promise.resolve(
            Response.json({ error: `token ${TOKEN} has expired` }, {
              status: 401,
            }),
          )
        ).organizationId(ORG).apiToken(TOKEN).signingRequestId(REQUEST)
      );
    });
  }
  const { code, out, err } = await runCli(Leaky, ["sign"]);
  assertEquals(code, 1);
  assertStringIncludes(out + err, "HTTP 401: token [redacted] has expired");
  assertEquals((out + err).includes(TOKEN), false);
});
