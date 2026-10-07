// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: the built-in cloud credential sources through the real CLI. A
 * build queries Google Managed Service for Prometheus with a service-account
 * key, Azure Monitor with a client secret, and Amazon Managed Service for
 * Prometheus with SigV4 — every token endpoint and the servers answered by
 * one injected `fetch`, the environment and key files by injected readers —
 * and a token endpoint that echoes the secret it was sent never gets it
 * printed.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "../../packages/core/tests/_assert.ts";
import { Build, target } from "../../packages/core/mod.ts";
import {
  type PrometheusConnectionSettings,
  PrometheusTasks,
} from "../../packages/prometheus/mod.ts";
import { vector } from "../../packages/prometheus/tests/_fetch.ts";
import { routes, rsaKey } from "../../packages/prometheus/tests/_auth.ts";
import { runCli } from "./_harness.ts";

const { pem } = await rsaKey();

/** The Azure client secret — obviously fake. */
const AZURE_SECRET = "azure-client-secret-for-tests";

/** The environment the build runs in. */
const ENV = new Map([
  ["GOOGLE_APPLICATION_CREDENTIALS", "/keys/sa.json"],
  ["AZURE_TENANT_ID", "contoso.onmicrosoft.com"],
  ["AZURE_CLIENT_ID", "app-client"],
  ["AZURE_CLIENT_SECRET", AZURE_SECRET],
  ["AWS_ACCESS_KEY_ID", "AKIDEXAMPLE"],
  ["AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"],
  ["AWS_REGION", "us-east-1"],
]);

/** The key files the build reads. */
const FILES = new Map([
  [
    "/keys/sa.json",
    JSON.stringify({
      type: "service_account",
      client_email: "reader@p.iam.gserviceaccount.example",
      private_key: pem,
    }),
  ],
]);

const GOOGLE =
  "https://monitoring.googleapis.com/v1/projects/p/location/global/prometheus";
const AZURE = "https://amw.eastus.prometheus.monitor.azure.com";
const AWS = "https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-1";

/** Whether the Azure token endpoint echoes the secret back in a refusal. */
let azureRefuses = false;

/** Every request the build sends. */
let net = server();

/** One fake for the token endpoints and the three servers. */
function server() {
  return routes({
    "POST https://oauth2.googleapis.com/token": () =>
      Response.json({ access_token: "google-token", expires_in: 3600 }),
    "POST https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token":
      (request) =>
        azureRefuses
          ? Response.json({
            error: "invalid_client",
            error_description: `wrong secret: ${
              new URLSearchParams(request.body).get("client_secret")
            }`,
          }, { status: 401 })
          : Response.json({ access_token: "azure-token", expires_in: 3600 }),
    [`POST ${GOOGLE}/api/v1/query`]: () => vector([{}, "1"]),
    [`POST ${AZURE}/api/v1/query`]: () => vector([{}, "2"]),
    [`POST ${AWS}/api/v1/query`]: () => vector([{}, "3"]),
  });
}

/** The seams every call shares. */
const seams = <S extends PrometheusConnectionSettings>(s: S): S =>
  s.fetch(net).readEnv((name) => ENV.get(name))
    .readTextFile((path) => Promise.resolve(FILES.get(path) ?? ""));

/** The values the build read, in order. */
const values: number[] = [];

class Managed extends Build {
  google = target().executes(async () => {
    values.push(PrometheusTasks.value(
      await PrometheusTasks.query((s) =>
        seams(s).url(GOOGLE).google().query("up")
      ),
    ));
  });

  azure = target().executes(async () => {
    values.push(PrometheusTasks.value(
      await PrometheusTasks.query((s) =>
        seams(s).url(AZURE).azure().query("up")
      ),
    ));
  });

  aws = target().executes(async () => {
    values.push(PrometheusTasks.value(
      await PrometheusTasks.query((s) => seams(s).url(AWS).sigv4().query("up")),
    ));
  });

  all = target().dependsOn(this.google, this.azure, this.aws).executes(
    () => {},
  );
}

Deno.test("a build queries all three managed services with built-in credentials", async () => {
  azureRefuses = false;
  net = server();
  values.length = 0;
  const { code, err } = await runCli(Managed, ["all"]);
  assertEquals(code, 0, err);
  assertEquals(values.toSorted(), [1, 2, 3]);
  const byPath = (path: string) =>
    net.sent.find((request) => request.url.href === path);
  assertEquals(
    byPath(`${GOOGLE}/api/v1/query`)?.headers.get("authorization"),
    "Bearer google-token",
  );
  assertEquals(
    byPath(`${AZURE}/api/v1/query`)?.headers.get("authorization"),
    "Bearer azure-token",
  );
  assertStringIncludes(
    byPath(`${AWS}/api/v1/query`)?.headers.get("authorization") ?? "",
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/",
  );
});

Deno.test("a token endpoint echoing the client secret never gets it printed", async () => {
  azureRefuses = true;
  net = server();
  const { code, out, err } = await runCli(Managed, ["azure"]);
  assertEquals(code, 1);
  assertStringIncludes(
    out + err,
    "azure: the client secret token request at https://login.microsoftonline.com/",
  );
  assertStringIncludes(out + err, "wrong secret: [redacted]");
  assertEquals((out + err).includes(AZURE_SECRET), false);
});
