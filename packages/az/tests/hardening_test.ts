// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The security rules `@zuke/az` was built with, one test per rule — the
 * classes of defect the adversarial review of `@zuke/aws` found, applied
 * here from the start: option injection, file expansion, secrets in argv or
 * output, and refusals a runner could bypass.
 */

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { CommandError, CommandOutput } from "@zuke/core/shell";
import {
  AzAccountGetAccessTokenSettings,
  AzAcrBuildSettings,
  AzAcrLoginSettings,
  AzAksGetCredentialsSettings,
  AzContainerappIngressTrafficSetSettings,
  AzContainerappUpdateSettings,
  AzDeploymentGroupCreateSettings,
  AzGroupCreateSettings,
  AzKeyvaultSecretSetSettings,
  AzKeyvaultSecretShowSettings,
  AzLoginSettings,
  AzMonitorActivityLogListSettings,
  AzMonitorLogAnalyticsQuerySettings,
  AzMonitorMetricsListSettings,
  AzSettings,
  AzStorageBlobDownloadSettings,
  AzTasks,
  azureMonitor,
  AzWebappConfigAppsettingsSetSettings,
  AzWebappDeploySettings,
} from "../mod.ts";
import { FakeAz, json } from "./_fake.ts";

/** Record what a settings instance registers with the run's redactor. */
function recording<S extends AzSettings>(settings: S): {
  settings: S;
  marked: string[];
} {
  const marked: string[] = [];
  // The redactor's seam is the protected markSecret; wrap it on the instance
  // rather than declare a recording subclass of every command.
  Object.defineProperty(settings, "markSecret", {
    value: (value: string) => marked.push(value),
  });
  return { settings, marked };
}

Deno.test("H1: no list element or operand can be read as an option", async () => {
  const injected = "--subscription=attacker";
  const refusals: Array<() => unknown> = [
    () => new AzAccountGetAccessTokenSettings().scope(injected).argv(),
    () =>
      new AzGroupCreateSettings().name("g").location("l").tag("-k", "v").argv(),
    () =>
      new AzMonitorMetricsListSettings().resource("r").metrics("Ok", injected)
        .argv(),
    () =>
      new AzMonitorMetricsListSettings().resource("r").splitBy(injected).argv(),
    () => new AzMonitorActivityLogListSettings().select(injected).argv(),
    () =>
      new AzMonitorLogAnalyticsQuerySettings().workspace("w").analyticsQuery(
        "q",
      )
        .workspaces(injected).argv(),
    () =>
      new AzContainerappUpdateSettings().name("a").resourceGroup("g")
        .removeEnvVars(injected).argv(),
    () => new AzContainerappUpdateSettings().setEnvVar("-X", "1"),
    () => new AzContainerappIngressTrafficSetSettings().revisionWeight("-r", 1),
    () => new AzAcrBuildSettings().registry("r").source(injected).argv(),
    () => new AzAcrBuildSettings().buildArg("-X", "1"),
    () => new AzWebappConfigAppsettingsSetSettings().setting("-X", "1"),
  ];
  for (const refuse of refusals) assertThrows(refuse);
  await assertRejects(
    () =>
      AzTasks.monitorMetricsList((s) =>
        s.resource("r").metrics(injected).runner(new FakeAz("[]").run)
      ),
    Error,
    "starts with '-'",
  );
  // A single-valued option keeps a hyphen-led value as its value.
  assertEquals(
    new AzWebappDeploySettings().name("-odd").resourceGroup("g").srcPath("a")
      .argv().includes("--name=-odd"),
    true,
  );
});

Deno.test("H2: no typed value can make the CLI read a file", () => {
  const file = "@~/.azure/msal_token_cache.json";
  const refusals: Array<() => unknown> = [
    // A single-valued option: --name=@file is expanded by the CLI.
    () =>
      new AzWebappDeploySettings().name(file).resourceGroup("g").srcPath("a")
        .argv(),
    () => new AzSettings().subscription(file).argv(),
    () => new AzSettings().query("@.secret").argv(),
    () =>
      new AzMonitorLogAnalyticsQuerySettings().workspace("w")
        .analyticsQuery(file).argv(),
    () => new AzMonitorMetricsListSettings().resource("r").filter(file).argv(),
    // A list element: KEY=@file is expanded after its first '='.
    () =>
      new AzGroupCreateSettings().name("g").location("l").tag("k", file).argv(),
    () => new AzContainerappUpdateSettings().setEnvVar("K", file),
    () => new AzWebappConfigAppsettingsSetSettings().setting("K", file),
    () => new AzKeyvaultSecretSetSettings().tag("k", file),
    () => new AzMonitorMetricsListSettings().resource("r").metrics(file).argv(),
    () => new AzAcrBuildSettings().registry("r").source(file).argv(),
    // A key the CLI reads as a file, an option or a JSON document.
    () => new AzWebappConfigAppsettingsSetSettings().setting("@k", "v"),
    () => new AzWebappConfigAppsettingsSetSettings().setting('{"a"', "v"),
    () => new AzWebappConfigAppsettingsSetSettings().setting("[a", "v"),
    () => new AzWebappConfigAppsettingsSetSettings().setting("a=b", "v"),
    () => new AzWebappConfigAppsettingsSetSettings().setting("", "v"),
    () => new AzDeploymentGroupCreateSettings().parameter("@p", "v"),
    () =>
      new AzDeploymentGroupCreateSettings().resourceGroup("g")
        .templateFile("t").parametersFile(file).argv(),
  ];
  for (const refuse of refusals) assertThrows(refuse, Error);
  assertThrows(
    () => new AzSettings().subscription(file).argv(),
    Error,
    "starts with '@'",
  );
  // The CLI expands nothing after a token's first '=' unless it starts with
  // '@', so these pass: a bare '@', an '@' inside a value, and a value
  // inside one --flag=key=value token.
  assertEquals(new AzSettings().query("@").argv(), ["az", "--query=@"]);
  assertEquals(
    new AzSettings().query("[?name=='a@b']").argv(),
    ["az", "--query=[?name=='a@b']"],
  );
  assertEquals(
    new AzAcrBuildSettings().registry("r").source(".").buildArg("A", "@x")
      .argv().includes("--build-arg=A=@x"),
    true,
  );
});

/** A login whose standard input can be read back. */
class LoginProbe extends AzLoginSettings {
  /** What the CLI would read on standard input. */
  input(): string | undefined {
    return this.stdinInput();
  }
}

/** A secret set whose standard input can be read back. */
class SecretSetProbe extends AzKeyvaultSecretSetSettings {
  /** What the CLI would read on standard input. */
  input(): string | undefined {
    return this.stdinInput();
  }
}

/** An ACR login whose standard input can be read back. */
class AcrLoginProbe extends AzAcrLoginSettings {
  /** What the CLI would read on standard input. */
  input(): string | undefined {
    return this.stdinInput();
  }
}

/** A blob download whose standard input can be read back. */
class DownloadProbe extends AzStorageBlobDownloadSettings {
  /** What the CLI would read on standard input. */
  input(): string | undefined {
    return this.stdinInput();
  }
}

Deno.test("H3: a credential goes to standard input, never the argv, and is masked", () => {
  const cases: Array<
    [{ argv(): string[]; input(): string | undefined }, string]
  > = [
    [
      new LoginProbe().servicePrincipal().username("a").tenant("t")
        .password("client-secret-1"),
      "client-secret-1",
    ],
    [
      new LoginProbe().servicePrincipal().username("a").tenant("t")
        .federatedToken("federated-token-1"),
      "federated-token-1",
    ],
    [
      new SecretSetProbe().vaultName("kv").name("n").value("vault-secret-1"),
      "vault-secret-1",
    ],
    [
      new AcrLoginProbe().name("r").username("u").password("acr-password-1"),
      "acr-password-1",
    ],
    [
      new DownloadProbe().accountKey("account-key-1").containerName("c")
        .name("b").file("f"),
      "account-key-1",
    ],
  ];
  for (const [settings, secret] of cases) {
    assertEquals(settings.argv().some((t) => t.includes(secret)), false);
    assertEquals(settings.input(), secret);
  }
  assertEquals(new LoginProbe().identity().input(), undefined);
  assertEquals(new DownloadProbe().input(), undefined);

  for (
    const mark of [
      (s: AzLoginSettings) => s.password("p-secret-1"),
      (s: AzLoginSettings) => s.federatedToken("p-secret-1"),
    ]
  ) {
    const { settings, marked } = recording(new AzLoginSettings());
    mark(settings);
    assertEquals(marked, ["p-secret-1"]);
  }
  const vault = recording(new AzKeyvaultSecretSetSettings());
  vault.settings.value("v-secret-1");
  assertEquals(vault.marked, ["v-secret-1"]);
  const acr = recording(new AzAcrLoginSettings());
  acr.settings.password("a-secret-1");
  assertEquals(acr.marked, ["a-secret-1"]);
  const build = recording(new AzAcrBuildSettings());
  build.settings.secretBuildArg("TOKEN", "b-secret-1");
  assertEquals(build.marked, ["b-secret-1"]);
  const storage = recording(new AzStorageBlobDownloadSettings());
  storage.settings.sasToken("s-secret-1");
  assertEquals(storage.marked, ["s-secret-1"]);
});

Deno.test("H3: the spawned CLI receives the credential on standard input", async () => {
  // A real subprocess — the running deno, not az — through the same run path
  // a command takes, so the stdin hook is proven to reach the child.
  class StdinEcho extends AzSettings {
    /** The value the child reads. */
    protected override stdinInput(): string {
      return "piped-secret";
    }
  }
  const output = await new StdinEcho().toolPath(Deno.execPath())
    .command(
      "eval",
      "console.log(new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer()))",
    )
    .quiet().run();
  assertEquals(output.stdout.trim(), "piped-secret");
});

Deno.test("H4: credential-bearing commands pin json and mask what they print", async () => {
  const token = recording(
    new AzAccountGetAccessTokenSettings().output("tsv").query("accessToken"),
  );
  const tokenFake = new FakeAz(
    json({ accessToken: "eyJ.access-token.1", tokenType: "Bearer" }),
  );
  await token.settings.runner(tokenFake.run).run();
  assertEquals(tokenFake.flag(0, "--output"), "json");
  assertEquals(token.marked.includes("eyJ.access-token.1"), true);
  assertEquals(token.marked.includes("Bearer"), false);

  // A query that reshapes the answer away from the key: every scalar counts.
  const reshaped = recording(
    new AzAccountGetAccessTokenSettings().query("[accessToken, expiresOn]"),
  );
  await reshaped.settings.runner(
    new FakeAz(json(["eyJ.access-token.2", "2026-10-07"])).run,
  ).run();
  assertEquals(reshaped.marked.includes("eyJ.access-token.2"), true);

  const acr = recording(
    new AzAcrLoginSettings().name("r").exposeToken().output("table"),
  );
  const acrFake = new FakeAz(json({
    loginServer: "r.azurecr.io",
    username: "00000000-0000-0000-0000-000000000000",
    accessToken: "acr-token-value-1",
    refreshToken: "acr-token-value-1",
  }));
  await acr.settings.runner(acrFake.run).run();
  assertEquals(acrFake.flag(0, "--output"), "json");
  assertEquals(acr.marked.includes("acr-token-value-1"), true);
  assertEquals(acr.marked.includes("r.azurecr.io"), false);

  const secret = JSON.stringify({
    host: "db.internal",
    password: "db-pass-123",
  });
  for (
    const settings of [
      new AzKeyvaultSecretShowSettings().vaultName("kv").name("db"),
      new AzKeyvaultSecretSetSettings().vaultName("kv").name("db").file("f"),
    ]
  ) {
    const shown = recording(settings.output("yaml"));
    const fake = new FakeAz(
      json({ id: "https://kv/secrets/db", value: secret }),
    );
    await shown.settings.runner(fake.run).run();
    assertEquals(fake.flag(0, "--output"), "json");
    assertEquals(shown.marked.includes(secret), true);
    assertEquals(shown.marked.includes("db-pass-123"), true);
    assertEquals(shown.marked.includes("db.internal"), false);
  }

  // Plain text, the form a pinned format cannot be, is registered whole.
  const plain = recording(new AzKeyvaultSecretShowSettings().id("x"));
  await plain.settings.runner(new FakeAz("plain-secret-text\n").run).run();
  assertEquals(plain.marked, ["plain-secret-text"]);
});

Deno.test("H5: debug registers the credentials the CLI reads from the environment", () => {
  const names = [
    "AZURE_CLIENT_SECRET",
    "AZURE_STORAGE_KEY",
    "AZURE_STORAGE_CONNECTION_STRING",
    "AZURE_STORAGE_SAS_TOKEN",
    "AZURE_DEVOPS_EXT_PAT",
    "ARM_CLIENT_SECRET",
  ];
  const previous = names.map((name) => Deno.env.get(name));
  names.forEach((name, i) => Deno.env.set(name, `debug-${i}-credential`));
  Deno.env.set("AZURE_STORAGE_SAS_TOKEN", "");
  try {
    const { settings, marked } = recording(new AzSettings());
    settings.debug();
    assertEquals(marked.sort(), [
      "debug-0-credential",
      "debug-1-credential",
      "debug-2-credential",
      "debug-4-credential",
      "debug-5-credential",
    ]);
  } finally {
    names.forEach((name, i) => {
      const value = previous[i];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    });
  }
});

Deno.test("H6: a runner never sees settings whose argv a refusal rejects", async () => {
  // A runner that never builds the argv itself, unlike FakeAz: the refusal
  // must still fire, because the settings build it before handing over.
  let handedOver = 0;
  const ignoring = () => {
    handedOver++;
    return Promise.resolve(new CommandOutput(0, "{}", ""));
  };
  await assertRejects(
    () =>
      AzTasks.groupCreate((s) =>
        s.name("g").location("l").tag("k", "@/etc/passwd").runner(ignoring)
      ),
    Error,
    "starts with '@'",
  );
  await assertRejects(
    () =>
      AzTasks.monitorMetricsList((s) =>
        s.resource("r").metrics("--subscription=x").runner(ignoring)
      ),
    Error,
    "starts with '-'",
  );
  assertEquals(handedOver, 0);
});

Deno.test("H7: a reader's failed command is a CommandError even under noThrow", async () => {
  const failing = () =>
    new FakeAz(new CommandOutput(1, "", "AuthorizationFailed"));
  const readers: Array<() => Promise<unknown>> = [
    () => AzTasks.subscriptionId((s) => s.noThrow().runner(failing().run)),
    () => AzTasks.accessToken((s) => s.noThrow().runner(failing().run)),
    () => AzTasks.secretValue((s) => s.id("x").noThrow().runner(failing().run)),
    () =>
      AzTasks.metricValue((s) =>
        s.resource("r").aggregation("Total").noThrow().runner(failing().run)
      ),
  ];
  for (const reader of readers) await assertRejects(reader, CommandError);
});

Deno.test("H8: a query set through .az(...) does not reach the analysis's command", async () => {
  const fake = new FakeAz(json([{
    name: { value: "m" },
    timeseries: [{ data: [] }],
  }]));
  await azureMonitor((m) =>
    m.resource("r").metric("m").aggregation("Total").max(1).missingDataAs(0)
      .az((a) => a.query("bogus").output("table").runner(fake.run))
  ).validate({ redact: (t) => t });
  assertEquals(fake.flag(0, "--query"), "value");
  assertEquals(fake.flag(0, "--output"), "json");
});

Deno.test("H9: aks get-credentials refuses to print credentials", () => {
  assertThrows(
    () => new AzAksGetCredentialsSettings().file("-"),
    Error,
    "build log",
  );
});

Deno.test("H10: masking finds numbers, booleans and credentials nested in lists", async () => {
  const reshaped = recording(
    new AzAccountGetAccessTokenSettings().query("[expires_on, tokenType]"),
  );
  await reshaped.settings.runner(new FakeAz(json([1791633600, true])).run)
    .run();
  assertEquals(reshaped.marked.sort(), ["1791633600", "true"]);
  const secret = JSON.stringify([
    { db: { password: "nested-pass-123" } },
    { note: "short" },
  ]);
  const shown = recording(new AzKeyvaultSecretShowSettings().id("x"));
  await shown.settings.runner(new FakeAz(json({ value: secret })).run).run();
  assertEquals(shown.marked.includes("nested-pass-123"), true);
  assertEquals(shown.marked.includes("short"), false);
});
