import { assertEquals } from "../../core/tests/_assert.ts";
import { docLintDefects, parseDocLint } from "../src/doc_lint.ts";
import { DocsTasks } from "../src/tasks.ts";

/** A representative slice of real `deno doc --lint` output (colour stripped). */
const SAMPLE =
  `error[private-type-ref]: public type 'KubectlApplySettings' references private type 'KubectlSettings'
  --> /repo/packages/kubectl/src/kubectl.ts:83:1
83 | export class KubectlApplySettings extends KubectlSettings {
   = hint: make the referenced type public or remove the reference

error[private-type-ref]: public type 'KubectlApplySettings.prototype.file' references private type 'PathLike'
  --> /repo/packages/kubectl/src/kubectl.ts:94:3
94 |   file(path: PathLike): this {
   = hint: make the referenced type public or remove the reference

error[missing-jsdoc]: exported symbol is missing JSDoc documentation
  --> /repo/packages/kubectl/src/kubectl.ts:141:3
141 |   protected override buildArgs(): string[] {
`;

/** `PathLike` is imported from @zuke/core; `KubectlSettings` is first-party. */
const ACCEPTED = new Set(["PathLike"]);

Deno.test("parseDocLint extracts one diagnostic per error header", () => {
  const diagnostics = parseDocLint(SAMPLE);
  assertEquals(diagnostics.length, 3);
  assertEquals(diagnostics[0].kind, "private-type-ref");
  assertEquals(diagnostics[0].referencedType, "KubectlSettings");
  assertEquals(diagnostics[1].referencedType, "PathLike");
  assertEquals(diagnostics[2].kind, "missing-jsdoc");
  assertEquals(diagnostics[2].referencedType, undefined);
});

Deno.test("parseDocLint strips ANSI colour and ignores non-error lines", () => {
  const red = "\x1b[1m\x1b[31m";
  const reset = "\x1b[0m";
  const coloured = `${red}error[missing-jsdoc]${reset}: ` +
    "exported symbol is missing JSDoc documentation\n" +
    "  --> /repo/packages/x/src/x.ts:9:3\n" +
    "Checked 1 file\n";
  const diagnostics = parseDocLint(coloured);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].kind, "missing-jsdoc");
});

Deno.test("parseDocLint returns nothing for clean output", () => {
  assertEquals(parseDocLint("Checked 1 file\n"), []);
});

Deno.test("docLintDefects flags first-party refs and missing-jsdoc, accepts cross-package imports", () => {
  const defects = docLintDefects(parseDocLint(SAMPLE), ACCEPTED);
  assertEquals(defects.length, 2);
  assertEquals(defects[0].referencedType, "KubectlSettings"); // not imported → defect
  assertEquals(defects[1].kind, "missing-jsdoc"); // always a defect
  assertEquals(defects.some((d) => d.referencedType === "PathLike"), false); // imported → accepted
});

Deno.test("docLintDefects accepts every ref once it is a cross-package import", () => {
  // With KubectlSettings now exported (no longer flagged) only the PathLike ref
  // remains, and PathLike is an accepted @zuke/core import.
  const crossOnly = parseDocLint(
    `error[private-type-ref]: public type 'X.prototype.file' references private type 'PathLike'
  --> /repo/packages/kubectl/src/kubectl.ts:94:3
`,
  );
  assertEquals(docLintDefects(crossOnly, ACCEPTED), []);
});

Deno.test("docLintDefects fails safe: first-party leaks in any form are flagged", () => {
  // A const value exposed via `typeof`, a namespace-qualified first-party type,
  // and a multi-line generic alias all name a type that is NOT a cross-package
  // import, so each must be flagged (the accept-list default is FLAG).
  const leaks = parseDocLint(
    `error[private-type-ref]: public type 'defaults' references private type 'DEFAULTS'
  --> /repo/packages/x/src/x.ts:1:1

error[private-type-ref]: public type 'f' references private type 'Internal.Shape'
  --> /repo/packages/x/src/x.ts:2:1

error[private-type-ref]: public type 'g' references private type 'Wide'
  --> /repo/packages/x/src/x.ts:3:1
`,
  );
  const defects = docLintDefects(leaks, new Set(["PathLike", "Configure"]));
  assertEquals(defects.length, 3);
  assertEquals(defects.map((d) => d.referencedType), [
    "DEFAULTS",
    "Internal.Shape",
    "Wide",
  ]);
});

Deno.test("docLintDefects accepts a namespace-qualified cross-package ref", () => {
  // `import * as core from "@zuke/core"` → a ref `core.PathLike` is accepted
  // when its leading binding `core` is a cross-package import.
  const qualified = parseDocLint(
    `error[private-type-ref]: public type 'f' references private type 'core.PathLike'
  --> /repo/packages/x/src/x.ts:1:1
`,
  );
  assertEquals(docLintDefects(qualified, new Set(["core"])), []);
});

Deno.test("DocsTasks.checkDocLint reports real defects per package, empty when clean", () => {
  const violations = DocsTasks.checkDocLint([
    {
      pkg: "@zuke/kubectl",
      output: SAMPLE,
      crossPackageTypes: ["PathLike"],
    },
    { pkg: "@zuke/clean", output: "Checked 1 file\n", crossPackageTypes: [] },
  ]);
  assertEquals(violations.length, 2);
  assertEquals(violations.every((v) => v.pkg === "@zuke/kubectl"), true);
  assertEquals(violations[0].kind, "private-type-ref");
  assertEquals(violations[1].kind, "missing-jsdoc");
  // A package whose only ref is an accepted cross-package import yields nothing.
  assertEquals(
    DocsTasks.checkDocLint([{
      pkg: "@zuke/kubectl",
      output:
        `error[private-type-ref]: public type 'X.prototype.file' references private type 'CommandOutput'
  --> /repo/packages/kubectl/src/kubectl.ts:94:3
`,
      crossPackageTypes: ["CommandOutput"],
    }]),
    [],
  );
});
