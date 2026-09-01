// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The landing page's package catalogue, and the generator that renders it into
 * the website's `src/data/tools.ts`.
 *
 * The copy lives here, next to the packages it describes, so that adding or
 * removing a `@zuke/*` package updates the website in the same change — the
 * website used to keep its own hand-maintained list, which silently kept
 * advertising a package after it was dropped. {@linkcode renderToolsModule}
 * refuses to render a catalogue that disagrees with the real package list, so
 * the drift fails the gate instead of reaching the page.
 */

/** One package as the landing page presents it. */
export interface ToolEntry {
  /** The tool's display name, as a reader would say it ("Docker Compose"). */
  name: string;
  /** The JSR package that wraps it, e.g. `@zuke/docker-compose`. */
  pkg: string;
  /** A few words on what the wrapper covers — a grid cell, not a sentence. */
  desc: string;
}

/** A capability heading on the landing page, with the tools filed under it. */
export interface ToolGroup {
  /** The heading, e.g. "Containers & orchestration". */
  category: string;
  /** One line under the heading framing the category. */
  blurb: string;
  /** The tools in the group, in display order. */
  tools: ToolEntry[];
}

/** A first-party engine or plugin package — everything that is not a CLI wrapper. */
export interface CorePackage {
  /** The JSR package name, e.g. `@zuke/core`. */
  name: string;
  /** What it is, in a phrase. */
  desc: string;
}

/** The CLI wrappers, grouped by capability, in landing-page order. */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    category: "Runtimes & package managers",
    blurb: "Install, run, and publish across every major JS toolchain.",
    tools: [
      {
        name: "Deno",
        pkg: "@zuke/deno",
        desc: "run, test, check, fmt, lint, coverage",
      },
      {
        name: "Node",
        pkg: "@zuke/node",
        desc: "run scripts, npx, version pinning",
      },
      {
        name: "npm",
        pkg: "@zuke/npm",
        desc: "install, ci, run scripts, publish",
      },
      { name: "Bun", pkg: "@zuke/bun", desc: "install, add, run, x, bun test" },
      {
        name: "pnpm",
        pkg: "@zuke/pnpm",
        desc: "frozen installs, dlx, --filter",
      },
      {
        name: "Yarn",
        pkg: "@zuke/yarn",
        desc: "Classic & Berry: install, add, dlx",
      },
      {
        name: "npx",
        pkg: "@zuke/npx",
        desc: "download & run a package binary in one step",
      },
    ],
  },
  {
    category: "Bundlers & monorepo",
    blurb: "Bundle apps and orchestrate monorepos from a typed pipeline.",
    tools: [
      { name: "Vite", pkg: "@zuke/vite", desc: "dev, build, preview" },
      {
        name: "Storybook",
        pkg: "@zuke/storybook",
        desc: "dev server, static build",
      },
      { name: "tsup", pkg: "@zuke/tsup", desc: "zero-config bundling" },
      {
        name: "tsdown",
        pkg: "@zuke/tsdown",
        desc: "fast TS bundling on Rolldown",
      },
      { name: "Turbo", pkg: "@zuke/turbo", desc: "run, prune" },
      { name: "Nx", pkg: "@zuke/nx", desc: "run, runMany, affected" },
    ],
  },
  {
    category: "TypeScript runners & compilers",
    blurb:
      "Execute, type-check, and compile TypeScript with or without a build step.",
    tools: [
      { name: "tsx", pkg: "@zuke/tsx", desc: "run TS on Node, watch" },
      // Since TypeScript 7.0 this binary is the native Go compiler.
      {
        name: "tsc",
        pkg: "@zuke/tsc",
        desc: "the TypeScript compiler, now Go-native, --build",
      },
      {
        name: "tsc-alias",
        pkg: "@zuke/tsc-alias",
        desc: "rewrite path aliases after tsc",
      },
    ],
  },
  {
    category: "Frameworks & code generation",
    blurb: "Scaffold app frameworks and generate typed clients from a schema.",
    tools: [
      {
        name: "Nest",
        pkg: "@zuke/nest",
        desc: "NestJS: build, start, generate",
      },
      {
        name: "openapi-ts",
        pkg: "@zuke/openapi-ts",
        desc: "OpenAPI → typed TS client",
      },
      {
        name: "Orval",
        pkg: "@zuke/orval",
        desc: "generate API clients & mocks",
      },
      {
        name: "Redocly",
        pkg: "@zuke/redocly",
        desc: "lint, bundle & split OpenAPI",
      },
      { name: "docs", pkg: "@zuke/docs", desc: "generate API documentation" },
    ],
  },
  {
    category: "AI coding, review & self-healing",
    blurb:
      "Fold the major AI coding CLIs into a build, gate it on a model-assessed review, or let a fixer heal failures.",
    tools: [
      {
        name: "Claude Code",
        pkg: "@zuke/claude",
        desc: "headless run, model & tool limits, MCP",
      },
      {
        name: "OpenAI Codex",
        pkg: "@zuke/codex",
        desc: "codex exec headless, MCP config",
      },
      {
        name: "Gemini CLI",
        pkg: "@zuke/gemini",
        desc: "headless prompt, MCP & extensions",
      },
      {
        name: "AI review",
        pkg: "@zuke/ai",
        desc: "code-review gate with a structured risk score",
      },
      {
        name: "Self-healing",
        pkg: "@zuke/ai",
        desc:
          "diagnose, suggest & auto-fix failed builds, then re-run to verify",
      },
    ],
  },
  {
    category: "Lint, format & quality",
    blurb:
      "Keep the tree clean with linters, formatters, and dead-code checks.",
    tools: [
      { name: "oxlint", pkg: "@zuke/oxlint", desc: "ultra-fast Rust linter" },
      { name: "ESLint", pkg: "@zuke/eslint", desc: "configs, --fix, caching" },
      { name: "Biome", pkg: "@zuke/biome", desc: "check, format, lint, ci" },
      { name: "dprint", pkg: "@zuke/dprint", desc: "fmt, check" },
      { name: "cspell", pkg: "@zuke/cspell", desc: "spell-check your sources" },
      {
        name: "ShellCheck",
        pkg: "@zuke/shellcheck",
        desc: "lint shell scripts, with a dialect",
      },
      {
        name: "lint-staged",
        pkg: "@zuke/lint-staged",
        desc: "lint the staged files, or a diff",
      },
      { name: "Knip", pkg: "@zuke/knip", desc: "find unused files & exports" },
      {
        name: "dpdm",
        pkg: "@zuke/dpdm",
        desc: "detect circular deps & dependency trees",
      },
    ],
  },
  {
    category: "Test, coverage & browsers",
    blurb:
      "Run unit and end-to-end suites, then upload coverage to your dashboard.",
    tools: [
      {
        name: "Jest",
        pkg: "@zuke/jest",
        desc: "projects, coverage thresholds",
      },
      { name: "Vitest", pkg: "@zuke/vitest", desc: "watch, coverage, UI" },
      {
        name: "Playwright",
        pkg: "@zuke/playwright",
        desc: "test, codegen, reports",
      },
      { name: "Cypress", pkg: "@zuke/cypress", desc: "run, open, verify" },
      {
        name: "Codecov",
        pkg: "@zuke/codecov",
        desc: "upload coverage via codecovcli, flags, token from env",
      },
    ],
  },
  {
    category: "Containers & orchestration",
    blurb: "Build images and ship to clusters from a typed pipeline.",
    tools: [
      { name: "Docker", pkg: "@zuke/docker", desc: "build, tag, push, run" },
      {
        name: "Docker Compose",
        pkg: "@zuke/docker-compose",
        desc: "up, down, logs",
      },
      {
        name: "kubectl",
        pkg: "@zuke/kubectl",
        desc: "apply, get, rollout, logs",
      },
      {
        name: "Helm",
        pkg: "@zuke/helm",
        desc: "install, upgrade, template, lint",
      },
      {
        name: "Kustomize",
        pkg: "@zuke/kustomize",
        desc: "build, editSetImage",
      },
    ],
  },
  {
    category: "Cloud & infrastructure",
    blurb: "Provision and deploy with infra-as-code, typed end to end.",
    tools: [
      {
        name: "gcloud",
        pkg: "@zuke/gcloud",
        desc: "auth, builds, Cloud Run, Artifact Registry, GKE, storage",
      },
      {
        name: "Terraform",
        pkg: "@zuke/terraform",
        desc: "init, plan, apply, destroy",
      },
      { name: "OpenTofu", pkg: "@zuke/tofu", desc: "open-source Terraform" },
    ],
  },
  {
    category: "Version control, registry & CI",
    blurb: "Script Git, GitHub, and publishing straight from your build.",
    tools: [
      {
        name: "Git",
        pkg: "@zuke/git",
        desc: "commit, tag, push, merge-base, blame, gitInfo()",
      },
      { name: "GitHub CLI", pkg: "@zuke/gh", desc: "releases, PRs, workflows" },
      { name: "Husky", pkg: "@zuke/husky", desc: "install & manage git hooks" },
      { name: "JSR", pkg: "@zuke/jsr", desc: "publish, add, remove" },
      {
        name: "release-please",
        pkg: "@zuke/release-please",
        desc: "release PRs & GitHub releases",
      },
    ],
  },
  {
    category: "Supply-chain security",
    blurb: "Scan workflows, secrets, and dependencies as part of the gate.",
    tools: [
      {
        name: "Security",
        pkg: "@zuke/security",
        desc: "zizmor, gitleaks, trivy, semgrep, osv-scanner",
      },
    ],
  },
];

/** The engine and plugin packages, shown apart from the wrapper grid. */
export const CORE_PACKAGES: CorePackage[] = [
  {
    name: "@zuke/core",
    desc: "the Build base class, target() graph, $ shell, and cicd()",
  },
  {
    name: "@zuke/cli",
    desc:
      "the global zuke command: setup, run targets, --list, graph, generate-ci",
  },
  {
    name: "@zuke/cmd",
    desc: "the typed process layer the wrappers are built on",
  },
  {
    name: "@zuke/console",
    desc:
      "markup, rules, boxes & tables — the levelled logger behind Zuke's output",
  },
  {
    name: "@zuke/otel",
    desc:
      "OpenTelemetry export plugin — run & target spans over OTLP, joined across resume",
  },
];

/** Every `@zuke/*` package the catalogue mentions, deduped. */
export function curatedPackages(): Set<string> {
  return new Set([
    ...TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.pkg)),
    ...CORE_PACKAGES.map((entry) => entry.name),
  ]);
}

/**
 * How the catalogue differs from the real package list: packages with no entry
 * (they would be missing from the site) and entries naming a package that no
 * longer exists (the site would advertise it after it was dropped).
 */
export function catalogueDrift(
  packages: readonly string[],
): { missing: string[]; unknown: string[] } {
  const real = new Set(packages.map((pkg) => `@zuke/${pkg}`));
  const curated = curatedPackages();
  return {
    missing: [...real].filter((pkg) => !curated.has(pkg)).sort(),
    unknown: [...curated].filter((pkg) => !real.has(pkg)).sort(),
  };
}

/**
 * Render an object literal with bare keys, matching the style the file was
 * hand-written in. Keeping the shape means a sync PR diffs only the entries
 * that actually changed, instead of reformatting all of them once.
 */
function renderEntry(fields: Record<string, string>, indent: string): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
  return `${indent}{ ${body} },`;
}

/**
 * Render the website's `src/data/tools.ts`, the module its landing page imports
 * for the package grid. Throws when the catalogue and `packages` disagree, so a
 * package added or dropped in this repo cannot ship a stale page.
 */
export function renderToolsModule(packages: readonly string[]): string {
  const { missing, unknown } = catalogueDrift(packages);
  if (missing.length > 0 || unknown.length > 0) {
    const parts = [
      missing.length > 0
        ? `no landing-page entry for ${missing.join(", ")} — add one to ` +
          `TOOL_GROUPS or CORE_PACKAGES in build/website_tools.ts`
        : "",
      unknown.length > 0
        ? `entries for packages that no longer exist: ${unknown.join(", ")}`
        : "",
    ].filter((part) => part !== "");
    throw new Error(
      `The website package catalogue is out of date — ${parts.join("; ")}.`,
    );
  }

  const groups = TOOL_GROUPS.map((group) =>
    [
      "  {",
      `    category: ${JSON.stringify(group.category)},`,
      `    blurb: ${JSON.stringify(group.blurb)},`,
      "    tools: [",
      ...group.tools.map((tool) =>
        renderEntry(
          { name: tool.name, pkg: tool.pkg, desc: tool.desc },
          "      ",
        )
      ),
      "    ],",
      "  },",
    ].join("\n")
  ).join("\n");

  const core = CORE_PACKAGES
    .map((entry) => renderEntry({ name: entry.name, desc: entry.desc }, "  "))
    .join("\n");

  return `// Generated by \`zuke syncWebsite\` from build/website_tools.ts in
// zuke-build/zuke — do not edit by hand; the next release overwrites it.

/**
 * The Zuke tool-wrapper ecosystem — typed packages published to JSR under the
 * \`@zuke/*\` scope. Each wraps a real CLI with a fluent, strongly-typed API so
 * build steps are refactor-safe and editor-completable.
 */
export interface ToolGroup {
  category: string;
  blurb: string;
  tools: { name: string; pkg: string; desc: string }[];
}

export const toolGroups: ToolGroup[] = [
${groups}
];

/** The first-party engine and plugin packages — everything that isn't a CLI wrapper. */
export const corePackages = [
${core}
];

/** Total distinct @zuke package count, for display (some packages, e.g.
 * @zuke/ai, appear under more than one capability, so dedupe by name). */
export const packageCount = new Set([
  ...toolGroups.flatMap((g) => g.tools.map((t) => t.pkg)),
  ...corePackages.map((p) => p.name),
]).size;
`;
}
