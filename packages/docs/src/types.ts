/**
 * Public types for {@link DocsTasks}: the per-package documentation input, the
 * project framing shown in the index, the options, and the task interface.
 *
 * @module
 */

/** One package's already-generated documentation, fed into the tasks. */
export interface PackageDoc {
  /** The published name, e.g. `@zuke/deno`. */
  name: string;
  /** The directory under `packagesDir` whose README receives the API block. */
  dir: string;
  /**
   * The package's API documentation text — typically the output of
   * `deno doc <entry>` (machine-specific `Defined in …` lines are stripped for
   * you). Produced by the caller, so this package never has to run `deno`.
   */
  doc: string;
}

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
  /** Extra bullet lines appended to the "do not guess" list. */
  guidance?: string[];
}

/** Options accepted by {@link DocsTasks.apiDocs} and {@link DocsTasks.checkApiDocs}. */
export interface ApiDocsOptions {
  /** Directory holding the package subdirectories. Default `"packages"`. */
  packagesDir?: string;
  /** Base URL for package documentation links. Default `"https://jsr.io"`. */
  jsrBaseUrl?: string;
  /** Output path for the short index. Default `"llms.txt"`. */
  index?: string;
  /** Output path for the full reference. Default `"llms-full.txt"`. */
  full?: string;
  /** Inject a generated `## API` block into each package README. Default `true`. */
  readmes?: boolean;
  /** Project framing for the index. Falls back to a generic blurb. */
  project?: ProjectInfo;
  /** Command shown in "regenerate with …" notes. Default `"deno task docs"`. */
  regenerateCommand?: string;
}

/** The shape of {@link DocsTasks}. */
export interface DocsTasksApi {
  /**
   * From the supplied per-package docs, generate the index, the full reference,
   * and (unless disabled) each package README's API block, writing only the
   * files whose content changed. Returns the paths written.
   */
  apiDocs(docs: PackageDoc[], options?: ApiDocsOptions): Promise<string[]>;
  /**
   * Recompute every artifact and return the paths that are out of date on disk
   * (empty when everything is current). Writes nothing.
   */
  checkApiDocs(docs: PackageDoc[], options?: ApiDocsOptions): Promise<string[]>;
}
