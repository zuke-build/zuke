// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: the AWS credential source — the region, the credential chain in
 * order (explicit key, profile, environment, shared files, web identity, the
 * container endpoint, IMDSv2), each endpoint's exact requests, caching,
 * the endpoint and path guards, and every failure scrubbed.
 *
 * Keys are AWS's documented placeholders (`AKIDEXAMPLE`-style), never real.
 */

// cspell:ignore AKIDCI AKIDDEFAULT AKIDDEV AKIDFROMCONFIG AKIDHALF AKIDOTHER AKIDSTAGING ASIDEXAMPLETEMP

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "../../core/tests/_assert.ts";
import { InsecureBackendUrlError } from "@zuke/core";
import {
  PrometheusAwsSettings,
  type PrometheusOutgoingRequest,
  PrometheusTasks,
} from "../mod.ts";
import { sigv4Credentials } from "../src/aws.ts";
import { signSigV4 } from "../src/aws_sigv4.ts";
import {
  type Clock,
  context,
  form,
  REQUEST,
  routes,
  type Seams,
  T0,
} from "./_auth.ts";
import { fakeFetch, vector } from "./_fetch.ts";

const ID = "AKIDEXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const TEMP_ID = "ASIDEXAMPLETEMP";
const TEMP_SECRET = "tempSecretEXAMPLEKEYtempSecretEXAMPLE";
const SESSION = "sessionTokenEXAMPLEsessionTokenEXAMPLE";

/** Run the AWS source once. */
async function headers(
  seams: Seams,
  configure: (a: PrometheusAwsSettings) => PrometheusAwsSettings = (a) => a,
  request: PrometheusOutgoingRequest = REQUEST,
) {
  return await sigv4Credentials(configure(new PrometheusAwsSettings()))(
    request,
    context(seams),
  );
}

/** The Credential= part of an Authorization header. */
function credentialOf(authorization: string | undefined): string {
  return /Credential=([^,]+)/.exec(authorization ?? "")?.[1] ?? "";
}

/** An ECS / IMDS credentials answer. */
const temporary = (expiration = "2026-01-01T06:00:00Z") => () =>
  Response.json({
    Code: "Success",
    Type: "AWS-HMAC",
    AccessKeyId: TEMP_ID,
    SecretAccessKey: TEMP_SECRET,
    Token: SESSION,
    Expiration: expiration,
  });

Deno.test("environment keys sign the exact request for aps in the region", async () => {
  const env = {
    AWS_ACCESS_KEY_ID: ID,
    AWS_SECRET_ACCESS_KEY: SECRET,
    AWS_REGION: "eu-west-1",
  };
  const sent = await headers({ env });
  const expected = await signSigV4(
    REQUEST,
    { accessKeyId: ID, secretAccessKey: SECRET },
    "eu-west-1",
    "aps",
    T0,
  );
  assertEquals(sent, expected.headers);
  assertEquals(
    credentialOf(sent.authorization),
    `${ID}/20260101/eu-west-1/aps/aws4_request`,
  );
  assertStringIncludes(
    sent.authorization ?? "",
    "SignedHeaders=accept;host;x-amz-date,",
  );
  const withToken = await headers({
    env: { ...env, AWS_SESSION_TOKEN: SESSION },
  });
  assertEquals(withToken["x-amz-security-token"], SESSION);
});

Deno.test("the region comes from the setting, AWS_REGION, then AWS_DEFAULT_REGION", async () => {
  const keys = { AWS_ACCESS_KEY_ID: ID, AWS_SECRET_ACCESS_KEY: SECRET };
  const cases: Array<
    [
      Record<string, string>,
      (a: PrometheusAwsSettings) => PrometheusAwsSettings,
      string,
    ]
  > = [
    [
      { AWS_REGION: "us-west-2" },
      (a) => a.region("ap-southeast-2"),
      "ap-southeast-2",
    ],
    [
      { AWS_REGION: "us-west-2", AWS_DEFAULT_REGION: "eu-central-1" },
      (a) => a,
      "us-west-2",
    ],
    [
      { AWS_REGION: "", AWS_DEFAULT_REGION: "eu-central-1" },
      (a) => a,
      "eu-central-1",
    ],
  ];
  for (const [env, configure, region] of cases) {
    const sent = await headers({ env: { ...keys, ...env } }, configure);
    assertStringIncludes(credentialOf(sent.authorization), `/${region}/aps/`);
  }
  await assertRejects(
    () => headers({ env: keys }),
    Error,
    "aws: SigV4 needs a region",
  );
  for (const region of ["us-east-1.evil.example/", "US-EAST-1", "a b", "-x"]) {
    await assertRejects(
      () => headers({ env: keys }, (a) => a.region(region)),
      Error,
      "aws: the region must be lower-case letters, digits and '-'",
    );
  }
});

Deno.test("accessKey(...) wins over everything and refuses an empty secret", async () => {
  const sent = await headers(
    { env: { AWS_ACCESS_KEY_ID: "AKIDOTHER", AWS_SECRET_ACCESS_KEY: "x" } },
    (a) => a.region("us-east-1").accessKey(ID, SECRET, SESSION),
  );
  assertEquals(credentialOf(sent.authorization).split("/")[0], ID);
  assertEquals(sent["x-amz-security-token"], SESSION);
  const plain = await headers(
    {},
    (a) => a.region("us-east-1").accessKey(ID, SECRET),
  );
  assertEquals(plain["x-amz-security-token"], undefined);
  let message = "";
  try {
    new PrometheusAwsSettings().accessKey(ID, "");
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assertStringIncludes(message, "an empty key id or secret");
});

Deno.test("profile(...) reads static keys from the shared files, credentials winning", async () => {
  const files = {
    "/home/dev/.aws/config": [
      "# comment",
      "[default]",
      "region = us-east-1",
      "[profile prod]",
      "aws_access_key_id = AKIDFROMCONFIG",
      "aws_secret_access_key = config-secret",
      "s3 =",
      "  max_concurrent_requests = 10",
    ].join("\n"),
    "/home/dev/.aws/credentials": [
      "; comment",
      "stray = outside any section",
      "[prod]",
      `aws_access_key_id = ${ID}`,
      `aws_secret_access_key = ${SECRET}`,
      `aws_session_token = ${SESSION}`,
      "[config-only]",
    ].join("\r\n"),
  };
  const sent = await headers(
    { env: { HOME: "/home/dev", AWS_REGION: "us-east-1" }, files },
    (a) => a.profile("prod"),
  );
  assertEquals(credentialOf(sent.authorization).split("/")[0], ID);
  assertEquals(sent["x-amz-security-token"], SESSION);
  const fromConfig = await headers(
    {
      env: { USERPROFILE: "C:/Users/dev", AWS_REGION: "us-east-1" },
      files: {
        "C:/Users/dev/.aws/config":
          "[profile staging]\naws_access_key_id=AKIDSTAGING\naws_secret_access_key=s\naws_session_token=",
      },
    },
    (a) => a.profile("staging"),
  );
  assertEquals(
    credentialOf(fromConfig.authorization).split("/")[0],
    "AKIDSTAGING",
  );
  assertEquals(fromConfig["x-amz-security-token"], undefined);
  const overridden = await headers(
    {
      env: {
        AWS_SHARED_CREDENTIALS_FILE: "/ci/creds",
        AWS_CONFIG_FILE: "/ci/config",
        AWS_REGION: "us-east-1",
      },
      files: {
        "/ci/creds": `[ci]\naws_access_key_id=AKIDCI\naws_secret_access_key=s`,
      },
    },
    (a) => a.profile("ci"),
  );
  assertEquals(credentialOf(overridden.authorization).split("/")[0], "AKIDCI");
});

Deno.test("a profile that is missing, half a key, or not static keys is refused", async () => {
  const env = { HOME: "/h", AWS_REGION: "us-east-1" };
  const cases: Array<[Record<string, string>, string, string]> = [
    [{}, "prod", 'aws: profile "prod" has no static keys'],
    [
      { "/h/.aws/config": "[profile prod]\nregion=us-east-1" },
      "prod",
      'profile "prod" has no static keys',
    ],
    [
      {
        "/h/.aws/config":
          "[profile prod]\nrole_arn=arn:aws:iam::1:role/r\nsource_profile=default",
      },
      "prod",
      'aws: profile "prod" gets its credentials through role_arn, which is not supported',
    ],
    [
      { "/h/.aws/config": "[profile prod]\nsso_session=corp" },
      "prod",
      "through sso_session",
    ],
    [
      { "/h/.aws/credentials": "[prod]\naws_access_key_id=AKIDHALF" },
      "prod",
      "needs both aws_access_key_id and aws_secret_access_key",
    ],
    [
      {
        "/h/.aws/credentials":
          "[prod]\naws_secret_access_key=only-secret-value",
      },
      "prod",
      "needs both aws_access_key_id",
    ],
  ];
  for (const [files, profile, message] of cases) {
    const error = await assertRejects(
      () => headers({ env, files }, (a) => a.profile(profile)),
      Error,
      message,
    );
    assertEquals(error.message.includes("only-secret-value"), false);
  }
  await assertRejects(
    () =>
      headers({ env: { AWS_REGION: "us-east-1" } }, (a) => a.profile("prod")),
    Error,
    'profile "prod" has no static keys',
  );
  const denied = {
    ...context({ env }),
    readTextFile: () => Promise.reject(new Error("permission denied")),
  };
  await assertRejects(
    async () =>
      await sigv4Credentials(new PrometheusAwsSettings().profile("p"))(
        REQUEST,
        denied,
      ),
    Error,
    "aws: could not read the shared file at /h/.aws/config: permission denied",
  );
  const odd = {
    ...context({ env }),
    readTextFile: () => Promise.reject("denied"),
  };
  await assertRejects(
    async () =>
      await sigv4Credentials(new PrometheusAwsSettings().profile("p"))(
        REQUEST,
        odd,
      ),
    Error,
    "/h/.aws/config: denied",
  );
});

Deno.test("the default chain reads AWS_PROFILE, else a [default] with keys", async () => {
  const files = {
    "/h/.aws/credentials":
      `[default]\naws_access_key_id=AKIDDEFAULT\naws_secret_access_key=s\n[dev]\naws_access_key_id=AKIDDEV\naws_secret_access_key=s`,
  };
  const env = { HOME: "/h", AWS_REGION: "us-east-1" };
  const byDefault = await headers({ env, files });
  assertEquals(
    credentialOf(byDefault.authorization).split("/")[0],
    "AKIDDEFAULT",
  );
  const named = await headers({ env: { ...env, AWS_PROFILE: "dev" }, files });
  assertEquals(credentialOf(named.authorization).split("/")[0], "AKIDDEV");
  await assertRejects(
    () => headers({ env: { ...env, AWS_PROFILE: "gone" }, files }),
    Error,
    'aws: AWS_PROFILE names "gone", which has no static keys',
  );
});

Deno.test("web identity assumes the role at the regional STS endpoint", async () => {
  const clock: Clock = { now: T0 };
  const sts = "https://sts.us-west-2.amazonaws.com/";
  const fetcher = routes({
    [`POST ${sts}`]: () =>
      new Response(
        `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <AccessKeyId>${TEMP_ID}</AccessKeyId>
      <SecretAccessKey>${TEMP_SECRET}</SecretAccessKey>
      <SessionToken>${SESSION}&amp;more</SessionToken>
      <Expiration>2026-01-01T01:00:00Z</Expiration>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`,
        { headers: { "content-type": "text/xml" } },
      ),
  });
  const seams: Seams = {
    env: {
      AWS_REGION: "us-west-2",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/eks/token",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/prometheus-reader",
      HOME: "/h",
    },
    files: {
      "/var/run/secrets/eks/token": "oidc-web-identity-token\n",
      "/h/.aws/config": "[default]\nregion=us-west-2",
    },
    fetch: fetcher,
    clock,
  };
  const sent = await headers(seams);
  assertEquals(credentialOf(sent.authorization).split("/")[0], TEMP_ID);
  assertEquals(sent["x-amz-security-token"], `${SESSION}&more`);
  assertEquals(form(fetcher.sent[0].body), {
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: "arn:aws:iam::123456789012:role/prometheus-reader",
    RoleSessionName: `zuke-${T0 / 1000}`,
    WebIdentityToken: "oidc-web-identity-token",
  });
  assertEquals(fetcher.sent[0].url.search, "");
  await headers(seams);
  assertEquals(fetcher.sent.length, 1);
  clock.now = T0 + 56 * 60_000;
  await headers(seams);
  assertEquals(fetcher.sent.length, 2);
});

Deno.test("web identity honours the session name and the China partition", async () => {
  const sts = "https://sts.cn-north-1.amazonaws.com.cn/";
  const fetcher = routes({
    [`POST ${sts}`]: () =>
      new Response(
        `<r><AccessKeyId>A</AccessKeyId><SecretAccessKey>S</SecretAccessKey><SessionToken>T</SessionToken><Expiration>2026-01-01T01:00:00Z</Expiration></r>`,
      ),
  });
  await headers({
    env: {
      AWS_REGION: "cn-north-1",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/t",
      AWS_ROLE_ARN: "arn:aws-cn:iam::1:role/r",
      AWS_ROLE_SESSION_NAME: "ci-run-42",
    },
    files: { "/t": "tok" },
    fetch: fetcher,
  });
  assertEquals(form(fetcher.sent[0].body).RoleSessionName, "ci-run-42");
});

Deno.test("a refused or malformed STS answer fails without the web identity token", async () => {
  const env = {
    AWS_REGION: "us-east-1",
    AWS_WEB_IDENTITY_TOKEN_FILE: "/t",
    AWS_ROLE_ARN: "arn:aws:iam::1:role/r",
  };
  const sts = "POST https://sts.us-east-1.amazonaws.com/";
  const cases: Array<[Response, string]> = [
    [
      new Response(
        "<ErrorResponse><Error><Code>InvalidIdentityToken</Code><Message>Bad secret-web-identity-token</Message></Error></ErrorResponse>",
        { status: 400 },
      ),
      "aws: AssumeRoleWithWebIdentity at https://sts.us-east-1.amazonaws.com/ " +
      "failed: HTTP 400: InvalidIdentityToken: Bad [redacted]",
    ],
    [
      new Response("<r><AccessKeyId>A</AccessKeyId></r>"),
      "the answer has no SecretAccessKey",
    ],
    [
      new Response(
        "<r><AccessKeyId>A</AccessKeyId><SecretAccessKey>S</SecretAccessKey><SessionToken>T</SessionToken><Expiration>soon</Expiration></r>",
      ),
      "the answer's Expiration is not a time",
    ],
    [
      new Response("<r><AccessKeyId></AccessKeyId></r>"),
      "the answer has no AccessKeyId",
    ],
  ];
  for (const [answer, message] of cases) {
    const error = await assertRejects(
      () =>
        headers({
          env,
          files: { "/t": "secret-web-identity-token" },
          fetch: routes({ [sts]: () => answer }),
        }),
      Error,
      message,
    );
    assertEquals(error.message.includes("secret-web-identity-token"), false);
  }
});

Deno.test("the ECS relative URI is fetched from 169.254.170.2", async () => {
  const fetcher = routes({
    "GET http://169.254.170.2/v2/credentials/task-uuid": temporary(),
  });
  const sent = await headers({
    env: {
      AWS_REGION: "us-east-1",
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/task-uuid",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: "https://ignored.example/",
    },
    fetch: fetcher,
  });
  assertEquals(credentialOf(sent.authorization).split("/")[0], TEMP_ID);
  assertEquals(fetcher.sent[0].headers.has("authorization"), false);
});

Deno.test("a relative URI that is not a path is refused before any request", async () => {
  for (const relative of ["@evil.example/creds", "evil.example/creds"]) {
    const fetcher = fakeFetch(() => new Response());
    await assertRejects(
      () =>
        headers({
          env: {
            AWS_REGION: "us-east-1",
            AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: relative,
          },
          fetch: fetcher,
        }),
      Error,
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI must start with '/'",
    );
    assertEquals(fetcher.sent.length, 0);
  }
});

Deno.test("EKS Pod Identity's full URI carries the authorization token from its file", async () => {
  const full = "http://169.254.170.23/v1/credentials";
  const fetcher = routes({ [`GET ${full}`]: temporary() });
  await headers({
    env: {
      AWS_REGION: "us-east-1",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: full,
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/var/run/eks-pod-identity/token",
      AWS_CONTAINER_AUTHORIZATION_TOKEN: "ignored-token",
    },
    files: { "/var/run/eks-pod-identity/token": "pod-identity-token\n" },
    fetch: fetcher,
  });
  assertEquals(
    fetcher.sent[0].headers.get("authorization"),
    "pod-identity-token",
  );
  const https = routes({ "GET https://creds.example/c": temporary() });
  await headers({
    env: {
      AWS_REGION: "us-east-1",
      AWS_CONTAINER_CREDENTIALS_FULL_URI: "https://creds.example/c",
      AWS_CONTAINER_AUTHORIZATION_TOKEN: "Basic env-token",
    },
    fetch: https,
  });
  assertEquals(https.sent[0].headers.get("authorization"), "Basic env-token");
});

Deno.test("a plaintext full URI off the allowlist is refused; a refusal hides the token", async () => {
  for (
    const full of [
      "http://169.254.170.2.evil.example/creds",
      "http://evil.example/creds",
    ]
  ) {
    const fetcher = fakeFetch(() => new Response());
    await assertRejects(
      () =>
        headers({
          env: {
            AWS_REGION: "us-east-1",
            AWS_CONTAINER_CREDENTIALS_FULL_URI: full,
          },
          fetch: fetcher,
        }),
      InsecureBackendUrlError,
    );
    assertEquals(fetcher.sent.length, 0);
  }
  const echo = routes({
    "GET http://169.254.170.23/v1/credentials": (request) =>
      new Response(`denied ${request.headers.get("authorization")}`, {
        status: 403,
      }),
  });
  const error = await assertRejects(
    () =>
      headers({
        env: {
          AWS_REGION: "us-east-1",
          AWS_CONTAINER_CREDENTIALS_FULL_URI:
            "http://169.254.170.23/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN: "secret-container-token",
        },
        fetch: echo,
      }),
    Error,
    "aws: the container credentials request to http://169.254.170.23/v1/credentials failed: HTTP 403: denied [redacted]",
  );
  assertEquals(error.message.includes("secret-container-token"), false);
});

Deno.test("EC2 IMDSv2: a session token, the role name, then the role's credentials", async () => {
  const fetcher = routes({
    "PUT http://169.254.169.254/latest/api/token": () =>
      new Response("imds-session-token"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/":
      () => new Response("prometheus-reader\n"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/prometheus-reader":
      temporary(),
  });
  const sent = await headers({
    env: { AWS_REGION: "us-east-1" },
    fetch: fetcher,
  });
  assertEquals(credentialOf(sent.authorization).split("/")[0], TEMP_ID);
  const [put, list, read] = fetcher.sent;
  assertEquals(
    put.headers.get("x-aws-ec2-metadata-token-ttl-seconds"),
    "21600",
  );
  assertEquals(
    list.headers.get("x-aws-ec2-metadata-token"),
    "imds-session-token",
  );
  assertEquals(
    read.headers.get("x-aws-ec2-metadata-token"),
    "imds-session-token",
  );
  await headers({ env: { AWS_REGION: "us-east-1" }, fetch: fetcher });
  assertEquals(fetcher.sent.length, 3);
});

Deno.test("IMDS failures: disabled, no role, a hostile role name, a failed Code", async () => {
  await assertRejects(
    () =>
      headers({
        env: { AWS_REGION: "us-east-1", AWS_EC2_METADATA_DISABLED: "TRUE" },
      }),
    Error,
    "aws: no credentials found",
  );
  for (const roles of ["", "../../latest/user-data", "a/b"]) {
    const fetcher = routes({
      "PUT http://169.254.169.254/latest/api/token": () => new Response("s"),
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/":
        () => new Response(roles),
    });
    await assertRejects(
      () => headers({ env: { AWS_REGION: "us-east-1" }, fetch: fetcher }),
      Error,
      "the instance metadata service named no usable IAM role",
    );
    assertEquals(fetcher.sent.length, 2);
  }
  const failed = routes({
    "PUT http://169.254.169.254/latest/api/token": () => new Response("s"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/":
      () => new Response("r"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/r":
      () => Response.json({ Code: "AssumeRoleUnauthorizedAccess" }),
  });
  await assertRejects(
    () => headers({ env: { AWS_REGION: "us-east-1" }, fetch: failed }),
    Error,
    'aws: reading the credentials of role r failed: the metadata service answered "AssumeRoleUnauthorizedAccess"',
  );
  const noCode = routes({
    "PUT http://169.254.169.254/latest/api/token": () => new Response("s"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/":
      () => new Response("r"),
    "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/r":
      () =>
        Response.json({ AccessKeyId: "A", SecretAccessKey: "S", Token: "T" }),
  });
  await assertRejects(
    () => headers({ env: { AWS_REGION: "us-east-1" }, fetch: noCode }),
    Error,
    "the answer has no Expiration",
  );
});

Deno.test("sigv4() signs a PrometheusTasks query, headers and body included", async () => {
  const url =
    "https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1234/api/v1/query";
  const fetcher = routes({ [`POST ${url}`]: () => vector() });
  const env = new Map([
    ["AWS_ACCESS_KEY_ID", ID],
    ["AWS_SECRET_ACCESS_KEY", SECRET],
  ]);
  await PrometheusTasks.query((s) =>
    s.url("https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1234")
      .fetch(fetcher).readEnv((name) => env.get(name)).now(() => T0)
      .header("x-tenant", "team-a-tenant").sigv4((a) => a.region("us-east-1"))
      .query('sum(rate(x{a="b c"}[5m]))')
  );
  const [sent] = fetcher.sent;
  const expected = await signSigV4(
    {
      method: "POST",
      url,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "x-tenant": "team-a-tenant",
      },
      body: new TextEncoder().encode(sent.body),
    },
    { accessKeyId: ID, secretAccessKey: SECRET },
    "us-east-1",
    "aps",
    T0,
  );
  assertEquals(
    sent.headers.get("authorization"),
    expected.headers.authorization,
  );
  assertStringIncludes(
    sent.headers.get("authorization") ?? "",
    "SignedHeaders=accept;content-type;host;x-amz-date;x-tenant,",
  );
  assertEquals(sent.headers.get("x-amz-date"), "20260101T000000Z");
  // With no lambda, the region and keys come from the environment alone.
  env.set("AWS_REGION", "us-east-1");
  await PrometheusTasks.query((s) =>
    s.url("https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1234")
      .fetch(fetcher).readEnv((name) => env.get(name)).sigv4().query("up")
  );
  assertStringIncludes(
    fetcher.sent[1].headers.get("authorization") ?? "",
    `Credential=${ID}/`,
  );
});
