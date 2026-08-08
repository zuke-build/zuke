/**
 * Unit tests for `build/action_release.ts` — the versioning behind the
 * repository's own Marketplace action.
 *
 * Every test drives {@link releaseAction} through fakes, so none of this
 * touches git or the network. The behaviours worth pinning are the guard that
 * stops a release loop, the ordering of the writes, and the numeric tag sort.
 *
 * @module
 */

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../packages/core/tests/_assert.ts";
import {
  ACTION_VERSION_FILE,
  type ActionPinFile,
  assertPinnedActionMatches,
  assertReleasable,
  draftReleaseUrl,
  latestVersion,
  majorTag,
  nextVersion,
  parseVersion,
  pinFor,
  releaseAction,
  type ReleaseActionDeps,
} from "../build/action_release.ts";

const SHA = "a".repeat(40);

/** A recording set of dependencies, with everything defaulted to a no-op. */
function fakeDeps(overrides: Partial<ReleaseActionDeps> = {}): {
  deps: ReleaseActionDeps;
  calls: string[];
  pins: ActionPinFile[];
} {
  const calls: string[] = [];
  const pins: ActionPinFile[] = [];
  const deps: ReleaseActionDeps = {
    state: () =>
      Promise.resolve({
        branch: "master",
        dirty: false,
        syncedWithRemote: true,
      }),
    tags: () => Promise.resolve([]),
    changedSince: () => Promise.resolve(true),
    headSha: () => Promise.resolve(SHA),
    tag: (t, _m, force) => {
      calls.push(`tag:${t}${force ? ":force" : ""}`);
      return Promise.resolve();
    },
    push: (t, force) => {
      calls.push(`push:${t}${force ? ":force" : ""}`);
      return Promise.resolve();
    },
    writePin: (pin) => {
      calls.push("writePin");
      pins.push(pin);
      return Promise.resolve();
    },
    info: () => {},
    ...overrides,
  };
  return { deps, calls, pins };
}

Deno.test("only a full v-major-minor-patch tag parses as a release", () => {
  // The moving `v1` pointer and the 350-plus component tags share the
  // repository's tag namespace; treating either as a release would pick the
  // wrong base to bump from.
  assertEquals(parseVersion("v1.2.3")?.patch, 3);
  assertEquals(parseVersion("v1"), undefined);
  assertEquals(parseVersion("core-v1.33.0"), undefined);
  assertEquals(parseVersion("cli-vv0.1.0"), undefined);
  assertEquals(parseVersion("v1.2.3-rc1"), undefined);
});

Deno.test("the newest release is found numerically, not lexically", () => {
  // The bug this exists to prevent shows up exactly once: a lexical sort puts
  // "v1.9.0" above "v1.10.0", so the tenth release would bump from the ninth
  // and collide with a tag that already exists.
  const tags = ["v1.9.0", "v1.10.0", "v1.2.0", "core-v1.33.0", "v1"];
  assertEquals(latestVersion(tags)?.tag, "v1.10.0");
  assertEquals(latestVersion(["core-v1.0.0", "v1"]), undefined);
});

Deno.test("the first release is v1.0.0 and later ones bump the patch", () => {
  assertEquals(nextVersion(undefined), "v1.0.0");
  assertEquals(nextVersion(parseVersion("v1.9.0")), "v1.9.1");
  assertEquals(nextVersion(parseVersion("v1.10.3")), "v1.10.4");
});

Deno.test("the major tag is derived, and a non-release is refused", () => {
  assertEquals(majorTag("v1.2.3"), "v1");
  assertThrows(() => majorTag("v1"));
  assertThrows(() => majorTag("core-v1.0.0"));
});

Deno.test("a pin must carry a full commit SHA", () => {
  // A short SHA or a tag in the generated workflows would be an unpinned
  // reference, which is the thing the pin arrangement exists to prevent — and
  // supply-chain scanners flag it.
  assertEquals(pinFor(SHA, "v1.0.0").ref, `zuke-build/zuke@${SHA}`);
  assertEquals(pinFor(SHA, "v1.0.0").version, "v1.0.0");
  assertThrows(() => pinFor("abc1234", "v1.0.0"));
  assertThrows(() => pinFor("v1.0.0", "v1.0.0"));
});

Deno.test("an unchanged action.yml releases nothing", async () => {
  // The loop breaker. This target's own commit is another push to master, so
  // without the guard the second run would tag again, and so would the third.
  const { deps, calls } = fakeDeps({
    tags: () => Promise.resolve(["v1.4.0"]),
    changedSince: () => Promise.resolve(false),
  });
  const result = await releaseAction(deps);
  assertEquals(result.released, undefined);
  assertStringIncludes(result.reason ?? "", "unchanged since v1.4.0");
  assertEquals(calls, []);
});

Deno.test("a changed action.yml tags the next patch and moves the major", async () => {
  const { deps, calls, pins } = fakeDeps({
    tags: () => Promise.resolve(["v1.4.0", "core-v1.33.0"]),
    changedSince: () => Promise.resolve(true),
  });
  const result = await releaseAction(deps);
  assertEquals(result.released, "v1.4.1");
  // The pin is written before either tag: a failure in between leaves a tree
  // naming a version that cannot be resolved, which is loud, rather than a
  // published tag nothing references, which would look like success.
  assertEquals(calls, [
    "writePin",
    "tag:v1.4.1",
    "push:v1.4.1",
    "tag:v1:force",
    "push:v1:force",
  ]);
  assertEquals(pins[0].ref, `zuke-build/zuke@${SHA}`);
  assertEquals(pins[0].version, "v1.4.1");
});

Deno.test("a repository with no action release yet starts at v1.0.0", async () => {
  const { deps, calls } = fakeDeps({
    tags: () => Promise.resolve(["core-v1.0.0"]),
  });
  // No previous tag means nothing to diff against, so the guard cannot run and
  // the first release must happen unconditionally.
  const result = await releaseAction(deps);
  assertEquals(result.released, "v1.0.0");
  assertEquals(calls[1], "tag:v1.0.0");
});

Deno.test("the operator is told the one step that stays manual", async () => {
  // GitHub gates the Marketplace tick behind a 2FA confirmation no token can
  // perform, so a run that says only "tagged" would read as finished when it
  // is not.
  const messages: string[] = [];
  const { deps } = fakeDeps({ info: (m) => messages.push(m) });
  await releaseAction(deps);
  const printed = messages.join("\n");
  assertStringIncludes(printed, draftReleaseUrl("v1.0.0"));
  assertStringIncludes(printed, "browser");
});

Deno.test("the committed pin file matches what the module expects", () => {
  // The generated workflows reference the action at this pin, so a hand edit
  // that breaks its shape would unpin every job.
  const pin: ActionPinFile = JSON.parse(
    Deno.readTextFileSync(ACTION_VERSION_FILE),
  );
  assertEquals(
    /^zuke-build\/zuke@[0-9a-f]{40}$/.test(pin.ref),
    true,
    `${ACTION_VERSION_FILE} does not pin a full commit SHA: ${pin.ref}`,
  );
  assertEquals(
    parseVersion(pin.version) !== undefined,
    true,
    `${ACTION_VERSION_FILE} has no release version: ${pin.version}`,
  );
});

Deno.test("a release is refused from anywhere but a clean, synced master", () => {
  // The tag moves for every consumer of the action and there is no undo short
  // of another force-push, so each of these is a way to publish a commit
  // nobody reviewed.
  const ok = { branch: "master", dirty: false, syncedWithRemote: true };
  assertReleasable(ok);
  // A feature branch would publish unmerged work.
  assertThrows(() => assertReleasable({ ...ok, branch: "feat/x" }));
  // A detached HEAD has no branch to check.
  assertThrows(() => assertReleasable({ ...ok, branch: undefined }));
  // A dirty tree makes `changedSince` see an edit the tagged commit lacks, so
  // the release misrepresents itself and the next run cuts another.
  assertThrows(() => assertReleasable({ ...ok, dirty: true }));
  // A diverged branch names a commit nobody else has.
  assertThrows(() => assertReleasable({ ...ok, syncedWithRemote: false }));
});

Deno.test("the guards run before anything is written", async () => {
  // Ordering matters: a release refused after the pin was written would leave
  // the tree pointing at a version that was never tagged.
  const { deps, calls } = fakeDeps({
    state: () =>
      Promise.resolve({
        branch: "feat/x",
        dirty: false,
        syncedWithRemote: true,
      }),
  });
  let threw = false;
  try {
    await releaseAction(deps);
  } catch {
    threw = true;
  }
  assertEquals(threw, true, "releasing from a feature branch was allowed");
  assertEquals(calls, []);
});

Deno.test("a pin version must be exactly a release tag", () => {
  // It is rendered as the `# vX.Y.Z` comment beside every generated `uses:`,
  // and that comment is not escaped — so a newline would emit a stray line
  // into six workflow files. JavaScript's `$` matches before a trailing
  // newline, which is exactly how such a value would slip through.
  assertEquals(pinFor(SHA, "v1.2.3").version, "v1.2.3");
  assertThrows(() => pinFor(SHA, "v1.0.0\n"));
  assertThrows(() => pinFor(SHA, "v1.0.0 # comment"));
  assertThrows(() => pinFor(SHA, "latest"));
  assertThrows(() => pinFor(SHA, ""));
});

Deno.test("a pinned release that differs from this action.yml is rejected", () => {
  // The generated workflows run the *pinned* action, not the file beside them.
  // Nothing else notices when the two diverge, and every other test in this
  // repository asserts against the working tree — so they stay green while an
  // input added here is silently ignored there and a guard added here protects
  // nobody.
  const yaml = 'name: "Zuke Build"\n';
  assertReleasable({ branch: "master", dirty: false, syncedWithRemote: true });
  assertPinnedActionMatches(yaml, yaml, "v1.0.0");
  assertThrows(() =>
    assertPinnedActionMatches(yaml, `${yaml}inputs:\n  ref:\n`, "v1.0.0")
  );
  // The message has to name the fix; a bare mismatch tells nobody what to do.
  let message = "";
  try {
    assertPinnedActionMatches(yaml, "different\n", "v1.2.3");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "v1.2.3");
  assertStringIncludes(message, "actionRelease");
});
