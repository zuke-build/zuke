/**
 * Unit: the transport guard on the backends Zuke authenticates to and trusts
 * answers from — the state service, the build registry, and the remote cache.
 * Covers {@link assertSecureBackendUrl} itself and each `env*` resolver that
 * calls it, so a resolver that forgets the check fails here.
 */

import { assertEquals, assertThrows } from "./_assert.ts";
import {
  ALLOW_INSECURE_ENV,
  assertSecureBackendUrl,
  isLoopbackHost,
} from "../src/http.ts";
import { envStateStore } from "../src/state/resolve.ts";
import { envBuildRegistry } from "../src/registry/resolve.ts";
import { envCacheStore } from "../src/remote_cache.ts";
import type { StateHost } from "../src/state/store.ts";

/** Build a `readEnv` over a plain record. */
function env(
  vars: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => vars[name];
}

/** A {@link StateHost} that is never reached — these tests resolve, they do not store. */
const unusedHost: StateHost = {
  readText: () => Promise.reject(new Error("unused")),
  writeText: () => Promise.reject(new Error("unused")),
  rename: () => Promise.reject(new Error("unused")),
  createExclusive: () => Promise.reject(new Error("unused")),
  remove: () => Promise.reject(new Error("unused")),
  listDir: () => Promise.reject(new Error("unused")),
  mkdirp: () => Promise.reject(new Error("unused")),
  now: () => 0,
};

Deno.test("assertSecureBackendUrl accepts https and rejects plaintext", () => {
  assertSecureBackendUrl(
    "https://state.example/api",
    "ZUKE_STATE_URL",
    env({}),
  );
  const error = assertThrows(
    () =>
      assertSecureBackendUrl(
        "http://state.example/api",
        "ZUKE_STATE_URL",
        env({}),
      ),
    Error,
  );
  // The message must name both the variable at fault and the way out.
  assertEquals(error.message.includes("ZUKE_STATE_URL"), true);
  assertEquals(error.message.includes(ALLOW_INSECURE_ENV), true);
});

Deno.test("assertSecureBackendUrl refuses plaintext even with no token configured", () => {
  // Integrity, not just confidentiality: an on-path attacker choosing the
  // *answer* needs no credential to steal, so the guard cannot be conditional
  // on one being set.
  assertThrows(
    () =>
      assertSecureBackendUrl(
        "http://cache.example",
        "ZUKE_REMOTE_CACHE_URL",
        env({}),
      ),
    Error,
  );
});

Deno.test("assertSecureBackendUrl exempts loopback and honours the opt-out", () => {
  for (
    const url of [
      "http://localhost:8000",
      "http://127.0.0.1:9000/state",
      "http://127.15.2.1/state",
      "http://[::1]:8080",
    ]
  ) {
    assertSecureBackendUrl(url, "ZUKE_STATE_URL", env({}));
  }
  assertSecureBackendUrl(
    "http://state.internal/api",
    "ZUKE_STATE_URL",
    env({ [ALLOW_INSECURE_ENV]: "1" }),
  );
  // An empty opt-out is not an opt-out.
  assertThrows(
    () =>
      assertSecureBackendUrl(
        "http://state.internal/api",
        "ZUKE_STATE_URL",
        env({ [ALLOW_INSECURE_ENV]: "" }),
      ),
    Error,
  );
});

Deno.test("assertSecureBackendUrl redacts credentials in its message", () => {
  const error = assertThrows(
    () =>
      assertSecureBackendUrl(
        "http://user:hunter2@state.example/api?token=abcd",
        "ZUKE_STATE_URL",
        env({}),
      ),
    Error,
  );
  assertEquals(error.message.includes("hunter2"), false);
  assertEquals(error.message.includes("abcd"), false);
});

Deno.test("assertSecureBackendUrl leaves a non-URL to its own consumer", () => {
  // Not a URL at all: complaining here would report the wrong problem.
  assertSecureBackendUrl("not a url", "ZUKE_STATE_URL", env({}));
});

Deno.test("isLoopbackHost recognises loopback names and the 127/8 block only", () => {
  assertEquals(isLoopbackHost("localhost"), true);
  assertEquals(isLoopbackHost("127.0.0.1"), true);
  assertEquals(isLoopbackHost("::1"), true);
  assertEquals(isLoopbackHost("example.com"), false);
  assertEquals(isLoopbackHost("128.0.0.1"), false);
  // A host that merely *contains* a loopback literal is not loopback.
  assertEquals(isLoopbackHost("127.0.0.1.evil.example"), false);
});

Deno.test("every env-configured backend refuses a plaintext URL", () => {
  assertThrows(
    () =>
      envStateStore(
        env({ ZUKE_STATE_URL: "http://state.example" }),
        unusedHost,
      ),
    Error,
    "ZUKE_STATE_URL",
  );
  assertThrows(
    () =>
      envBuildRegistry(
        env({ ZUKE_REGISTRY_URL: "http://registry.example" }),
        unusedHost,
      ),
    Error,
    "ZUKE_REGISTRY_URL",
  );
  assertThrows(
    () => envCacheStore(env({ ZUKE_REMOTE_CACHE_URL: "http://cache.example" })),
    Error,
    "ZUKE_REMOTE_CACHE_URL",
  );
});

Deno.test("every env-configured backend still resolves over https", () => {
  assertEquals(
    envStateStore(
      env({ ZUKE_STATE_URL: "https://state.example" }),
      unusedHost,
    ) !==
      undefined,
    true,
  );
  assertEquals(
    envBuildRegistry(
      env({ ZUKE_REGISTRY_URL: "https://registry.example" }),
      unusedHost,
    ) !==
      undefined,
    true,
  );
  assertEquals(
    envCacheStore(env({ ZUKE_REMOTE_CACHE_URL: "https://cache.example" })) !==
      undefined,
    true,
  );
});
