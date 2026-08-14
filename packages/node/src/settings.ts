// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The base every `node` settings class extends: it pins the binary to `node`.
 *
 * It lives in its own module so the task settings (`./node.ts`) and the
 * value-returning evaluation settings (`./evaluate.ts`) can share it without
 * importing each other.
 *
 * @module
 */

import { ToolSettings } from "@zuke/core/tooling";

/** Shared base for every `node` task: it pins the binary to `node`. */
export abstract class NodeSettings extends ToolSettings {
  /** Pin the tool binary to `node`. */
  protected override defaultTool(): string {
    return "node";
  }
}
