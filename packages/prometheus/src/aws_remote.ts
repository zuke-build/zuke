// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The AWS credential sources that fetch temporary credentials: STS
 * `AssumeRoleWithWebIdentity` (EKS IRSA, GitHub Actions OIDC), the container
 * credentials endpoint (ECS task roles, EKS Pod Identity), and the EC2
 * Instance Metadata Service with IMDSv2 session tokens.
 *
 * Each returns {@link Expiring} credentials for the chain in `aws.ts` to
 * cache; each request goes through `authRequest`, so the metadata endpoints
 * are the only plaintext ones allowed.
 *
 * @module
 */

import {
  answerString,
  authRequest,
  authRequestJson,
  type AuthStep,
  readAuthFile,
} from "./auth_http.ts";
import type { AwsCredentials } from "./aws_sigv4.ts";
import type { PrometheusCredentialsContext } from "./credentials.ts";
import { own } from "./shape.ts";
import type { Expiring } from "./token_cache.ts";

/** The ECS task-credentials host a relative URI is resolved against. */
const ECS_CREDENTIALS_HOST = "http://169.254.170.2";

/** The EC2 Instance Metadata Service. */
const IMDS = "http://169.254.169.254";

/** The IMDSv2 session token's lifetime, in seconds: the six-hour maximum. */
const IMDS_TOKEN_TTL = "21600";

/** The step descriptor for an AWS request. */
function awsStep(step: string, secrets: readonly string[]): AuthStep {
  return { provider: "aws", step, secrets };
}

/** An ISO-8601 expiration as epoch ms, or an error naming the step. */
function expiration(value: string, step: AuthStep): number {
  const at = Date.parse(value);
  if (Number.isNaN(at)) {
    throw new Error(
      `aws: ${step.step} failed: the answer's Expiration is not a time`,
    );
  }
  return at;
}

/**
 * Credentials from a JSON answer shaped as ECS and IMDS send them:
 * `AccessKeyId`, `SecretAccessKey`, `Token`, `Expiration`.
 */
function jsonCredentials(
  answer: Record<string, unknown>,
  step: AuthStep,
): Expiring<AwsCredentials> {
  return {
    value: {
      accessKeyId: answerString(answer, "AccessKeyId", step),
      secretAccessKey: answerString(answer, "SecretAccessKey", step),
      sessionToken: answerString(answer, "Token", step),
    },
    expiresAt: expiration(answerString(answer, "Expiration", step), step),
  };
}

/** The text of the one XML element `name`, entity-decoded, or `undefined`. */
function xmlText(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return match === null ? undefined : match[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** The STS endpoint for `region`: `sts.<region>.amazonaws.com(.cn)`. */
function stsEndpoint(region: string): string {
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  return `https://sts.${region}.${suffix}/`;
}

/**
 * `AssumeRoleWithWebIdentity`: exchange the OIDC token in `tokenFile` for the
 * role's temporary credentials at the regional STS endpoint. The request is
 * unsigned — the web identity token is the credential — and sent as a form
 * body, so the token never sits in a URL.
 */
export async function webIdentityCredentials(
  context: PrometheusCredentialsContext,
  region: string,
  roleArn: string,
  sessionName: string,
  tokenFile: string,
): Promise<Expiring<AwsCredentials>> {
  const token = (await readAuthFile(
    context,
    "aws",
    "the web identity token",
    tokenFile,
  )).trim();
  const url = stsEndpoint(region);
  const step = awsStep(`AssumeRoleWithWebIdentity at ${url}`, [token]);
  const xml = await authRequest(context, step, {
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: roleArn,
      RoleSessionName: sessionName,
      WebIdentityToken: token,
    }).toString(),
  });
  const field = (name: string): string => {
    const value = xmlText(xml, name);
    if (value === undefined || value === "") {
      throw new Error(`aws: ${step.step} failed: the answer has no ${name}`);
    }
    return value;
  };
  return {
    value: {
      accessKeyId: field("AccessKeyId"),
      secretAccessKey: field("SecretAccessKey"),
      sessionToken: field("SessionToken"),
    },
    expiresAt: expiration(field("Expiration"), step),
  };
}

/**
 * The container credentials endpoint: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`
 * resolved against `169.254.170.2`, else `AWS_CONTAINER_CREDENTIALS_FULL_URI`
 * (https, loopback, or the ECS / EKS Pod Identity link-local hosts), with the
 * `Authorization` value from `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE`, else
 * `AWS_CONTAINER_AUTHORIZATION_TOKEN`.
 */
export async function containerCredentials(
  context: PrometheusCredentialsContext,
  endpoint: { readonly relative: string } | { readonly full: string },
): Promise<Expiring<AwsCredentials>> {
  let url: string;
  if ("relative" in endpoint) {
    // Must be a path: `@evil.example/` appended to the host would make
    // `evil.example` the host and hand it the container's role.
    if (!endpoint.relative.startsWith("/")) {
      throw new Error(
        "aws: AWS_CONTAINER_CREDENTIALS_RELATIVE_URI must start with '/'",
      );
    }
    url = `${ECS_CREDENTIALS_HOST}${endpoint.relative}`;
  } else {
    url = endpoint.full;
  }
  const tokenFile = context.readEnv("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE");
  const token = tokenFile !== undefined && tokenFile !== ""
    ? (await readAuthFile(
      context,
      "aws",
      "the container authorization token",
      tokenFile,
    )).trim()
    : context.readEnv("AWS_CONTAINER_AUTHORIZATION_TOKEN");
  const headers: Record<string, string> = token === undefined || token === ""
    ? {}
    : { authorization: token };
  const step = awsStep(
    `the container credentials request to ${url}`,
    token === undefined ? [] : [token],
  );
  const answer = await authRequestJson(context, step, {
    method: "GET",
    url,
    headers,
  });
  return jsonCredentials(answer, step);
}

/**
 * EC2 IMDSv2: `PUT /latest/api/token` for a session token, read the
 * instance profile's role name from
 * `/latest/meta-data/iam/security-credentials/`, then that role's
 * credentials.
 */
export async function instanceCredentials(
  context: PrometheusCredentialsContext,
): Promise<Expiring<AwsCredentials>> {
  const session = await authRequest(
    context,
    awsStep("the IMDSv2 session token request", []),
    {
      method: "PUT",
      url: `${IMDS}/latest/api/token`,
      headers: { "x-aws-ec2-metadata-token-ttl-seconds": IMDS_TOKEN_TTL },
    },
  );
  const headers = { "x-aws-ec2-metadata-token": session };
  const listing = `${IMDS}/latest/meta-data/iam/security-credentials/`;
  const roles = await authRequest(
    context,
    awsStep("reading the instance profile's role name", [session]),
    { method: "GET", url: listing, headers },
  );
  const role = roles.split("\n")[0].trim();
  // A role name from the metadata answer goes into the next request's path;
  // IAM's own character set keeps a `/` or `..` from turning it elsewhere.
  if (!/^[\w+=,.@-]+$/.test(role)) {
    throw new Error(
      "aws: the instance metadata service named no usable IAM role — is an " +
        "instance profile attached?",
    );
  }
  const step = awsStep(`reading the credentials of role ${role}`, [session]);
  const answer = await authRequestJson(context, step, {
    method: "GET",
    url: `${listing}${role}`,
    headers,
  });
  const code = own(answer, "Code");
  if (code !== undefined && code !== "Success") {
    throw new Error(
      `aws: ${step.step} failed: the metadata service answered ${
        JSON.stringify(code).slice(0, 60)
      }`,
    );
  }
  return jsonCredentials(answer, step);
}
