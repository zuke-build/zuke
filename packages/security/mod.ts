// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/security` — typed task wrappers for free, open-source security scanners
 * (zizmor, actionlint, gitleaks, osv-scanner, semgrep, trivy) for Zuke builds.
 *
 * ```ts
 * import { SecurityTasks } from "jsr:@zuke/security";
 *
 * await SecurityTasks.zizmor((s) => s.paths(".github/workflows"));
 * await SecurityTasks.osvScanner((s) => s.lockfile("package-lock.json"));
 * await SecurityTasks.gitleaks((s) => s.source(".").redact());
 * ```
 *
 * @module
 */

export * from "./src/security.ts";
