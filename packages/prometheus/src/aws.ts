// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The AWS credential source, for Amazon Managed Service for Prometheus:
 * every request SigV4-signed for the service `aps`, with credentials found
 * without the `aws` CLI.
 *
 * The credential chain, in the AWS SDKs' order for the sources supported:
 *
 * 1. `accessKey(...)`, when set — and nothing else;
 * 2. `profile(...)`, when set — that profile's static keys, and nothing else;
 * 3. `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN`);
 * 4. the shared files' `AWS_PROFILE` profile (else `default`) — static keys;
 * 5. web identity: `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN`
 *    (+ `AWS_ROLE_SESSION_NAME`) through STS `AssumeRoleWithWebIdentity`;
 * 6. the container endpoint: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, else
 *    `AWS_CONTAINER_CREDENTIALS_FULL_URI`;
 * 7. EC2 IMDSv2, unless `AWS_EC2_METADATA_DISABLED=true`.
 *
 * Temporary credentials (5–7) are cached until shortly before their
 * `Expiration`.
 *
 * @module
 */

import { profileCredentials } from "./aws_profile.ts";
import {
  containerCredentials,
  instanceCredentials,
  webIdentityCredentials,
} from "./aws_remote.ts";
import {
  AWS_PROMETHEUS_SERVICE,
  type PrometheusAwsSettings,
} from "./aws_settings.ts";
import { type AwsCredentials, signSigV4 } from "./aws_sigv4.ts";
import type {
  PrometheusCredentials,
  PrometheusCredentialsContext,
} from "./credentials.ts";
import { TokenCache } from "./token_cache.ts";

/** Temporary credentials, cached per source identity. */
const temporary = new TokenCache<AwsCredentials>();

/** An environment variable's value, `undefined` when unset or empty. */
function env(
  context: PrometheusCredentialsContext,
  name: string,
): string | undefined {
  const value = context.readEnv(name);
  return value === "" ? undefined : value;
}

/**
 * The signing region: the setting, else `AWS_REGION`, else
 * `AWS_DEFAULT_REGION`. It becomes part of the STS host name, so only a
 * region's own characters are accepted — `us-east-1.evil.example/` is not a
 * region.
 */
function resolveRegion(
  settings: PrometheusAwsSettings,
  context: PrometheusCredentialsContext,
): string {
  const region = settings.region_ ?? env(context, "AWS_REGION") ??
    env(context, "AWS_DEFAULT_REGION");
  if (region === undefined) {
    throw new Error(
      "aws: SigV4 needs a region — set region(...), AWS_REGION or " +
        "AWS_DEFAULT_REGION",
    );
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(region)) {
    throw new Error(
      "aws: the region must be lower-case letters, digits and '-', such as " +
        "us-east-1",
    );
  }
  return region;
}

/** The credentials the chain resolves to. */
async function resolveCredentials(
  settings: PrometheusAwsSettings,
  context: PrometheusCredentialsContext,
  region: string,
): Promise<AwsCredentials> {
  if (settings.accessKey_ !== undefined) return settings.accessKey_;
  if (settings.profile_ !== undefined) {
    const named = await profileCredentials(context, settings.profile_);
    if (named === undefined) {
      throw new Error(
        `aws: profile "${settings.profile_}" has no static keys in the ` +
          `shared credentials or config file`,
      );
    }
    return named;
  }
  const id = env(context, "AWS_ACCESS_KEY_ID");
  const secret = env(context, "AWS_SECRET_ACCESS_KEY");
  if (id !== undefined && secret !== undefined) {
    const token = env(context, "AWS_SESSION_TOKEN");
    return token === undefined
      ? { accessKeyId: id, secretAccessKey: secret }
      : { accessKeyId: id, secretAccessKey: secret, sessionToken: token };
  }
  const profile = env(context, "AWS_PROFILE");
  const shared = await profileCredentials(context, profile ?? "default");
  if (shared !== undefined) return shared;
  if (profile !== undefined) {
    throw new Error(
      `aws: AWS_PROFILE names "${profile}", which has no static keys in the ` +
        `shared credentials or config file`,
    );
  }
  const tokenFile = env(context, "AWS_WEB_IDENTITY_TOKEN_FILE");
  const roleArn = env(context, "AWS_ROLE_ARN");
  if (tokenFile !== undefined && roleArn !== undefined) {
    const sessionName = env(context, "AWS_ROLE_SESSION_NAME");
    return await temporary.get(
      context,
      ["web", region, roleArn, sessionName, tokenFile],
      () =>
        webIdentityCredentials(
          context,
          region,
          roleArn,
          sessionName ?? `zuke-${Math.floor(context.now() / 1000)}`,
          tokenFile,
        ),
    );
  }
  const relative = env(context, "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI");
  const full = env(context, "AWS_CONTAINER_CREDENTIALS_FULL_URI");
  const endpoint = relative !== undefined
    ? { relative }
    : full !== undefined
    ? { full }
    : undefined;
  if (endpoint !== undefined) {
    return await temporary.get(
      context,
      ["container", relative, full],
      () => containerCredentials(context, endpoint),
    );
  }
  if (env(context, "AWS_EC2_METADATA_DISABLED")?.toLowerCase() === "true") {
    throw new Error(
      "aws: no credentials found — set AWS_ACCESS_KEY_ID and " +
        "AWS_SECRET_ACCESS_KEY, a profile, web identity or a container " +
        "endpoint (the EC2 metadata service is disabled by " +
        "AWS_EC2_METADATA_DISABLED)",
    );
  }
  return await temporary.get(
    context,
    ["imds"],
    () => instanceCredentials(context),
  );
}

/**
 * The AWS credential source: SigV4 over the whole request — method, URL,
 * every header already set, and the body — for the service `aps`. Configure
 * it last, so it signs the headers the other sources added.
 */
export function sigv4Credentials(
  settings: PrometheusAwsSettings,
): PrometheusCredentials {
  return async (request, context) => {
    const region = resolveRegion(settings, context);
    const credentials = await resolveCredentials(settings, context, region);
    const signed = await signSigV4(
      request,
      credentials,
      region,
      AWS_PROMETHEUS_SERVICE,
      context.now(),
    );
    return signed.headers;
  };
}
