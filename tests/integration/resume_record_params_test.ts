// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Integration: a stored run record cannot supply a `.secret()` parameter's
 * value. Secrets are never written into a record, so a record that names one
 * was crafted by whoever can write to the store; `zuke resume` must take the
 * secret from the environment, while the record's non-secret values still
 * replay. Driven through the real CLI `main()` against a temp store.
 */

import { assertEquals } from "../../packages/core/tests/_assert.ts";
import {
  Build,
  defaultStateHost,
  externalSignal,
  FileSystemStateStore,
  parameter,
  target,
} from "../../packages/core/mod.ts";
import { runCli, withStateDir } from "./_harness.ts";

const TOKEN_ENV = "ZUKE_IT_RECORD_PARAMS_TOKEN";

Deno.test("zuke resume re-resolves a secret from the environment, not the record", async () => {
  await withStateDir(async (dir) => {
    const seen: (string | undefined)[] = [];
    const store = new FileSystemStateStore(`${dir}/runs`, defaultStateHost);
    class CD extends Build {
      override stateStore() {
        return store;
      }
      token = parameter("deploy token").secret().env(TOKEN_ENV);
      env = parameter("target env").default("sit");
      deploy = target().executes(() => {});
      gate = target().dependsOn(this.deploy).waitsFor((s) =>
        s.on(externalSignal("approve"))
      );
      promote = target().dependsOn(this.gate).executes(() => {
        seen.push(this.token.value, this.env.value);
      });
    }

    Deno.env.set(TOKEN_ENV, "from-env");
    try {
      const first = await runCli(CD, ["promote"]);
      assertEquals(first.code, 0);
      const runId = (await store.listRuns({}))[0].id;
      const stored = await store.getRun(runId);
      if (stored === null) throw new Error("run missing");
      assertEquals(stored.record.params, { env: "sit" });

      // A store writer plants a value for the secret, and a non-secret one.
      await store.putRun(
        { ...stored.record, params: { env: "prod", token: "from-record" } },
        stored.version,
      );

      const resumed = await runCli(CD, [
        "resume",
        runId,
        "--signal",
        "approve",
      ]);
      assertEquals(resumed.code, 0);
      assertEquals(seen, ["from-env", "prod"]);
    } finally {
      Deno.env.delete(TOKEN_ENV);
    }
  });
});
