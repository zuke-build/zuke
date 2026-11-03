// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Tasks of the other shapes the tool spec must read: an object
 * literal rather than an interface, positional JSON arguments with JSON
 * results, an optional argument, a task named by a Python keyword, settings
 * that run no command, and a setter that answers nothing.
 *
 * @module
 */

import type { Configure } from "@zuke/core/tooling";

/** Settings of a task that runs no command: a plain object with setters. */
export class Tuning {
  /** The level set last. */
  level_ = 0;

  /** Set the level. */
  level(n: number): this {
    this.level_ = n;
    return this;
  }

  /** Back to zero; answers nothing, as a setter written as a statement might. */
  reset(): void {
    this.level_ = 0;
  }
}

/** Plain functions of several shapes. */
export const TallyTasks = {
  /** Add two numbers. */
  add: (a: number, b: number): number => a + b,
  /** Do nothing, under a name Python reserves. */
  pass: (): void => {},
  /** Count the items, leaving out the one to skip. */
  count: (items: string[], skip?: string): number =>
    items.filter((item) => item !== skip).length,
  /** Tune, through settings that run nothing. */
  tune: (configure: Configure<Tuning>): number =>
    configure(new Tuning()).level_,
};
