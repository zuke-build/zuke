// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the adversarial review of `@zuke/az`. Each test names
 * the finding it guards (S = security, L = logic, C = CLI fidelity, R = repo
 * rules), and each failed against the code before its fix.
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandOutput } from "@zuke/core/shell";
import {
  AzAccountGetAccessTokenSettings,
  AzAcrLoginSettings,
  AzDeploymentGroupCreateSettings,
  AzKeyvaultSecretSetSettings,
  AzKeyvaultSecretShowSettings,
  AzLoginSettings,
  AzMonitorMetricsListSettings,
  AzSettings,
  AzStorageBlobDownloadSettings,
  AzTasks,
  azureMonitor,
  AzWebappConfigAppsettingsSetSettings,
} from "../mod.ts";
import { FakeAz, json, withEmptyPath } from "./_fake.ts";

/** Record what a settings instance registers with the run's redactor. */
function recording<S extends AzSettings>(settings: S): {
  settings: S;
  marked: string[];
} {
  const marked: string[] = [];
  Object.defineProperty(settings, "markSecret", {
    value: (value: string) => marked.push(value),
  });
  return { settings, marked };
}

/** A runner that never reads the settings it is handed. */
function ignoring(stdout: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: () => {
      calls++;
      return Promise.resolve(new CommandOutput(0, stdout, ""));
    },
  };
}

/** A context whose redactor masks nothing. */
const context = { redact: (text: string) => text };

Deno.test("S1: a SAS token's signature is masked raw and URL-encoded", () => {
  const sig = "a1%2B2b%2F3c%3D%3D";
  const { settings, marked } = recording(new AzStorageBlobDownloadSettings());
  settings.sasToken(`sv=2026-01-01&se=2026-10-08&sig=${sig}`);
  for (const form of [sig, encodeURIComponent(sig), "a1+2b/3c=="]) {
    assertEquals(marked.includes(form), true, form);
  }
  // No signature: the token alone. Bad percent-encoding: the sig as written.
  const unsigned = recording(new AzStorageBlobDownloadSettings());
  unsigned.settings.sasToken("sv=2026-01-01&se=2026-10-08");
  assertEquals(unsigned.marked, ["sv=2026-01-01&se=2026-10-08"]);
  const malformed = recording(new AzStorageBlobDownloadSettings());
  malformed.settings.sasToken("?sig=bad%E0%A4%A");
  assertEquals(malformed.marked.includes("bad%E0%A4%A"), true);
  assertEquals(
    malformed.marked.includes(encodeURIComponent("bad%E0%A4%A")),
    true,
  );
});

Deno.test("S1: debug masks a credential set through the settings' own env, in either order", () => {
  const before = recording(new AzSettings());
  before.settings.env({ AZURE_STORAGE_KEY: "env-set-key-before" }).debug();
  assertEquals(before.marked.includes("env-set-key-before"), true);
  const after = recording(new AzSettings());
  after.settings.debug().env({ AZURE_STORAGE_SAS_TOKEN: "env-set-sas-after" });
  assertEquals(after.marked.includes("env-set-sas-after"), true);
  const plain = recording(new AzSettings());
  plain.settings.env({ AZURE_STORAGE_KEY: "not-debugging-1" });
  assertEquals(plain.marked, []);
});

Deno.test("S2: a key that starts with whitespace is refused", () => {
  assertThrows(
    () => new AzWebappConfigAppsettingsSetSettings().setting(' {"A":"1"}', "x"),
    Error,
    "not usable",
  );
  assertThrows(
    () => new AzWebappConfigAppsettingsSetSettings().setting("\t[x", "1"),
    Error,
    "not usable",
  );
});

Deno.test("S3: a Key Vault reference goes out as a JSON object the CLI cannot expand", () => {
  const argv = new AzWebappConfigAppsettingsSetSettings().name("w")
    .resourceGroup("g")
    .keyVaultReference("DB", "https://kv.vault.azure.net/secrets/db").argv();
  assertEquals(
    argv.includes(
      '{"DB":"@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/db)"}',
    ),
    true,
  );
  assertEquals(argv.some((t) => t.startsWith("DB=")), false);
});

Deno.test("S4: Azure's credential field names are masked", async () => {
  const fields = {
    pwd: "pwd-value-123",
    accountKey: "account-key-123",
    sas: "sas-value-1234",
    connectionString: "Endpoint=sb://x;Key=y",
    connection_string: "Server=x;Password=y",
    privateKeyPem: "-----BEGIN KEY-----",
    SharedAccessKey: "shared-access-123",
    key: "aaaaaaaaaaaa",
    keyId: "not-a-secret-1",
    hostname: "db.example.internal",
  };
  const shown = recording(new AzKeyvaultSecretShowSettings().id("x"));
  await shown.settings.runner(
    new FakeAz(json({ value: JSON.stringify(fields) })).run,
  ).run();
  for (const [name, value] of Object.entries(fields)) {
    const secret = name !== "keyId" && name !== "hostname";
    assertEquals(shown.marked.includes(value), secret, name);
  }
});

Deno.test("S5: a query that moves the secret to another key still masks it", async () => {
  const { settings, marked } = recording(
    new AzAccountGetAccessTokenSettings().query(
      "{accessToken: tokenType, moved: accessToken}",
    ),
  );
  await settings.runner(
    new FakeAz(json({ accessToken: "Bearer", moved: "eyJ.moved-token.1" })).run,
  ).run();
  assertEquals(marked.includes("eyJ.moved-token.1"), true);
});

Deno.test("S6: acr login without a token masks nothing", async () => {
  const { settings, marked } = recording(new AzAcrLoginSettings().name("r"));
  await settings.runner(new FakeAz("Login Succeeded\n").run).run();
  assertEquals(marked, []);
});

Deno.test("S6: a fallback scalar shorter than eight characters is not masked", async () => {
  const { settings, marked } = recording(
    new AzAccountGetAccessTokenSettings().query("[ok, n, tokenType]"),
  );
  await settings.runner(new FakeAz(json([true, 12, "Bearer"])).run).run();
  assertEquals(marked, []);
  // A secret that is the whole answer is masked whatever its length.
  const short = recording(new AzKeyvaultSecretShowSettings().id("x"));
  await short.settings.runner(new FakeAz(json("pin1")).run).run();
  assertEquals(short.marked.includes("pin1"), true);
});

Deno.test("S7: an aggregation is checked like any list element", async () => {
  const runner = ignoring("[]");
  await assertRejects(
    () =>
      AzTasks.monitorMetricsList((s) =>
        // @ts-expect-error — the runtime guard against an untyped value.
        s.resource("r").aggregation("--subscription=other").runner(runner.run)
      ),
    Error,
    "starts with '-'",
  );
  assertEquals(runner.calls, 0);
});

/** A metrics answer with `series` series, each holding `values` at minutes 0…n. */
function seriesAnswer(series: number[][], name = "requests/failed"): string {
  return json([{
    name: { value: name },
    timeseries: series.map((values) => ({
      data: values.map((total, i) => ({
        timeStamp: new Date(Date.UTC(2026, 9, 7, 12, i)).toISOString(),
        total,
      })),
    })),
    errorCode: "Success",
  }]);
}

Deno.test("L1: the canary refuses an answer cut at --top, and takes .top(n)", async () => {
  const ten = Array.from({ length: 10 }, () => [1]);
  const error = await assertRejects(() =>
    azureMonitor((m) =>
      m.resource("r").metric("requests/failed").aggregation("Total")
        .dimension("role", "*").max(5)
        .az((a) => a.runner(new FakeAz(seriesAnswer(ten)).run))
    ).validate(context)
  );
  assertStringIncludes(error.message, "--top");
  const wide = new FakeAz(seriesAnswer(ten));
  await azureMonitor((m) =>
    m.resource("r").metric("requests/failed").aggregation("Total")
      .dimension("role", "*").top(20).max(5).az((a) => a.runner(wide.run))
  ).validate(context);
  assertEquals(wide.flag(0, "--top"), "20");
});

Deno.test("L2: latest across several series sums them at the newest time", async () => {
  const fake = new FakeAz(seriesAnswer([[1, 2], [5, 3]]));
  assertEquals(
    await AzTasks.metricValue((s) =>
      s.resource("r").aggregation("Total").filter("role eq '*'").top(50)
        .runner(fake.run)
    ),
    5,
  );
});

Deno.test("L3: the canary runs the instance its .az(...) lambda returns", async () => {
  const fake = new FakeAz(seriesAnswer([[1]]));
  await withEmptyPath(async () => {
    await azureMonitor((m) =>
      m.resource("r").metric("requests/failed").aggregation("Total").max(5)
        .az((a) => {
          const replacement = new AzMonitorMetricsListSettings().resource("r")
            .metrics("requests/failed").aggregation("Total");
          return a === replacement ? a : replacement.runner(fake.run);
        })
    ).validate(context);
  });
  assertEquals(fake.calls.length, 1);
});

/** A KQL analysis answering `rows`. */
function kql(rows: unknown, window: string | number = "5m") {
  return azureMonitor((m) =>
    m.kql("w", "q").window(window).max(5)
      .az((a) => a.runner(new FakeAz(json(rows)).run))
  );
}

Deno.test("L4: a whitespace-only KQL cell is no data", async () => {
  await assertRejects(
    () => kql([{ n: "   " }]).validate(context),
    Error,
    "has no data",
  );
});

Deno.test("L5: the KQL window must be positive", async () => {
  await assertRejects(
    () => kql([{ n: "1" }], 0).validate(context),
    Error,
    "longer than zero",
  );
  await assertRejects(
    () => kql([{ n: "1" }], -60_000).validate(context),
    Error,
    "duration",
  );
});

Deno.test("L6: a bound must be finite", async () => {
  for (const bound of [Infinity, -Infinity]) {
    await assertRejects(
      () =>
        azureMonitor((m) =>
          m.kql("w", "q").max(bound)
            .az((a) => a.runner(new FakeAz(json([{ n: "1" }])).run))
        ).validate(context),
      Error,
      "finite",
    );
  }
});

Deno.test("L-top: an unfiltered metric is one series, whatever .top says", async () => {
  assertEquals(
    await AzTasks.metricValue((s) =>
      s.resource("r").aggregation("Total").top(1)
        .runner(new FakeAz(seriesAnswer([[4]])).run)
    ),
    4,
  );
});

Deno.test("L-name: an answer whose one metric has no name says so", async () => {
  await assertRejects(
    () =>
      AzTasks.metricValue((s) =>
        s.resource("r").aggregation("Total")
          .runner(new FakeAz(json([{ timeseries: [] }])).run)
      ),
    Error,
    "no name",
  );
});

Deno.test("L-window: a canary window shorter than its interval is refused", async () => {
  await assertRejects(
    () =>
      azureMonitor((m) =>
        m.resource("r").metric("m").aggregation("Total").interval("PT1H")
          .window("5m").max(1)
          .az((a) => a.runner(new FakeAz(seriesAnswer([[1]], "m")).run))
      ).validate(context),
    Error,
    "shorter than its interval",
  );
});

Deno.test("L-cover: get-access-token with an empty or null answer masks nothing", async () => {
  for (const stdout of ["", "null"]) {
    const { settings, marked } = recording(
      new AzAccountGetAccessTokenSettings(),
    );
    await settings.runner(new FakeAz(stdout).run).run();
    assertEquals(marked, []);
  }
});

/** The CLI's answer when the log-analytics extension is missing. */
const MISSING_EXTENSION = new CommandOutput(
  2,
  "",
  "ERROR: 'query' is misspelled or not recognized by the system.\n",
);

Deno.test("C1: a missing log-analytics extension is named, with the fix", async () => {
  const hint = "az extension add --name log-analytics";
  await assertRejects(
    () =>
      AzTasks.logAnalyticsQuery((q) =>
        q.workspace("w").analyticsQuery("q")
          .runner(new FakeAz(MISSING_EXTENSION).run)
      ),
    Error,
    hint,
  );
  await assertRejects(
    () =>
      AzTasks.monitorLogAnalyticsQuery((q) =>
        q.workspace("w").analyticsQuery("q")
          .runner(new FakeAz(MISSING_EXTENSION).run)
      ),
    Error,
    hint,
  );
  await assertRejects(
    () =>
      azureMonitor((m) =>
        m.kql("w", "q").max(1)
          .az((a) => a.runner(new FakeAz(MISSING_EXTENSION).run))
      ).validate(context),
    Error,
    hint,
  );
  // Any other failure is reported as it is.
  await assertRejects(
    () =>
      AzTasks.logAnalyticsQuery((q) =>
        q.workspace("w").analyticsQuery("q")
          .runner(new FakeAz(new CommandOutput(2, "", "ERROR: bad query")).run)
      ),
    Error,
    "bad query",
  );
});

Deno.test("C2: a managed identity takes no username or tenant, a principal no identity id", () => {
  assertThrows(
    () => new AzLoginSettings().identity().username("u").argv(),
    Error,
    ".clientId(",
  );
  assertThrows(
    () => new AzLoginSettings().identity().tenant("t").argv(),
    Error,
    ".clientId(",
  );
  for (
    const id of [
      (s: AzLoginSettings) => s.clientId("c"),
      (s: AzLoginSettings) => s.objectId("o"),
      (s: AzLoginSettings) => s.resourceId("r"),
    ]
  ) {
    assertThrows(
      () =>
        id(
          new AzLoginSettings().servicePrincipal().username("a").tenant("t")
            .certificate("c.pem"),
        ).argv(),
      Error,
      "managed identity",
    );
  }
});

Deno.test("C4: --only-show-errors cannot be combined with --debug or --verbose", () => {
  assertThrows(
    () => new AzSettings().onlyShowErrors().debug().argv(),
    Error,
    "--only-show-errors",
  );
  assertThrows(
    () => new AzSettings().onlyShowErrors().verbose().argv(),
    Error,
    "--only-show-errors",
  );
});

Deno.test("C5: an encoding needs a file", () => {
  assertThrows(
    () =>
      new AzKeyvaultSecretSetSettings().vaultName("kv").name("n")
        .value("secret-1").encoding("base64").argv(),
    Error,
    "--encoding",
  );
});

Deno.test("R4: a deployment parameter's refusal names the real task", () => {
  assertThrows(
    () =>
      new AzDeploymentGroupCreateSettings().resourceGroup("g")
        .templateFile("t").parameter("-p", "v").argv(),
    Error,
    "deploymentGroupCreate",
  );
});
