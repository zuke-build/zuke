// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link PrometheusGoogleSettings} — how the Google credential source finds
 * Application Default Credentials and what it asks for, named as Google's own
 * auth libraries name them: `scopes`, `credentialsFile`, `quotaProject`.
 *
 * @module
 */

/** The scope Managed Service for Prometheus needs to read: `monitoring.read`. */
const GOOGLE_MONITORING_READ_SCOPE =
  "https://www.googleapis.com/auth/monitoring.read";

/** Settings for `PrometheusConnectionSettings.google(...)`. */
export class PrometheusGoogleSettings {
  /** The OAuth scopes requested (set by {@link scopes}). */
  scopes_: readonly string[] = [GOOGLE_MONITORING_READ_SCOPE];
  /** An explicit credentials file (set by {@link credentialsFile}). */
  credentialsFile_?: string;
  /** The project billed for quota (set by {@link quotaProject}). */
  quotaProject_?: string;

  /**
   * The OAuth scopes to request, replacing the default
   * `https://www.googleapis.com/auth/monitoring.read`. A gcloud user
   * credential (`authorized_user`) carries the scopes it was granted at
   * `gcloud auth application-default login` and ignores these.
   */
  scopes(...scopes: string[]): this {
    if (scopes.length === 0 || scopes.some((scope) => scope === "")) {
      throw new Error(
        "google scopes(...) needs at least one non-empty scope.",
      );
    }
    this.scopes_ = scopes;
    return this;
  }

  /**
   * Read this credentials file — a service-account key, a gcloud user
   * credential, or a workload identity federation configuration — instead of
   * searching Application Default Credentials.
   */
  credentialsFile(path: string): this {
    this.credentialsFile_ = path;
    return this;
  }

  /**
   * The project charged for the request's quota, sent as
   * `x-goog-user-project`. Defaults to the credentials file's
   * `quota_project_id`, which `gcloud auth application-default
   * set-quota-project` writes.
   */
  quotaProject(project: string): this {
    this.quotaProject_ = project;
    return this;
  }
}
