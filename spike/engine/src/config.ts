// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The `sdk` block of `zuke.json`: which command starts the worker.
 *
 * @module
 */

import { isRecord } from "./protocol.ts";

/** Read `sdk.command` from the `zuke.json` text, naming what is wrong if not. */
export function sdkCommand(configText: string, where: string): string[] {
  const config: unknown = JSON.parse(configText);
  const sdk = isRecord(config) ? config.sdk : undefined;
  const command = isRecord(sdk) ? sdk.command : undefined;
  if (
    !Array.isArray(command) || command.length === 0 ||
    !command.every((part) => typeof part === "string")
  ) {
    throw new Error(
      `zuke: ${where} needs an "sdk": { "command": [...] } block naming the ` +
        `worker to start, e.g. ["uv", "run", "build.py"]`,
    );
  }
  return command;
}
