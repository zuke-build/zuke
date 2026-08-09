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
  actionDigest,
  type ActionPinFile,
  assertReleasable,
  assertWorkflowInputsAvailable,
  declaredInputs,
  draftReleaseUrl,
  latestVersion,
  majorTag,
  nextVersion,
  parseVersion,
  pinBody,
  pinBranch,
  pinFor,
  pinnedSha,
  pinSubject,
  releaseAction,
  type ReleaseActionDeps,
  releaseIsOwed,
  workflowActionInputs,
} from "../build/action_release.ts";

const SHA = "a".repeat(40);

/** The commit an already-cut tag resolves to, distinct from HEAD. */
const TAGGED_SHA = "b".repeat(40);

/** The inputs a pin records, for tests that do not care which. */
const INPUTS = ["target", "ref"];

/** A well-formed SHA-256, for the pin file digest. */
const DIGEST = "c".repeat(64);

/** A manifest declaring {@link INPUTS}, for the release fakes. */
const MANIFEST = `name: "Zuke Build"
inputs:
  target:
    description: "x"
  ref:
    description: "y"

runs:
  using: composite
`;

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
    // Defaults to the tag the "unchanged" cases use, so those describe a
    // repository whose pin already matches its newest release — the ordinary
    // steady state, where there is genuinely nothing to do.
    committedPin: () => pinFor(SHA, "v1.4.0", INPUTS, DIGEST),
    shaOf: () => Promise.resolve(TAGGED_SHA),
    actionSource: () => Promise.resolve(MANIFEST),
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
  assertEquals(
    pinFor(SHA, "v1.0.0", INPUTS, DIGEST).ref,
    `zuke-build/zuke@${SHA}`,
  );
  assertEquals(pinFor(SHA, "v1.0.0", INPUTS, DIGEST).version, "v1.0.0");
  assertThrows(() => pinFor("abc1234", "v1.0.0", INPUTS, DIGEST));
  assertThrows(() => pinFor("v1.0.0", "v1.0.0", INPUTS, DIGEST));
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
  assertEquals(pinFor(SHA, "v1.2.3", INPUTS, DIGEST).version, "v1.2.3");
  assertThrows(() => pinFor(SHA, "v1.0.0\n", INPUTS, DIGEST));
  assertThrows(() => pinFor(SHA, "v1.0.0 # comment", INPUTS, DIGEST));
  assertThrows(() => pinFor(SHA, "latest", INPUTS, DIGEST));
  assertThrows(() => pinFor(SHA, "", INPUTS, DIGEST));
});

Deno.test("a malformed pin names the file rather than throwing a TypeError", () => {
  // `ActionPinFile` describes the shape of a committed JSON file, and a type
  // cannot hold a hand edit to its contents. Reading the SHA off a split and
  // using whatever comes back surfaced a malformed ref as a TypeError several
  // lines later, from inside the gate check — the least useful place to learn
  // that a file needs fixing.
  assertEquals(
    pinnedSha({
      ref: `zuke-build/zuke@${SHA}`,
      version: "v1",
      inputs: INPUTS,
      digest: DIGEST,
    }),
    SHA,
  );
  let message = "";
  try {
    pinnedSha({
      ref: "zuke-build/zuke",
      version: "v1.0.0",
      inputs: INPUTS,
      digest: DIGEST,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, ACTION_VERSION_FILE);
  assertStringIncludes(message, "40-character-sha");
  // A short SHA is malformed for the same reason `pinFor` rejects one.
  assertThrows(() =>
    pinnedSha({
      ref: "zuke-build/zuke@abc1234",
      version: "v1",
      inputs: INPUTS,
      digest: DIGEST,
    })
  );
});

Deno.test("input names are read out of an action manifest", () => {
  const manifest = `name: "Zuke Build"
inputs:
  target:
    description: "x"
    default: ""
  # a comment inside the block

  egress-policy:
    description: "y"

runs:
  using: composite
  steps:
    - name: not-an-input
`;
  // The keys of `inputs:`, and nothing from `runs:` — a step's name is two
  // levels deep in a different block and would otherwise read as an input.
  assertEquals(declaredInputs(manifest), ["target", "egress-policy"]);
  assertEquals(declaredInputs('name: "x"\nruns:\n  using: composite\n'), []);
});

Deno.test("a workflow's inputs are read only from the action's own steps", () => {
  const yaml = `jobs:
  gate:
    steps:
      - name: Harden and check out with Zuke
        uses: zuke-build/zuke@${SHA} # v1.0.1
        with:
          egress-policy: block
          ref: main
      - name: Something else
        uses: actions/checkout@${SHA}
        with:
          fetch-depth: "0"
          repository: other/repo
      - run: ./zuke ci
`;
  // Counting every `with:` in the file would compare another action's inputs
  // against this action's list and reject the workflow for having a checkout
  // in it.
  assertEquals(workflowActionInputs(yaml), ["egress-policy", "ref"]);
});

Deno.test("an input the pinned release lacks fails, naming it", () => {
  // The failure this exists for, and it is a quiet one: GitHub warns on an
  // undeclared input and carries on, so the job runs without it and nothing
  // says why.
  const pin = pinFor(SHA, "v1.0.0", ["target", "egress-policy"], DIGEST);
  assertWorkflowInputsAvailable(pin, ["target", "egress-policy"]);
  let message = "";
  try {
    assertWorkflowInputsAvailable(pin, ["target", "ref", "deno-version"]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertStringIncludes(message, "deno-version, ref");
  assertStringIncludes(message, "v1.0.0");
  assertStringIncludes(message, "actionRelease");
});

Deno.test("a change that alters no input does not fail the check", () => {
  // The reason this is not a digest of the whole file. Most changes to
  // action.yml are bumps to the actions it wraps — Dependabot's weekly work —
  // which alter no input and break no workflow. Failing on those blocked the
  // bot's own pull requests, and those bumps cannot be released until they
  // have merged, so the gate was unpassable for the automation the pin
  // manifest exists to serve.
  const before = pinFor(
    SHA,
    "v1.0.1",
    declaredInputs(`inputs:
  target:
    description: "x"
runs:
  steps:
    - uses: step-security/harden-runner@${"a".repeat(40)}
`),
    DIGEST,
  );
  const afterBump = declaredInputs(`inputs:
  target:
    description: "x"
runs:
  steps:
    - uses: step-security/harden-runner@${"b".repeat(40)}
`);
  assertEquals(before.inputs, afterBump);
  assertWorkflowInputsAvailable(before, afterBump);
});

Deno.test("a release must declare at least one input", () => {
  // The check compares what the workflows pass against this list, so an empty
  // one would reject every workflow that configures anything.
  assertThrows(() => pinFor(SHA, "v1.0.0", [], DIGEST));
});

Deno.test("the committed pin lists the inputs action.yml declares", () => {
  // The two are written together by `actionRelease`, and drift between them is
  // exactly what the gate check reads. This asserts the committed pair agree
  // on the *shape* — the gate asserts the workflows fit inside it.
  const pin: ActionPinFile = JSON.parse(
    Deno.readTextFileSync(ACTION_VERSION_FILE),
  );
  assertEquals(pin.inputs.length > 0, true);
  for (const name of pin.inputs) {
    assertEquals(
      /^[a-z][a-z0-9-]*$/.test(name),
      true,
      `${ACTION_VERSION_FILE} records an input that is not a name: ${name}`,
    );
  }
});

Deno.test("every YAML shape that broke the line reader now parses", () => {
  // Five review findings and four fixes came out of reading these files line by
  // line: a comment ended the block, flow style read as empty, a folded scalar
  // ended the block, a nested value contributed its own keys. Three were silent
  // under-reports, which is the outcome this check cannot afford — an input it
  // fails to see is an input nobody checks. Parsing removes the class, and this
  // is the list it has to stay removed for.
  const wf = (withBlock: string) =>
    `name: CI
jobs:
  gate:
    steps:
      - uses: zuke-build/zuke@${SHA}
${withBlock}      - run: ./zuke ci
`;

  const plain =
    "        with:\n          egress-policy: block\n          ref: main\n";
  assertEquals(workflowActionInputs(wf(plain)), ["egress-policy", "ref"]);

  // A comment used to end the block, hiding every input below it.
  assertEquals(
    workflowActionInputs(
      wf(
        "        with:\n          egress-policy: block\n          # why\n          ref: main\n",
      ),
    ),
    ["egress-policy", "ref"],
  );

  // A folded scalar's lines are host:port pairs, which used to look like the
  // end of the block and lose everything after it.
  assertEquals(
    workflowActionInputs(
      wf(
        "        with:\n          allowed-endpoints: >\n            deno.land:443\n            jsr.io:443\n          ref: main\n",
      ),
    ),
    ["allowed-endpoints", "ref"],
  );

  // Flow style and quoted keys used to be refused outright, because reading
  // them wrong would have under-reported. They simply work now.
  assertEquals(
    workflowActionInputs(
      wf("        with: { egress-policy: block, ref: main }\n"),
    ),
    ["egress-policy", "ref"],
  );
  assertEquals(
    workflowActionInputs(
      wf(
        '        with:\n          "egress-policy": block\n          ref: main\n',
      ),
    ),
    ["egress-policy", "ref"],
  );

  // A nested value used to contribute its own keys as inputs nobody passes.
  assertEquals(
    workflowActionInputs(
      wf(
        "        with:\n          config:\n            key: value\n          ref: main\n",
      ),
    ),
    ["config", "ref"],
  );
});

Deno.test("only this action's own steps count", () => {
  // Every step has a `with:`. Counting them all would compare another action's
  // inputs against this action's list and reject every workflow for having a
  // checkout in it.
  const yaml = `name: CI
jobs:
  gate:
    steps:
      - uses: zuke-build/zuke@${SHA}
        with:
          ref: main
      - uses: actions/checkout@${SHA}
        with:
          fetch-depth: "0"
          repository: other/repo
      - run: ./zuke ci
`;
  assertEquals(workflowActionInputs(yaml), ["ref"]);
});

Deno.test("a manifest's inputs parse whatever the style", () => {
  assertEquals(
    declaredInputs("name: x\ninputs:\n  target:\n    description: y\n  ref:\n"),
    ["target", "ref"],
  );
  // Four-space indent, which the line reader silently returned nothing for
  // until it learnt to take the indent from the first entry.
  assertEquals(
    declaredInputs("name: x\ninputs:\n    target:\n        description: y\n"),
    ["target"],
  );
  // Flow style, which the line reader had to refuse.
  assertEquals(declaredInputs("name: x\ninputs: { target: {} }\n"), ["target"]);
  // No inputs at all is an empty list, not an error — `pinFor` is what refuses
  // to pin that, with a message about the release.
  assertEquals(declaredInputs("name: x\nruns:\n  using: composite\n"), []);
});

Deno.test("a change no workflow can see is reported, not failed", () => {
  // The counterpart to the input check, and the reason both exist. Inputs cover
  // what breaks a workflow now; this covers what a workflow cannot see at all —
  // a guard added to the action, a step reordered — which reaches consumers
  // only when the tag moves. Left unreleased that is release lag, not a fault,
  // and failing on it is what made the first version of this check unpassable
  // on any pull request that touched the file.
  const source = 'name: "Zuke Build"\ninputs:\n  target:\n';
  return actionDigest(source).then(async (digest) => {
    const pin = pinFor(SHA, "v1.0.1", ["target"], digest);
    assertEquals(await releaseIsOwed(pin, source), false);
    assertEquals(await releaseIsOwed(pin, `${source}# a new guard\n`), true);
    // CRLF is not a change. A Windows checkout would otherwise report a drift
    // that exists on one platform and not the other.
    assertEquals(
      await releaseIsOwed(pin, source.replace(/\n/g, "\r\n")),
      false,
    );
  });
});

Deno.test("the proposed pin branch and subject are derived from the version", () => {
  assertEquals(pinBranch("v1.0.3"), "chore/action-v1.0.3");
  assertStringIncludes(pinSubject("v1.0.3"), "v1.0.3");
  // Both are interpolated into git arguments, so a value that is not a release
  // tag is refused rather than passed through.
  assertThrows(() => pinBranch("v1"));
  assertThrows(() => pinBranch("; rm -rf /"));
  assertThrows(() => pinSubject("core-v1.0.0"));
});

Deno.test("the pin commit is a chore, and its body has no fenced block", () => {
  // `chore:` because this changes no package. release-please parses every
  // merged subject, so a `feat:`/`fix:` here would cut a package release for a
  // commit that touched none.
  assertEquals(pinSubject("v1.0.3").startsWith("chore: "), true);
  // The repository squash-merges, so the body becomes the commit body, and
  // prBodyLint rejects fences — release-please's parser can choke on
  // parentheses inside one and drop the commit silently.
  assertEquals(pinBody("v1.0.3").includes("```"), false);
  assertStringIncludes(pinBody("v1.0.3"), "v1.0.3");
});

Deno.test("a tagged release whose pin never landed is proposed again", async () => {
  // The failure this exists to prevent is silent and permanent. A release is
  // two halves: the tags, which reach consumers, and the pin, which lands in a
  // pull request. If that pull request fails after the tags are pushed, asking
  // only "has action.yml changed since the newest tag?" answers no — the tag
  // names this very commit — and answers no on every run afterwards. Consumers
  // are updated, this repository is stale, and the build reports success.
  const { deps, calls, pins } = fakeDeps({
    tags: () => Promise.resolve(["v1.4.0"]),
    changedSince: () => Promise.resolve(false),
    committedPin: () => pinFor(SHA, "v1.3.0", INPUTS, DIGEST),
  });
  const result = await releaseAction(deps);

  // Re-proposed, not re-cut: the tags are already correct.
  assertEquals(result.released, "v1.4.0");
  assertEquals(result.retried, true);
  assertEquals(calls, ["writePin"]);

  // The pin names the commit the tag points at, not HEAD — master may have
  // moved on since the release, and the pin has to name what was released.
  assertEquals(pins[0].version, "v1.4.0");
  assertEquals(pins[0].ref, `zuke-build/zuke@${TAGGED_SHA}`);
});

Deno.test("a pin that matches the newest tag is left alone", async () => {
  // The other side of the same guard: with the pin already up to date there is
  // nothing outstanding, and re-proposing on every push would be a loop.
  const { deps, calls } = fakeDeps({
    tags: () => Promise.resolve(["v1.4.0"]),
    changedSince: () => Promise.resolve(false),
    committedPin: () => pinFor(SHA, "v1.4.0", INPUTS, DIGEST),
  });
  const result = await releaseAction(deps);
  assertEquals(result.released, undefined);
  assertEquals(result.retried, undefined);
  assertEquals(calls, []);
});
