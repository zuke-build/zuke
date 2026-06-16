import { assertEquals } from "./_assert.ts";
import { ciHost, isCI } from "../src/host.ts";

/** Run `fn` with several environment variables temporarily set/unset. */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, Deno.env.get(key));
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("ciHost detects the provider and isCI follows", async () => {
  await withEnv(
    { GITHUB_ACTIONS: "true", GITLAB_CI: undefined, CI: undefined },
    () => {
      assertEquals(ciHost(), "github-actions");
      assertEquals(isCI(), true);
    },
  );
  await withEnv(
    { GITHUB_ACTIONS: undefined, GITLAB_CI: "true", CI: undefined },
    () => {
      assertEquals(ciHost(), "gitlab-ci");
    },
  );
  await withEnv(
    { GITHUB_ACTIONS: undefined, GITLAB_CI: undefined, CI: "true" },
    () => {
      assertEquals(ciHost(), "ci");
      assertEquals(isCI(), true);
    },
  );
  await withEnv(
    { GITHUB_ACTIONS: undefined, GITLAB_CI: undefined, CI: undefined },
    () => {
      assertEquals(ciHost(), "local");
      assertEquals(isCI(), false);
    },
  );
});
