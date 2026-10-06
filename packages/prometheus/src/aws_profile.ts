// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Static keys from the AWS shared credentials and config files — the
 * `[profile]` sections of `~/.aws/credentials` (`AWS_SHARED_CREDENTIALS_FILE`)
 * and `~/.aws/config` (`AWS_CONFIG_FILE`, where a profile is spelt
 * `[profile name]` and the default `[default]`).
 *
 * Only `aws_access_key_id`, `aws_secret_access_key` and `aws_session_token`
 * are read. A profile that gets its credentials another way — `role_arn`,
 * `credential_process`, IAM Identity Center (`sso_*`), or its own
 * `web_identity_token_file` — is refused by name rather than skipped, so a
 * build never silently signs as a different identity than the profile names.
 *
 * @module
 */

import { envValue } from "./env.ts";
import { messageOf } from "./message.ts";
import type { PrometheusCredentialsContext } from "./credentials.ts";
import type { AwsCredentials } from "./aws_sigv4.ts";

/** Profile keys that source credentials in a way this reader does not. */
const UNSUPPORTED_KEYS = [
  "role_arn",
  "credential_process",
  "sso_session",
  "sso_start_url",
  "web_identity_token_file",
];

/** An INI file's sections, by name, each a map of keys to values. */
type Ini = Map<string, Map<string, string>>;

/** Parse the INI dialect the AWS files use (`#`/`;` comments, `[section]`). */
function parseIni(text: string): Ini {
  const sections: Ini = new Map();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[\s*([^\]]*?)\s*\]$/.exec(line);
    if (header !== null) {
      current = sections.get(header[1]) ?? new Map();
      sections.set(header[1], current);
      continue;
    }
    const at = line.indexOf("=");
    // A key outside any section, or a line that is not `key = value` (a
    // nested block's indented line), carries nothing this reader uses.
    if (current === undefined || at === -1) continue;
    current.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return sections;
}

/** A file's text, or `""` when it does not exist. */
async function readOptional(
  context: PrometheusCredentialsContext,
  path: string,
): Promise<string> {
  try {
    return await context.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "";
    throw new Error(
      `aws: could not read the shared file at ${path}: ${messageOf(error)}`,
    );
  }
}

/** The path a file's variable names, else `<home>/.aws/<name>`. */
function sharedPath(
  context: PrometheusCredentialsContext,
  variable: string,
  name: string,
): string | undefined {
  const named = envValue(context.readEnv, variable);
  if (named !== undefined) return named;
  const home = envValue(context.readEnv, "HOME") ??
    envValue(context.readEnv, "USERPROFILE");
  return home === undefined ? undefined : `${home}/.aws/${name}`;
}

/**
 * The profile `name`'s settings, merged from the config file and the
 * credentials file (the latter wins), or `undefined` when neither has it.
 */
async function readProfile(
  context: PrometheusCredentialsContext,
  name: string,
): Promise<Map<string, string> | undefined> {
  const configPath = sharedPath(context, "AWS_CONFIG_FILE", "config");
  const credentialsPath = sharedPath(
    context,
    "AWS_SHARED_CREDENTIALS_FILE",
    "credentials",
  );
  const config = configPath === undefined
    ? new Map()
    : parseIni(await readOptional(context, configPath));
  const credentials = credentialsPath === undefined
    ? new Map()
    : parseIni(await readOptional(context, credentialsPath));
  const fromConfig = config.get(`profile ${name}`) ??
    (name === "default" ? config.get("default") : undefined);
  const fromCredentials = credentials.get(name);
  if (fromConfig === undefined && fromCredentials === undefined) {
    return undefined;
  }
  return new Map([...(fromConfig ?? []), ...(fromCredentials ?? [])]);
}

/**
 * The static keys of profile `name`. `undefined` when the profile does not
 * exist or holds no credential setting at all (a `[default]` with only a
 * `region`, say); an error when it holds one this reader cannot use, or only
 * half a key.
 */
export async function profileCredentials(
  context: PrometheusCredentialsContext,
  name: string,
): Promise<AwsCredentials | undefined> {
  const profile = await readProfile(context, name);
  if (profile === undefined) return undefined;
  const id = profile.get("aws_access_key_id");
  const secret = profile.get("aws_secret_access_key");
  const token = profile.get("aws_session_token");
  if (id === undefined && secret === undefined) {
    const unsupported = UNSUPPORTED_KEYS.find((key) => profile.has(key));
    if (unsupported === undefined) return undefined;
    throw new Error(
      `aws: profile "${name}" gets its credentials through ${unsupported}, ` +
        `which is not supported — use static keys, the environment, web ` +
        `identity, or the ECS / EC2 endpoints`,
    );
  }
  if (id === undefined || id === "" || secret === undefined || secret === "") {
    throw new Error(
      `aws: profile "${name}" needs both aws_access_key_id and ` +
        `aws_secret_access_key`,
    );
  }
  return token === undefined || token === ""
    ? { accessKeyId: id, secretAccessKey: secret }
    : { accessKeyId: id, secretAccessKey: secret, sessionToken: token };
}
