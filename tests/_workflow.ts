// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Shared readers for the committed GitHub workflows, for the tests that assert
 * a property of a generated file rather than of the declaration behind it.
 *
 * The gate's `generate-ci --check` proves each committed workflow matches its
 * declaration in `build/workflows.ts`, so a test that pins a property of the
 * committed YAML pins it in both places — and the committed file is what
 * GitHub actually runs. Every such test parses the same shape (a workflow, its
 * jobs, their steps, the action a `uses:` names), so the parsing lives here
 * once rather than being retyped, and drifting, per test.
 *
 * @module
 */

import { parse } from "@std/yaml";

/** Whether a parsed YAML value is an object that can be indexed. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A committed workflow, parsed. */
export function readWorkflow(path: string): Record<string, unknown> {
  const parsed = parse(Deno.readTextFileSync(path));
  if (!isRecord(parsed)) throw new Error(`${path} is not a YAML mapping`);
  return parsed;
}

/** Every job in a parsed workflow, keyed by id. */
export function jobsOf(
  workflow: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const { jobs } = workflow;
  if (!isRecord(jobs)) throw new Error("the workflow has no jobs");
  return new Map(
    Object.entries(jobs).flatMap(([id, job]) =>
      isRecord(job) ? [[id, job]] : []
    ),
  );
}

/** The job with `id` in a committed workflow. */
export function jobIn(path: string, id: string): Record<string, unknown> {
  const job = jobsOf(readWorkflow(path)).get(id);
  if (job === undefined) throw new Error(`${path} has no ${id} job`);
  return job;
}

/** A job's steps, each as a record. */
export function stepsOf(
  job: Record<string, unknown>,
): Record<string, unknown>[] {
  const { steps } = job;
  if (!Array.isArray(steps)) throw new Error("the job has no steps");
  return steps.filter(isRecord);
}

/**
 * The action a step's `uses:` names, without its pin — or `undefined` for a
 * step that has none, which on GitHub means a `run:` step.
 */
export function actionOf(step: Record<string, unknown>): string | undefined {
  return typeof step.uses === "string" ? step.uses.split("@")[0] : undefined;
}
