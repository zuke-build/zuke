// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

// cspell:ignore accountkey clientsecret connectionstring dbpassword privatekeypem sharedaccesskey

/**
 * Unit tests for the credential-name matcher behind
 * `ToolSettings.markSecretsInOutput`: which field names mark their value as a
 * credential, across camelCase, snake_case, kebab-case and dotted names — and
 * which look alike but are not.
 *
 * @module
 */

import { assertEquals } from "./_assert.ts";
import {
  isCredentialName,
  isErrorName,
  isNonSecretName,
} from "../src/credential_name.ts";

Deno.test("credential names match on their last segment, in every case style", () => {
  for (
    const name of [
      "pass",
      "db_pass",
      "password",
      "Password",
      "dbPassword",
      "dbpassword",
      "DB_PASSWORD",
      "passwd",
      "db-pwd",
      "DBPwd",
      "passphrase",
      "secret",
      "clientSecret",
      "client_secret",
      "clientsecret",
      "secrets",
      "token",
      "accessToken",
      "refresh-token",
      "tokens",
      "apiKey",
      "api_key",
      "api-key",
      "apikey",
      "X-Api-Key",
      "accessKey",
      "access_key",
      "SecretAccessKey",
      "aws_secret_access_key",
      "profile.ci.aws_secret_access_key",
      "accountKey",
      "account_key",
      "accountkey",
      "SharedAccessKey",
      "sharedaccesskey",
      "sas",
      "sasToken",
      "SharedAccessSignature",
      "pem",
      "privateKeyPem",
      "private_key_pem",
      "privatekeypem",
      "privateKey",
      "connectionString",
      "connection_string",
      "connection-string",
      "connectionstring",
      "ConnectionString",
      "credential",
      "credentials",
      "Credentials",
      "export DB_PASSWORD",
    ]
  ) {
    assertEquals(isCredentialName(name), true, name);
  }
});

Deno.test("names that only look like credentials do not match", () => {
  for (
    const name of [
      "keyId",
      "key_id",
      "AccessKeyId",
      "tokenType",
      "token_type",
      "hostname",
      "keyspace",
      "monkey",
      "bypass",
      "compass",
      "passwordLastUsed",
      "secretName",
      "pwd",
      "PWD",
      "key",
      "keys",
      "secretId",
      "username",
      "Name",
      "expiresOn",
      "",
    ]
  ) {
    assertEquals(isCredentialName(name), false, name);
  }
});

Deno.test("non-secret vocabulary is recognised, unless it is a credential", () => {
  for (
    const name of [
      "region",
      "Location",
      "type",
      "Arn",
      "id",
      "roleId",
      "subscription_ids",
      "status",
      "state",
      "VersionStages",
      "CreatedDate",
      "LastModifiedTime",
      "timestamp",
      "updated_at",
    ]
  ) {
    assertEquals(isNonSecretName(name), true, name);
  }
  for (
    const name of [
      "password",
      "token",
      "at",
      "value",
      "",
      "--",
      "x".repeat(200),
    ]
  ) {
    assertEquals(isNonSecretName(name), false, name);
  }
});

Deno.test("error fields are recognised by their last segment", () => {
  for (const name of ["error", "errors", "lastError", "validation_errors"]) {
    assertEquals(isErrorName(name), true, name);
  }
  for (const name of ["errorCode", "", `${"x".repeat(200)}Error`]) {
    assertEquals(isErrorName(name), false, name);
  }
});
