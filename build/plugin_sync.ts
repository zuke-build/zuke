/**
 * Syncs `skills/` into `plugins/zuke/skills/` as real, committed file copies
 * rather than a symlink: a symlink survives a POSIX clone, but a Windows
 * clone made without `core.symlinks` enabled materializes it as a tiny text
 * file containing the link target — so the plugin ships zero skills there.
 * `pluginSync` regenerates the copy; `pluginSyncCheck` fails if it has
 * drifted from the source — the same generate-then-verify pattern as the
 * Terraform/OpenTofu wrappers (`build/hcl_gen.ts`).
 *
 * @module
 */

import { FileTasks } from "@zuke/core";

/** The skills tree that is the source of truth. */
export const SKILLS_SOURCE = "skills";

/** Where the plugin's copy of the skills tree is committed. */
export const SKILLS_DEST = "plugins/zuke/skills";

/** Every file under `dir`, as paths relative to `dir`, sorted for determinism. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for await (
      const entry of Deno.readDir(rel === "" ? dir : `${dir}/${rel}`)
    ) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(childRel);
      } else if (entry.isFile) {
        out.push(childRel);
      }
    }
  };
  try {
    await walk("");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return out.sort();
}

/**
 * Overwrite `dest` with a fresh recursive copy of `source`. Returns the
 * destination paths written (repo-relative).
 */
export async function syncPluginSkills(
  source: string = SKILLS_SOURCE,
  dest: string = SKILLS_DEST,
): Promise<string[]> {
  await FileTasks.remove(dest, { recursive: true });
  await FileTasks.copy(source, dest);
  return (await listFiles(dest)).map((file) => `${dest}/${file}`);
}

/**
 * The ways `dest` has drifted from `source`: a file missing from the copy, a
 * file in the copy no longer in the source, or a file whose content differs.
 * Empty means `dest` is an exact copy of `source`.
 */
export async function checkPluginSkillsSync(
  source: string = SKILLS_SOURCE,
  dest: string = SKILLS_DEST,
): Promise<string[]> {
  const [sourceFiles, destFiles] = await Promise.all([
    listFiles(source),
    listFiles(dest),
  ]);
  const destSet = new Set(destFiles);
  const sourceSet = new Set(sourceFiles);
  const stale: string[] = [];

  for (const file of sourceFiles) {
    if (!destSet.has(file)) {
      stale.push(`${dest}/${file} (missing)`);
      continue;
    }
    const [expected, actual] = await Promise.all([
      FileTasks.readText(`${source}/${file}`),
      FileTasks.readText(`${dest}/${file}`),
    ]);
    if (expected !== actual) {
      stale.push(`${dest}/${file} (content differs from ${source}/${file})`);
    }
  }
  for (const file of destFiles) {
    if (!sourceSet.has(file)) {
      stale.push(`${dest}/${file} (extra, not present in ${source}/)`);
    }
  }
  return stale.sort();
}
