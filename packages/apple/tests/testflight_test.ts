// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT
// cspell:ignore paiement

import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  TestFlightError,
  type TestFlightSettings,
  TestFlightTasks,
} from "../mod.ts";
import { apiKey, type AscCall, type AscRoute, fakeAsc } from "./_asc.ts";

const PEM = (await apiKey()).pem;

/** A fake App Store Connect with one app, its build states served in order. */
function store(
  states: Array<string | undefined>,
  extra: AscRoute = () => undefined,
): { fetch: typeof fetch; calls: AscCall[] } {
  let poll = 0;
  return fakeAsc((call) => {
    const answer = extra(call);
    if (answer !== undefined) return answer;
    const { method, path } = call;
    if (method === "GET" && path.startsWith("/v1/apps?")) {
      return {
        body: {
          data: [
            { id: "app-2", attributes: { bundleId: "com.example.app.widget" } },
            { id: "app-1", attributes: { bundleId: "com.example.app" } },
          ],
        },
      };
    }
    if (method === "GET" && path.startsWith("/v1/builds?")) {
      const state = states[Math.min(poll++, states.length - 1)];
      return {
        body: {
          data: state === undefined
            ? []
            : [{ id: "build-1", attributes: { processingState: state } }],
        },
      };
    }
    if (
      method === "GET" && path === "/v1/builds/build-1/betaBuildLocalizations"
    ) {
      return {
        body: {
          data: [{ id: "loc-en", attributes: { locale: "en-US" } }],
        },
      };
    }
    if (method === "GET" && path.startsWith("/v1/betaGroups?")) {
      return {
        body: {
          data: [
            { id: "g-qa", attributes: { name: "QA" } },
            { id: "g-ext", attributes: { name: "External" } },
            { id: "g-x", attributes: {} },
          ],
        },
      };
    }
    if (method === "PATCH" || method === "POST") return { status: 201 };
    return undefined;
  });
}

/** Settings against `fake`, with a clock that sleeping advances. */
function against(
  fake: { fetch: typeof fetch },
  log: string[] = [],
): (s: TestFlightSettings) => TestFlightSettings {
  let now = 0;
  return (s) =>
    s.issuerId("i").keyId("k").privateKey(PEM).fetch(fake.fetch)
      .now(() => now).sleep((ms) => {
        now += ms;
        return Promise.resolve();
      }).log((line) => log.push(line))
      .bundleId("com.example.app").buildNumber(42);
}

Deno.test("distribute: waits for processing, then compliance, notes, groups, review", async () => {
  const fake = store([undefined, "PROCESSING", "PROCESSING", "VALID"]);
  const log: string[] = [];
  const build = await TestFlightTasks.distribute((s) =>
    against(fake, log)(s).version("1.4.0").platform("IOS")
      .pollInterval("1m").usesNonExemptEncryption(false)
      .whatToTest("New checkout.").whatToTest("Nouveau paiement.", "fr-FR")
      .group("QA").group("External").submitForBetaReview()
  );
  assertEquals(build, {
    id: "build-1",
    appId: "app-1",
    buildNumber: "42",
    processingState: "VALID",
  });
  assertEquals(log, [
    "TestFlight: build 42 of com.example.app is not uploaded yet",
    "TestFlight: build 42 of com.example.app is PROCESSING",
    "TestFlight: build 42 of com.example.app is VALID",
    "TestFlight: added build 42 to QA, External",
    "TestFlight: submitted build 42 for beta review",
  ]);
  const writes = fake.calls.filter((c) => c.method !== "GET")
    .map((c) => [c.method, c.path, c.body]);
  assertEquals(writes, [
    ["PATCH", "/v1/builds/build-1", {
      data: {
        type: "builds",
        id: "build-1",
        attributes: { usesNonExemptEncryption: false },
      },
    }],
    ["PATCH", "/v1/betaBuildLocalizations/loc-en", {
      data: {
        type: "betaBuildLocalizations",
        id: "loc-en",
        attributes: { whatsNew: "New checkout." },
      },
    }],
    ["POST", "/v1/betaBuildLocalizations", {
      data: {
        type: "betaBuildLocalizations",
        attributes: { locale: "fr-FR", whatsNew: "Nouveau paiement." },
        relationships: { build: { data: { type: "builds", id: "build-1" } } },
      },
    }],
    ["POST", "/v1/builds/build-1/relationships/betaGroups", {
      data: [{ type: "betaGroups", id: "g-qa" }, {
        type: "betaGroups",
        id: "g-ext",
      }],
    }],
    ["POST", "/v1/betaAppReviewSubmissions", {
      data: {
        type: "betaAppReviewSubmissions",
        relationships: { build: { data: { type: "builds", id: "build-1" } } },
      },
    }],
  ]);
  const buildQuery = fake.calls.find((c) => c.path.startsWith("/v1/builds?"));
  assertEquals(
    buildQuery?.path,
    "/v1/builds?filter[app]=app-1&filter[version]=42" +
      "&filter[preReleaseVersion.version]=1.4.0" +
      "&filter[preReleaseVersion.platform]=IOS&sort=-uploadedDate&limit=1",
  );
});

Deno.test("distribute: nothing is written that was not asked for", async () => {
  const fake = store(["VALID"]);
  await TestFlightTasks.distribute(against(fake));
  assertEquals(fake.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`), [
    "GET /v1/apps",
    "GET /v1/builds",
  ]);
});

Deno.test("distribute: compliance already answered by the build is not patched", async () => {
  const log: string[] = [];
  const fake = store(
    ["VALID"],
    (call) =>
      call.method === "GET" && call.path.startsWith("/v1/builds?")
        ? {
          body: {
            data: [{
              id: "build-1",
              attributes: {
                processingState: "VALID",
                usesNonExemptEncryption: false,
              },
            }],
          },
        }
        : undefined,
  );
  await TestFlightTasks.distribute((s) =>
    against(fake, log)(s).usesNonExemptEncryption(false)
  );
  assertEquals(fake.calls.filter((c) => c.method === "PATCH"), []);
  assertEquals(
    log.at(-1),
    "TestFlight: export compliance already answered by the build " +
      "(usesNonExemptEncryption: false)",
  );
  const appQuery = fake.calls.find((c) => c.path.startsWith("/v1/apps?"));
  assertEquals(
    appQuery?.path,
    "/v1/apps?filter[bundleId]=com.example.app&limit=200",
  );
});

Deno.test("distribute: a build that fails processing throws", async () => {
  for (const state of ["INVALID", "FAILED"]) {
    await assertRejects(
      () => TestFlightTasks.distribute(against(store(["PROCESSING", state]))),
      TestFlightError,
      `could not process build 42 of com.example.app: ${state}`,
    );
  }
});

Deno.test("distribute: a build still processing at the deadline throws", async () => {
  await assertRejects(
    () =>
      TestFlightTasks.distribute((s) =>
        against(store([undefined]))(s).timeout("2m").pollInterval("1m")
      ),
    TestFlightError,
    "build 42 of com.example.app was still not uploaded yet after 120s",
  );
  await assertRejects(
    () =>
      TestFlightTasks.distribute((s) =>
        against(store([undefined, "PROCESSING", "WEIRD"]))(s).timeout("3m")
          .pollInterval("1m")
      ),
    TestFlightError,
    "was still WEIRD after 180s",
  );
});

Deno.test("distribute: an unknown processing state reads as unknown", async () => {
  const log: string[] = [];
  const fake = fakeAsc((call) =>
    call.path.startsWith("/v1/apps")
      ? {
        body: {
          data: [{ id: "a", attributes: { bundleId: "com.example.app" } }],
        },
      }
      : { body: { data: [{ id: "b", attributes: {} }] } }
  );
  await assertRejects(
    () =>
      TestFlightTasks.distribute((s) =>
        against(fake, log)(s).timeout(1000).pollInterval(1000)
      ),
    TestFlightError,
    "still unknown",
  );
  assertEquals(log, ["TestFlight: build 42 of com.example.app is unknown"]);
});

Deno.test("distribute: a missing app or beta group is named", async () => {
  const noApp = fakeAsc(() => ({ body: { data: [] } }));
  await assertRejects(
    () => TestFlightTasks.distribute(against(noApp)),
    TestFlightError,
    "no app in App Store Connect has the bundle id com.example.app",
  );
  await assertRejects(
    () =>
      TestFlightTasks.distribute((s) =>
        against(store(["VALID"]))(s).group("Beta")
      ),
    TestFlightError,
    'no beta group named "Beta" — it has: QA, External.',
  );
  const noGroups = store(
    ["VALID"],
    (call) =>
      call.path.startsWith("/v1/betaGroups")
        ? { body: { data: [] } }
        : undefined,
  );
  await assertRejects(
    () => TestFlightTasks.distribute((s) => against(noGroups)(s).group("Beta")),
    TestFlightError,
    'no beta group named "Beta".',
  );
});

Deno.test("distribute: settings are checked", async () => {
  await assertRejects(
    () => TestFlightTasks.distribute((s) => s.bundleId("x")),
    Error,
    ".bundleId() and .buildNumber() are required",
  );
  assertThrows(
    () => TestFlightTasks.distribute((s) => s.pollInterval(10)),
    Error,
    ".pollInterval() must be at least 1000 ms, not 10",
  );
  assertThrows(
    () => TestFlightTasks.distribute((s) => s.timeout(0)),
    Error,
    ".timeout() must be at least 1 ms, not 0",
  );
});
