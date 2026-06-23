/**
 * Public types for {@link DocsTasks}: the project framing shown in the index,
 * the options every task accepts, and the task interface itself.
 *
 * @module
 */

/** Project framing rendered into the `llms.txt` index. */
export interface ProjectInfo {
  /** Heading for the index, e.g. `"Zuke"`. */
  title: string;
  /** One-paragraph summary, rendered as the index's blockquote. */
  summary: string;
  /** An optional canonical code example, fenced under an "Example" heading. */
  example?: string;
  /** An optional install/scaffold command, shown in the "do not guess" list. */
  install?: string;
}

/** Options accepted by {@link DocsTasks.apiDocs} and {@link DocsTasks.checkApiDocs}. */
export interface ApiDocsOptions {
  /** Directory holding the package subdirectories. Default `"packages"`. */
  packagesDir?: string;
  /** JSR scope used for package names and links. Default `"@zuke"`. */
  scope?: string;
  /** Base URL for package documentation links. Default `"https://jsr.io"`. */
  jsrBaseUrl?: string;
  /** Output path for the short index. Default `"llms.txt"`. */
  index?: string;
  /** Output path for the full reference. Default `"llms-full.txt"`. */
  full?: string;
  /** Inject a generated `## API` block into each package README. Default `true`. */
  readmes?: boolean;
  /** Project framing for the index. Falls back to the scope and a generic blurb. */
  project?: ProjectInfo;
  /** Command shown in "regenerate with …" notes. Default `"deno task docs"`. */
  regenerateCommand?: string;
}

/** The shape of {@link DocsTasks}. */
export interface DocsTasksApi {
  /**
   * Generate the index, the full reference, and (unless disabled) each package
   * README's API block, writing only the files whose content changed. Returns
   * the repo-relative paths written.
   */
  apiDocs(packages: string[], options?: ApiDocsOptions): Promise<string[]>;
  /**
   * Recompute every artifact and return the paths that are out of date on disk
   * (empty when everything is current). Writes nothing.
   */
  checkApiDocs(packages: string[], options?: ApiDocsOptions): Promise<string[]>;
}
