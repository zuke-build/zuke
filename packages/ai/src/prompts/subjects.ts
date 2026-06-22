/**
 * What each built-in assessment asks the model to look for. Edit these strings
 * to tune a reviewer's focus — no logic lives here.
 *
 * @module
 */

import type { AssessmentType } from "../types.ts";

/** The subject phrase inserted into the system prompt, per assessment. */
export const SUBJECTS: Record<AssessmentType, string> = {
  generic: "",
  security:
    "security vulnerabilities — injection, broken authentication or authorization, secret leakage, unsafe deserialization, SSRF, and path traversal",
  secrets: "leaked secrets — credentials, API keys, tokens, or private keys",
  correctness: "correctness bugs, logic errors, and likely regressions",
  license:
    "license and dependency-compliance risk — incompatible licenses or newly added risky dependencies",
};
