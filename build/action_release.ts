/**
 * Versioning for the repository's own composite action — the `zuke-build/zuke`
 * listing on the GitHub Marketplace.
 *
 * The action is released on its own tag line (`v1`, `v1.0.0`, …), separate from
 * the component tags release-please cuts for the packages. Nothing else moves
 * those tags, and a stale `v1` is not a cosmetic problem: Dependabot's bumps to
 * the pins in `action.yml` only reach consumers when the tag they name moves, so
 * a tag left where it is silently withholds the security fixes the whole pin
 * arrangement exists to deliver.
 *
 * What this module does *not* do is publish. Ticking "Publish this Action to
 * the GitHub Marketplace" needs a 2FA confirmation that GitHub performs only in
 * a browser, and app tokens — which is what this repository's release workflow
 * holds — are the case that still requires it. So the automation stops at the
 * tag and the version file, and prints the one link a human still has to open.
 *
 * @module
 */

import actionVersion from "./action_version.json" with { type: "json" };

/** A parsed `v<major>.<minor>.<patch>` action tag. */
export interface ActionVersion {
  /** The tag as written, e.g. `v1.2.3`. */
  tag: string;
  /** The major component. */
  major: number;
  /** The minor component. */
  minor: number;
  /** The patch component. */
  patch: number;
}

/**
 * The committed pin for the action, as `build/action_version.json` holds it.
 *
 * This file is the reason the generated workflows can reference the action
 * without the pins folding back on themselves. `build/action_pins.ts` reads
 * every *other* action's pin out of `action.yml`, which the generator never
 * writes; the action cannot pin itself there, so its own pin lives here — also
 * a file the generator never writes, updated only by {@link releaseAction} at
 * the moment the action is actually tagged.
 */
export interface ActionPinFile {
  /** The pinned reference, `zuke-build/zuke@<40-character-sha>`. */
  ref: string;
  /** The tag that SHA was released as, e.g. `v1.0.0`. */
  version: string;
}

/** Where the committed self-pin lives, relative to the repository root. */
export const ACTION_VERSION_FILE = "build/action_version.json";

/**
 * The committed self-pin, as every generated workflow references it.
 *
 * Imported statically rather than read at run time so a malformed file is a
 * build error rather than a workflow generated with a broken `uses:` line.
 */
export const ACTION_PIN: ActionPinFile = actionVersion;

/** The action's repository slug, as a consumer writes it in `uses:`. */
export const ACTION_SLUG = "zuke-build/zuke";

/** Only a full `v<major>.<minor>.<patch>` counts. `v1` itself is not a release. */
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse an action release tag, or `undefined` when it is not one.
 *
 * Deliberately strict: the repository's 350-plus tags are overwhelmingly
 * component-scoped (`core-v1.33.0`, `cli-v1.0.0`), and the moving `v1` is a
 * pointer rather than a release. Anchoring the pattern is what keeps
 * {@link latestVersion} from mistaking either for one.
 */
export function parseVersion(tag: string): ActionVersion | undefined {
  const match = VERSION_TAG.exec(tag);
  if (match === null) return undefined;
  const [, major, minor, patch] = match;
  return {
    tag,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

/**
 * The newest action release among `tags`, or `undefined` when there is none.
 *
 * Ordered numerically rather than lexically, so `v1.10.0` sorts above `v1.9.0`
 * — the comparison a string sort gets wrong exactly once the tenth release
 * lands, which is late enough to be an unpleasant surprise.
 */
export function latestVersion(
  tags: readonly string[],
): ActionVersion | undefined {
  let newest: ActionVersion | undefined;
  for (const tag of tags) {
    const version = parseVersion(tag);
    if (version === undefined) continue;
    if (newest === undefined || compareVersions(version, newest) > 0) {
      newest = version;
    }
  }
  return newest;
}

/** Order two versions by major, then minor, then patch. */
function compareVersions(a: ActionVersion, b: ActionVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * The next patch after `current`, or the first release when there is none.
 *
 * Patch, always. A change to `action.yml` is a Dependabot bump to one of its
 * pins or an edit to its steps; neither adds an input, and adding one would be
 * a deliberate act that can set the version by hand. Guessing "minor" from a
 * diff would be a heuristic that is wrong quietly.
 */
export function nextVersion(current: ActionVersion | undefined): string {
  if (current === undefined) return "v1.0.0";
  return `v${current.major}.${current.minor}.${current.patch + 1}`;
}

/** The major-only tag that consumers write, e.g. `v1` for `v1.2.3`. */
export function majorTag(version: string): string {
  const parsed = parseVersion(version);
  if (parsed === undefined) {
    throw new Error(
      `not an action release tag: ${version}. Expected v<major>.<minor>.<patch>.`,
    );
  }
  return `v${parsed.major}`;
}

/** The pin file's contents for a release of `sha` as `version`. */
export function pinFor(sha: string, version: string): ActionPinFile {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `refusing to pin a reference that is not a full commit SHA: ${sha}. A ` +
        `short SHA or a tag would leave the generated workflows unpinned, ` +
        `which is what the whole pin arrangement exists to prevent.`,
    );
  }
  // The version becomes the `# vX.Y.Z` comment beside every generated `uses:`,
  // and that comment is rendered without escaping — so anything with a newline
  // in it would emit a stray line into six workflow files. Anchored with `\A`
  // and `\z` semantics rather than `^`/`$`, which in JavaScript would let
  // "v1.0.0\n" through.
  if (!/^v\d+\.\d+\.\d+$/.test(version) || /\s/.test(version)) {
    throw new Error(
      `refusing to pin an unrecognised version: ${JSON.stringify(version)}. ` +
        `It is rendered as the comment beside every generated \`uses:\`, ` +
        `unescaped, so it must be exactly \`v<major>.<minor>.<patch>\`.`,
    );
  }
  return { ref: `${ACTION_SLUG}@${sha}`, version };
}

/**
 * The commit SHA a pin names.
 *
 * `ActionPinFile` describes the shape of a committed JSON file, and a type
 * cannot hold a hand edit to its contents. Splitting on `@` and using whatever
 * comes back turns a malformed ref into a `TypeError` several lines later, from
 * the gate check — the least useful place to learn that a file needs fixing.
 *
 * @throws if `pin.ref` does not name a full commit SHA.
 */
export function pinnedSha(pin: ActionPinFile): string {
  const sha = pin.ref.split("@")[1];
  if (sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `${ACTION_VERSION_FILE} does not pin a full commit SHA: ${
        JSON.stringify(pin.ref)
      }. It must read \`${ACTION_SLUG}@<40-character-sha>\`.`,
    );
  }
  return sha;
}

/**
 * Assert that the pinned release of the action is the action in this tree.
 *
 * The generated workflows run `{@link ACTION_SLUG}@<pinned sha>`, not the
 * `action.yml` sitting next to them. Nothing else notices when those diverge,
 * and the failure is quiet in both directions:
 *
 * - a change to `action.yml` that is not yet released means the jobs run the
 *   *old* action. An input added here is silently ignored there — GitHub warns
 *   and carries on — so a job asking for `ref` gets the event's default
 *   checkout instead, and a guard added here protects nobody.
 * - the tests in `tests/action_manifest_test.ts` assert against this file, so
 *   they stay green either way. They describe the tree, not the artifact.
 *
 * @throws if the two differ, naming the target that fixes it.
 */
export function assertPinnedActionMatches(
  pinned: string,
  workingTree: string,
  version: string,
): void {
  if (pinned === workingTree) return;
  throw new Error(
    `action.yml has changed since ${version}, which is the release every ` +
      `generated workflow runs. Until it is re-released those jobs use the ` +
      `old action: a new input is ignored rather than honoured, and a new ` +
      `guard is absent rather than enforcing. Run \`./zuke actionRelease\` ` +
      `on master to cut the next version, then commit the pin and the ` +
      `regenerated workflows.`,
  );
}

/** The URL that opens a pre-filled release draft for `version`. */
export function draftReleaseUrl(version: string): string {
  return `https://github.com/${ACTION_SLUG}/releases/new?tag=${version}`;
}

/**
 * The repository state a release requires, as {@link ReleaseActionDeps.state}
 * reports it.
 *
 * Checked because this target force-moves a tag that every consumer of the
 * action follows, and each of these being wrong publishes something nobody
 * reviewed. There is no undo short of another force-push.
 */
export interface RepositoryState {
  /** The current branch, or `undefined` on a detached HEAD. */
  branch?: string;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  /** Whether HEAD matches the tracked remote branch. */
  syncedWithRemote: boolean;
}

/** The branch a release may be cut from. */
export const RELEASE_BRANCH = "master";

/**
 * Refuse to release from a state that would publish the wrong commit.
 *
 * @throws if HEAD is not {@link RELEASE_BRANCH}, the tree is dirty, or the
 * branch has diverged from its remote. Each is a way the tag ends up on a
 * commit that is not the reviewed one: a feature branch publishes unmerged
 * work to every consumer; a dirty tree makes `changedSince` see an edit that
 * the tagged commit does not contain, so the release misrepresents itself and
 * the next run diffs against it and cuts another.
 */
export function assertReleasable(state: RepositoryState): void {
  if (state.branch !== RELEASE_BRANCH) {
    throw new Error(
      `refusing to release the action from ${
        state.branch ?? "a detached HEAD"
      }: the tag moves for every consumer of \`${ACTION_SLUG}@v1\`, so it may ` +
        `only be cut from ${RELEASE_BRANCH}.`,
    );
  }
  if (state.dirty) {
    throw new Error(
      `refusing to release the action from a dirty working tree: the tag ` +
        `would land on HEAD while the change that triggered it is still ` +
        `uncommitted, so the release would not contain it.`,
    );
  }
  if (!state.syncedWithRemote) {
    throw new Error(
      `refusing to release the action from a branch that has diverged from ` +
        `its remote: the tag would name a commit nobody else has.`,
    );
  }
}

/** What {@link releaseAction} needs from the outside world. */
export interface ReleaseActionDeps {
  /** The repository state, checked before anything is written. */
  state(): Promise<RepositoryState>;
  /** Every tag in the repository. */
  tags(): Promise<readonly string[]>;
  /** Whether `action.yml` differs between `ref` and the working tree's HEAD. */
  changedSince(ref: string): Promise<boolean>;
  /** The commit SHA being released. */
  headSha(): Promise<string>;
  /** Create or move `tag` onto HEAD, annotated with `message`. */
  tag(tag: string, message: string, force: boolean): Promise<void>;
  /** Push `tag` to the remote, replacing it when `force`. */
  push(tag: string, force: boolean): Promise<void>;
  /** Write the committed self-pin. */
  writePin(pin: ActionPinFile): Promise<void>;
  /** Report progress. */
  info(message: string): void;
}

/** What a run of {@link releaseAction} did. */
export interface ReleaseActionResult {
  /** The version tagged, or `undefined` when there was nothing to release. */
  released?: string;
  /** Why nothing happened, when nothing did. */
  reason?: string;
}

/**
 * Tag a new version of the action when `action.yml` has changed since the last
 * one, and leave the tree carrying the matching pin.
 *
 * The "changed since the last release" guard is not only an optimisation. This
 * runs on a push to master and its own commit — the updated pin file and the
 * workflows regenerated from it — is another push to master. The guard is what
 * makes the second run a no-op instead of the first iteration of a loop, so
 * keep it ahead of any work that writes.
 */
export async function releaseAction(
  deps: ReleaseActionDeps,
): Promise<ReleaseActionResult> {
  assertReleasable(await deps.state());

  const current = latestVersion(await deps.tags());
  if (current !== undefined && !(await deps.changedSince(current.tag))) {
    const reason = `action.yml is unchanged since ${current.tag}.`;
    deps.info(`${reason} Nothing to release.`);
    return { reason };
  }

  const version = nextVersion(current);
  const major = majorTag(version);
  const sha = await deps.headSha();

  // The pin lands before the tag, so a failure between them leaves a tree that
  // names a version nobody can resolve — loud — rather than a published tag
  // that nothing references, which would look like success.
  await deps.writePin(pinFor(sha, version));

  await deps.tag(version, `Zuke Build action ${version}`, false);
  await deps.push(version, false);
  deps.info(`Tagged ${version} at ${sha}.`);

  await deps.tag(
    major,
    `Zuke Build action ${major} — the newest ${major}.x.y.`,
    true,
  );
  await deps.push(major, true);
  deps.info(`Moved ${major} to ${version}.`);

  deps.info(
    `Publishing to the Marketplace still needs one browser step, because ` +
      `GitHub gates it behind a 2FA confirmation no token can perform: ` +
      draftReleaseUrl(version),
  );
  return { released: version };
}
