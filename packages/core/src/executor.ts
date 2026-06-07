/**
 * The executor: resolves a plan, runs each target body in order, reports
 * pass/fail with timing, and aborts on the first failure.
 *
 * Sequencing and de-duplication are handled by {@link plan} — the returned
 * order already contains each target exactly once, so diamond dependencies run
 * their shared prerequisite a single time.
 */

import type { Build, BuildResult } from "./build.ts";
import { plan } from "./graph.ts";
import type { TargetBuilder } from "./target.ts";

/** Sink for executor output, defaulting to the console. Overridable in tests. */
export interface Reporter {
  info(line: string): void;
  error(line: string): void;
}

const consoleReporter: Reporter = {
  info: (line) => console.log(line),
  error: (line) => console.error(line),
};

const silentReporter: Reporter = { info: () => {}, error: () => {} };

/** Options for {@link execute}. */
export interface ExecuteOptions {
  /** Suppress all banner/summary output (used by tests). */
  silent?: boolean;
  /** Custom reporter; overrides `silent`. */
  reporter?: Reporter;
  /** Target names to skip even if they appear in the plan (CLI `--skip`). */
  skip?: string[];
}

/** Format a duration in milliseconds as `1.2s`. */
function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Execute the requested target and its transitive dependencies.
 *
 * Runs the build's `onStart`/`onFinish` lifecycle hooks around the plan. Stops
 * at the first target that throws, reports it, and returns a failing result.
 */
export async function execute(
  build: Build,
  root: TargetBuilder,
  options: ExecuteOptions = {},
): Promise<BuildResult> {
  const reporter = options.reporter ??
    (options.silent ? silentReporter : consoleReporter);

  const skip = new Set(options.skip ?? []);
  const order = plan(root).filter((t) => !skip.has(t.name_ ?? ""));
  const executed: string[] = [];
  const overallStart = performance.now();

  await build.onStart();

  let result: BuildResult;
  try {
    for (const t of order) {
      const name = t.name_ ?? "<unnamed>";
      if (!t.fn_) {
        throw new Error(
          `Target "${name}" has no body — call .executes(...) before running.`,
        );
      }

      reporter.info(`▶ ${name}`);
      const start = performance.now();
      try {
        await t.fn_();
      } catch (error) {
        const elapsed = formatDuration(performance.now() - start);
        reporter.error(`✘ ${name} (${elapsed})`);
        reporter.error(
          error instanceof Error ? error.message : String(error),
        );
        result = { ok: false, executed, error };
        return await finish(
          build,
          reporter,
          result,
          overallStart,
          order.length,
        );
      }
      const elapsed = formatDuration(performance.now() - start);
      reporter.info(`✔ ${name} (${elapsed})`);
      executed.push(name);
    }
    result = { ok: true, executed };
  } catch (error) {
    // A pre-flight error (e.g. missing body) before/outside a target body.
    result = { ok: false, executed, error };
  }

  return await finish(build, reporter, result, overallStart, order.length);
}

/** Print the summary, run the finish hook, and return the result. */
async function finish(
  build: Build,
  reporter: Reporter,
  result: BuildResult,
  overallStart: number,
  planned: number,
): Promise<BuildResult> {
  const total = formatDuration(performance.now() - overallStart);
  const status = result.ok ? "SUCCESS" : "FAILED";
  reporter.info(
    `\n${result.ok ? "✔" : "✘"} ${status} — ` +
      `${result.executed.length}/${planned} targets in ${total}`,
  );
  await build.onFinish(result);
  return result;
}
