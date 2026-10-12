// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Handing values from a target to later jobs of the same workflow run.
 *
 * @module
 */

/**
 * Append `values` to the step's outputs (`$GITHUB_OUTPUT`), so later jobs
 * can read them as `needs.<job>.outputs.<name>`. Outside Actions there is no
 * such file and this does nothing.
 */
export async function writeStepOutputs(
  values: Readonly<Record<string, string>>,
  path: string | undefined = Deno.env.get("GITHUB_OUTPUT"),
): Promise<void> {
  if (path === undefined || path === "") return;
  const lines = Object.entries(values).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) || /[\r\n]/.test(value)) {
      throw new Error(
        `step output ${JSON.stringify(key)} must be a name and a single line`,
      );
    }
    return `${key}=${value}\n`;
  });
  await Deno.writeTextFile(path, lines.join(""), { append: true });
}
