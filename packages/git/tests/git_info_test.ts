import { assertEquals, assertRejects } from "../../core/tests/_assert.ts";
import { gitInfo, type GitRunner } from "../src/git_info.ts";

/** Build a fake {@link GitRunner} from a map of `git <args>` → output (or null). */
function fakeRun(responses: Record<string, string | null>): GitRunner {
  return (args) => Promise.resolve(responses[args.join(" ")] ?? null);
}

Deno.test("gitInfo resolves a full clean repository", async () => {
  const info = await gitInfo({
    run: fakeRun({
      "rev-parse HEAD": "abcdef0123456789",
      "rev-parse --abbrev-ref HEAD": "master",
      "rev-parse --short HEAD": "abcdef0",
      "status --porcelain": "",
      "describe --tags --abbrev=0": "v1.2.3",
      "config --get remote.origin.url": "git@github.com:zuke-build/zuke.git",
    }),
  });
  assertEquals(info, {
    branch: "master",
    commit: "abcdef0123456789",
    shortCommit: "abcdef0",
    tag: "v1.2.3",
    dirty: false,
    remoteUrl: "git@github.com:zuke-build/zuke.git",
  });
});

Deno.test("gitInfo reports a dirty tree", async () => {
  const info = await gitInfo({
    run: fakeRun({
      "rev-parse HEAD": "9f01ab23",
      "rev-parse --abbrev-ref HEAD": "feature",
      "rev-parse --short HEAD": "9f01ab2",
      "status --porcelain": " M src/a.ts\n?? new.ts",
    }),
  });
  assertEquals(info.dirty, true);
  assertEquals(info.tag, undefined); // no tag configured
  assertEquals(info.remoteUrl, undefined); // no remote configured
});

Deno.test("gitInfo falls back when branch/short are unavailable (detached HEAD)", async () => {
  const info = await gitInfo({
    run: fakeRun({
      "rev-parse HEAD": "0123456789abcdef",
      "rev-parse --abbrev-ref HEAD": null,
      "rev-parse --short HEAD": null,
      "status --porcelain": "",
    }),
  });
  assertEquals(info.branch, "HEAD");
  assertEquals(info.shortCommit, "0123456"); // first 7 chars of the commit
});

Deno.test("gitInfo treats an empty tag/remote result as undefined", async () => {
  const info = await gitInfo({
    run: fakeRun({
      "rev-parse HEAD": "abc1234",
      "rev-parse --abbrev-ref HEAD": "main",
      "rev-parse --short HEAD": "abc1234",
      "status --porcelain": "",
      "describe --tags --abbrev=0": "",
      "config --get remote.origin.url": "",
    }),
  });
  assertEquals(info.tag, undefined);
  assertEquals(info.remoteUrl, undefined);
});

Deno.test("gitInfo throws when HEAD cannot be resolved", async () => {
  await assertRejects(
    () => gitInfo({ run: fakeRun({}) }),
    Error,
    "not a git repository",
  );
});

Deno.test("gitInfo's default runner returns nothing outside a repository", async () => {
  // Exercises the real spawning runner against a non-repo temp dir: whether git
  // exits non-zero or is absent, HEAD resolves to null and gitInfo throws.
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => gitInfo({ cwd: dir }),
      Error,
      "not a git repository",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
