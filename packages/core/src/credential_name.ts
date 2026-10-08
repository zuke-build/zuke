// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// cspell:ignore accountkey connectionstring keypem sharedaccesskey masterkey
// cspell:ignore signingkey clientkey

/**
 * Whether a field name marks its value as a credential — or, the other way
 * round, as plainly not a secret — for registering values with the redactor
 * (see `./secret_output.ts`).
 *
 * This is deliberately stricter than the parameter-name markers in
 * `./redact_url.ts`. Those only decide whether to mask one parameter's value
 * inside one URL, where over-masking an innocent `monkey=` costs nothing; a
 * name matched here registers its value with the run's redactor, which then
 * masks it **everywhere** the build prints it. So a name is matched on its
 * trailing *segments* — `keyId`, `tokenType`, `hostname`, `keyspace`,
 * `publicKey` and the shell's `PWD` are not credentials, and masking their
 * values would blank ordinary output.
 *
 * Internal: not re-exported from any entrypoint.
 *
 * @module
 */

/**
 * The longest name considered. A field name is a word or a few; anything
 * longer is not a credential's name, and is not worth segmenting.
 */
const MAX_NAME_LENGTH = 128;

/** Last segments that mark a credential on their own. */
const CREDENTIAL_WORDS = new Set([
  "pass",
  "password",
  "passwords",
  "passwd",
  "passphrase",
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "sas",
  "sig",
  "signature",
  "pem",
  "auth",
  "authorization",
  "pin",
  "otp",
  "jwt",
  "assertion",
  "cookie",
  "cookies",
]);

/**
 * Last segments that mark a credential only with a qualifier in front:
 * `db_pwd` but not the shell's `PWD`, `apiKey` but not a bare `key`.
 */
const QUALIFIED_WORDS = new Set(["pwd", "key", "keys"]);

/**
 * Qualifiers that make a `…_key` something other than a credential: a public
 * key, or a database's partition, sort, row, hash, range or foreign key, an
 * object store's key, a cache or idempotency key.
 */
const NON_CREDENTIAL_QUALIFIERS = new Set([
  "public",
  "partition",
  "sort",
  "row",
  "hash",
  "range",
  "object",
  "foreign",
  "cache",
  "idempotency",
]);

/** Last two segments that mark a credential together. */
const CREDENTIAL_PAIRS = new Set([
  "key_data",
  "key_material",
  "secret_string",
  "secret_binary",
  "password_data",
  "connection_string",
]);

/**
 * Credential words distinctive enough to match as the plain suffix of one
 * segment, so a name written all in lowercase with no boundary to split on —
 * `dbpassword`, `clientsecret`, `apikey`, `connectionstring` — still matches.
 */
const COMPOUND =
  /(?:password|passwd|passphrase|secrets?|tokens?|credentials?|apikey|accesskey|accountkey|privatekey|sharedaccesskey|masterkey|signingkey|clientkey|keypem|connectionstring)$/;

/**
 * `name`'s lowercase segments: camelCase and acronym boundaries (`DBPwd` →
 * `db`, `pwd`) and every run of other punctuation — `-`, `.`, a space — split
 * it. Each pattern is linear: no quantified group backtracks into another.
 */
function segmentsOf(name: string): string[] {
  return name
    .replace(/([A-Z])(?=[A-Z][a-z])/g, "$1_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment !== "");
}

/**
 * Whether `name` marks its value as a credential: `password`, `db_pwd`,
 * `clientSecret`, `api-key`, `accountKey`, `SharedAccessKey`, `sas`, `sig`,
 * `connectionString`, `private_key_pem`, `client-key-data`, `SecretString`,
 * `auth`, `pin`, `credentials`, `profile.ci.aws_secret_access_key` — but not
 * `keyId`, `tokenType`, `hostname`, `keyspace`, `publicKey`, `partitionKey`, a
 * bare `key` or the shell's `PWD`.
 */
export function isCredentialName(name: string): boolean {
  if (name.length > MAX_NAME_LENGTH) return false;
  const segments = segmentsOf(name);
  const last = segments.at(-1);
  if (last === undefined) return false;
  const previous = segments.at(-2);
  if (CREDENTIAL_WORDS.has(last)) return true;
  if (QUALIFIED_WORDS.has(last)) {
    return previous !== undefined && !NON_CREDENTIAL_QUALIFIERS.has(previous);
  }
  if (previous !== undefined && CREDENTIAL_PAIRS.has(`${previous}_${last}`)) {
    return true;
  }
  return COMPOUND.test(last);
}

/**
 * Last segments that mark a value as ordinary vocabulary rather than a secret:
 * where something is, what kind it is, its identifier, its state. A value
 * found only because the caller reshaped the output is not registered under
 * one of these — `us-east-1` or a resource id would otherwise mask every
 * mention of it. A name that is also a credential name is never one of these.
 */
const NON_SECRET_WORDS = new Set([
  "region",
  "location",
  "type",
  "arn",
  "id",
  "ids",
  "status",
  "state",
]);

/** Last two segments that mark ordinary vocabulary together. */
const NON_SECRET_PAIRS = new Set(["version_stages"]);

/**
 * Whether `name` is ordinary, non-secret vocabulary (see
 * {@link NON_SECRET_WORDS}): `region`, `Location`, `type`, `Arn`, `id`,
 * `roleId`, `status`, `state`, `VersionStages`, and a date or time —
 * `CreatedDate`, `LastModifiedTime`, `updated_at` — unless it is also a
 * credential name.
 */
export function isNonSecretName(name: string): boolean {
  if (name.length > MAX_NAME_LENGTH || isCredentialName(name)) return false;
  const segments = segmentsOf(name);
  const last = segments.at(-1);
  if (last === undefined) return false;
  const previous = segments.at(-2);
  return NON_SECRET_WORDS.has(last) ||
    /(?:date|time|timestamp)$/.test(last) ||
    (last === "at" && previous !== undefined) ||
    (previous !== undefined && NON_SECRET_PAIRS.has(`${previous}_${last}`));
}

/** Whether `name` holds an error, whose whole content is ordinary text. */
export function isErrorName(name: string): boolean {
  const last = name.length > MAX_NAME_LENGTH
    ? undefined
    : segmentsOf(name).at(-1);
  return last === "error" || last === "errors";
}
