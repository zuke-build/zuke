// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// cspell:ignore accountkey connectionstring keypem sharedaccesskey

/**
 * Whether a field name marks its value as a credential, for registering the
 * value with the redactor (see `./secret_output.ts`).
 *
 * This is deliberately stricter than the parameter-name markers in
 * `./redact_url.ts`. Those only decide whether to mask one parameter's value
 * inside one URL, where over-masking an innocent `monkey=` costs nothing; a
 * name matched here registers its value with the run's redactor, which then
 * masks it **everywhere** the build prints it. So a name is matched on its
 * trailing *segments* — `keyId`, `tokenType`, `hostname` and `keyspace` are not
 * credentials, and masking their values would blank ordinary output.
 *
 * Internal: not re-exported from any entrypoint.
 *
 * @module
 */

/**
 * Credential words matched as the name's last segment, so they need a
 * boundary in front: `db_pass`, `pwd`, `apiKey`, `SharedAccessKey`, `sas`,
 * `privateKeyPem`, `connection_string`. Without it, `bypass` and `monkey`
 * would match.
 */
const SEGMENT =
  /(?:^|_)(?:pass|pwd|keys?|sas|pem|signature|connection_string)$/;

/**
 * Credential words that are distinctive enough to match as a plain suffix, so
 * a name written all in lowercase with no boundary to split on — `dbpassword`,
 * `clientsecret`, `apikey`, `connectionstring` — still matches.
 */
const SUFFIX =
  /(?:password|passwd|passphrase|secrets?|tokens?|credentials?|apikey|accesskey|accountkey|privatekey|sharedaccesskey|keypem|connectionstring)$/;

/**
 * `name` split into lowercase `_`-joined segments: camelCase and acronym
 * boundaries (`DBPwd` → `db_pwd`) and every run of other punctuation — `-`,
 * `.`, a space — become one `_`, and none is left at either end.
 */
function segmented(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Whether `name` marks its value as a credential: `password`, `db_pwd`,
 * `clientSecret`, `api-key`, `accountKey`, `SharedAccessKey`, `sas`,
 * `connectionString`, `private_key_pem`, `credentials`,
 * `profile.ci.aws_secret_access_key` — but not `keyId`, `tokenType`,
 * `hostname` or `keyspace`.
 */
export function isCredentialName(name: string): boolean {
  const segments = segmented(name);
  return SEGMENT.test(segments) || SUFFIX.test(segments);
}
