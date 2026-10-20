// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `flutter test`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand } from "./operand.ts";
import { FlutterCompileSettings } from "./settings.ts";

/** `count` if it is a whole number from `min` up, else a friendly error. */
function wholeNumber(flag: string, count: number, min: number): number {
  if (!Number.isSafeInteger(count) || count < min) {
    throw new Error(
      `FlutterTasks.test: .${flag}() takes a whole number from ${min} up, ` +
        `not ${count}.`,
    );
  }
  return count;
}

/** Settings for `flutter test`. */
export class FlutterTestSettings extends FlutterCompileSettings {
  #paths: string[] = [];
  #flags: string[] = [];

  #push(...tokens: string[]): this {
    this.#flags.push(...tokens);
    return this;
  }

  /** A test file or directory to run (defaults to `test/`); repeatable. */
  path(path: PathLike): this {
    this.#paths.push(pathOperand(path));
    return this;
  }

  /** Collect coverage into `coverage/lcov.info` (`--coverage`). */
  coverage(): this {
    return this.#push("--coverage");
  }

  /** Where to write the lcov coverage report (`--coverage-path`). */
  coveragePath(path: PathLike): this {
    return this.#push("--coverage-path", String(path));
  }

  /** Merge with the existing coverage report (`--merge-coverage`). */
  mergeCoverage(): this {
    return this.#push("--merge-coverage");
  }

  /** Run only tests whose name matches a regular expression (`--name`); repeatable. */
  name(pattern: string): this {
    return this.#push("--name", pattern);
  }

  /** Run only tests whose name contains a string (`--plain-name`); repeatable. */
  plainName(text: string): this {
    return this.#push("--plain-name", text);
  }

  /** Run only tests with a tag expression (`--tags`). */
  tags(expression: string): this {
    return this.#push("--tags", expression);
  }

  /** Skip tests matching a tag expression (`--exclude-tags`). */
  excludeTags(expression: string): this {
    return this.#push("--exclude-tags", expression);
  }

  /** How many test suites to run at once (`--concurrency`). */
  concurrency(count: number): this {
    return this.#push(
      "--concurrency",
      String(wholeNumber("concurrency", count, 1)),
    );
  }

  /** The console reporter: `compact`, `expanded`, `github`, `json`, … (`--reporter`). */
  reporter(name: string): this {
    return this.#push("--reporter", name);
  }

  /** Also write a reporter's output to a file, e.g. `json:report.json` (`--file-reporter`). */
  fileReporter(spec: string): this {
    return this.#push("--file-reporter", spec);
  }

  /** Rewrite golden files instead of comparing against them (`--update-goldens`). */
  updateGoldens(): this {
    return this.#push("--update-goldens");
  }

  /** Run on a platform other than the VM, e.g. `chrome` (`--platform`). */
  platform(name: string): this {
    return this.#push("--platform", name);
  }

  /** Shuffle test order with a seed, or `random` (`--test-randomize-ordering-seed`). */
  randomizeOrderingSeed(seed: string | number): this {
    return this.#push("--test-randomize-ordering-seed", String(seed));
  }

  /** The default per-test timeout, e.g. `30s` or `2x` (`--timeout`). */
  timeout(value: string): this {
    return this.#push("--timeout", value);
  }

  /**
   * Run one shard of the suite: `shard(index, total)` renders
   * `--total-shards total --shard-index index`, with `index` from 0.
   */
  shard(index: number, total: number): this {
    wholeNumber("shard", total, 1);
    if (wholeNumber("shard", index, 0) >= total) {
      throw new Error(
        `FlutterTasks.test: .shard() index ${index} is not below the total ` +
          `${total}.`,
      );
    }
    return this.#push(
      "--total-shards",
      String(total),
      "--shard-index",
      String(index),
    );
  }

  /** Assemble the `flutter test` argv. */
  protected override buildArgs(): string[] {
    return ["test", ...this.#flags, ...this.compileArgs(), ...this.#paths];
  }
}
