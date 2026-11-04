// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The engine the compiled `zuke` binary carries.
 *
 * A project with no `zuke.ts` names its worker and an engine release in
 * `zuke.json`, and the CLI used to run that release with Deno. The binary is
 * compiled with `@zuke/engine` and every wrapper release inside it, so it runs
 * such a project itself: it starts its own executable again with
 * {@link EMBEDDED_ENGINE_ENV} set, and that process is the engine. Nothing
 * looks for Deno, and none need be installed. A run under `deno run`, or a
 * binary whose engine cannot serve the pinned release, goes the old way.
 *
 * @module
 */

/**
 * Set to `1` in the environment of the process that runs a hosted build on
 * the binary's own engine: the compiled entry reads it, before the CLI does,
 * and removes it, so nothing the build starts inherits it.
 */
export const EMBEDDED_ENGINE_ENV = "ZUKE_EMBEDDED_ENGINE";

/** The engine a compiled `zuke` carries, as its entry point describes it. */
export interface EmbeddedEngine {
  /** The `@zuke/engine` release compiled in, such as `1.3.0`. */
  readonly version: string;
  /** The executable to start in engine mode: the binary itself. */
  readonly program: string;
  /** Whether the compiled-in release serves the one `zuke.json` pins. */
  serves(pin: string): boolean;
}
