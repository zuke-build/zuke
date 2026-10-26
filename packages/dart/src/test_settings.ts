// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Settings for `dart test`.
 *
 * @module
 */

import type { PathLike } from "@zuke/core/tooling";
import { pathOperand, wholeNumber } from "./operand.ts";
import { DartSettings } from "./settings.ts";

/** Settings for `dart test`. */
export class DartTestSettings extends DartSettings {
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

  /** Apply a preset from `dart_test.yaml` (`--preset`); repeatable. */
  preset(name: string): this {
    return this.#push("--preset", name);
  }

  /** Run skipped tests too (`--run-skipped`). */
  runSkipped(): this {
    return this.#push("--run-skipped");
  }

  /** Stop after the first failure (`--fail-fast`). */
  failFast(): this {
    return this.#push("--fail-fast");
  }

  /** Run on a platform, e.g. `vm`, `chrome` or `node` (`--platform`); repeatable. */
  platform(name: string): this {
    return this.#push("--platform", name);
  }

  /** The compiler for a platform, e.g. `dart2js`, `dart2wasm` or `kernel` (`--compiler`); repeatable. */
  compiler(name: string): this {
    return this.#push("--compiler", name);
  }

  /** How many test suites to run at once (`--concurrency`). */
  concurrency(count: number): this {
    return this.#push(
      "--concurrency",
      String(wholeNumber("test", "concurrency", count, 1)),
    );
  }

  /** The default per-test timeout, e.g. `30s` or `2x` (`--timeout`). */
  timeout(value: string): this {
    return this.#push("--timeout", value);
  }

  /** Collect coverage into a directory of JSON reports (`--coverage`). */
  coverage(dir: PathLike): this {
    return this.#push(`--coverage=${String(dir)}`);
  }

  /** The console reporter: `compact`, `expanded`, `failures-only`, `github`, `json` or `silent` (`--reporter`). */
  reporter(name: string): this {
    return this.#push("--reporter", name);
  }

  /** Also write a reporter's output to a file, e.g. `json:report.json` (`--file-reporter`). */
  fileReporter(spec: string): this {
    return this.#push("--file-reporter", spec);
  }

  /** Shuffle test order with a seed, or `random` (`--test-randomize-ordering-seed`). */
  randomizeOrderingSeed(seed: string | number): this {
    return this.#push("--test-randomize-ordering-seed", String(seed));
  }

  /** Do not stop a test at its timeout (`--ignore-timeouts`). */
  ignoreTimeouts(): this {
    return this.#push("--ignore-timeouts");
  }

  /** Print stack traces without colour codes (`--no-color`). */
  noColor(): this {
    return this.#push("--no-color");
  }

  /**
   * Run one shard of the suite: `shard(index, total)` renders
   * `--total-shards total --shard-index index`, with `index` from 0.
   */
  shard(index: number, total: number): this {
    wholeNumber("test", "shard", total, 1);
    if (wholeNumber("test", "shard", index, 0) >= total) {
      throw new Error(
        `DartTasks.test: .shard() index ${index} is not below the total ` +
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

  /** Assemble the `dart test` argv. */
  protected override buildArgs(): string[] {
    return ["test", ...this.#flags, ...this.#paths];
  }
}
