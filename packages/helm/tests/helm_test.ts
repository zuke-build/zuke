import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import {
  HelmDependencyUpdateSettings,
  HelmInstallSettings,
  HelmLintSettings,
  HelmPackageSettings,
  HelmRepoAddSettings,
  HelmTasks,
  HelmTemplateSettings,
  HelmUninstallSettings,
  HelmUpgradeSettings,
} from "../src/helm.ts";

Deno.test("the default binary is helm", () => {
  assertEquals(new HelmUninstallSettings().release("api").argv()[0], "helm");
});

Deno.test("install: requires release+chart; values, set, version, global, flags", () => {
  assertThrows(
    () => new HelmInstallSettings().release("api").argv(),
    Error,
    "HelmTasks.install: .release() and .chart() are required",
  );
  assertEquals(
    new HelmInstallSettings()
      .release("api")
      .chart("./charts/api")
      .namespace("prod")
      .kubeContext("staging")
      .kubeconfig("~/.kube/config")
      .values("values.yaml")
      .set("image.tag", "1.4")
      .version("2.0.0")
      .createNamespace()
      .wait()
      .atomic()
      .timeout("5m")
      .dryRun()
      .argv()
      .slice(1),
    [
      "install",
      "api",
      "./charts/api",
      "--namespace",
      "prod",
      "--kube-context",
      "staging",
      "--kubeconfig",
      "~/.kube/config",
      "--values",
      "values.yaml",
      "--set",
      "image.tag=1.4",
      "--version",
      "2.0.0",
      "--create-namespace",
      "--wait",
      "--atomic",
      "--timeout",
      "5m",
      "--dry-run",
    ],
  );
});

Deno.test("upgrade: requires release+chart; --install and flags", () => {
  assertThrows(
    () => new HelmUpgradeSettings().chart("c").argv(),
    Error,
    "HelmTasks.upgrade: .release() and .chart() are required",
  );
  assertEquals(
    new HelmUpgradeSettings()
      .release("api")
      .chart("./charts/api")
      .install()
      .createNamespace()
      .wait()
      .atomic()
      .timeout("3m")
      .set("replicas", "2")
      .argv()
      .slice(1),
    [
      "upgrade",
      "api",
      "./charts/api",
      "--set",
      "replicas=2",
      "--install",
      "--create-namespace",
      "--wait",
      "--atomic",
      "--timeout",
      "3m",
    ],
  );
});

Deno.test("uninstall: requires release; --keep-history, --wait", () => {
  assertThrows(
    () => new HelmUninstallSettings().argv(),
    Error,
    "HelmTasks.uninstall: .release() is required",
  );
  assertEquals(
    new HelmUninstallSettings().release("api").keepHistory().wait().argv()
      .slice(1),
    ["uninstall", "api", "--keep-history", "--wait"],
  );
});

Deno.test("template: requires release+chart; --output-dir", () => {
  assertThrows(
    () => new HelmTemplateSettings().release("api").argv(),
    Error,
    "HelmTasks.template: .release() and .chart() are required",
  );
  assertEquals(
    new HelmTemplateSettings()
      .release("api")
      .chart("./charts/api")
      .values("values.yaml")
      .outputDir("out")
      .argv()
      .slice(1),
    [
      "template",
      "api",
      "./charts/api",
      "--values",
      "values.yaml",
      "--output-dir",
      "out",
    ],
  );
});

Deno.test("lint: requires chart; values and --strict", () => {
  assertThrows(
    () => new HelmLintSettings().argv(),
    Error,
    "HelmTasks.lint: .chart() is required",
  );
  assertEquals(
    new HelmLintSettings().chart("./charts/api").values("v.yaml").strict()
      .argv()
      .slice(1),
    ["lint", "./charts/api", "--values", "v.yaml", "--strict"],
  );
});

Deno.test("dependencyUpdate: requires chart", () => {
  assertThrows(
    () => new HelmDependencyUpdateSettings().argv(),
    Error,
    "HelmTasks.dependencyUpdate: .chart() is required",
  );
  assertEquals(
    new HelmDependencyUpdateSettings().chart("./charts/api").argv().slice(1),
    ["dependency", "update", "./charts/api"],
  );
});

Deno.test("repoAdd: requires name and url", () => {
  assertThrows(
    () => new HelmRepoAddSettings().name("charts").argv(),
    Error,
    "HelmTasks.repoAdd: .name() and .url() are required",
  );
  assertEquals(
    new HelmRepoAddSettings().name("charts").url("https://example.com/charts")
      .argv().slice(1),
    ["repo", "add", "charts", "https://example.com/charts"],
  );
});

Deno.test("package: requires chart; destination, version, app-version", () => {
  assertThrows(
    () => new HelmPackageSettings().argv(),
    Error,
    "HelmTasks.package: .chart() is required",
  );
  assertEquals(
    new HelmPackageSettings()
      .chart("./charts/api")
      .destination("dist")
      .version("1.2.0")
      .appVersion("1.4")
      .argv()
      .slice(1),
    [
      "package",
      "./charts/api",
      "--destination",
      "dist",
      "--version",
      "1.2.0",
      "--app-version",
      "1.4",
    ],
  );
});

const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-helm-xyz");
};

Deno.test("every HelmTasks function reaches execution", async () => {
  await assertRejects(
    () => HelmTasks.install((s) => missing(s).release("a").chart("c")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.upgrade((s) => missing(s).release("a").chart("c")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.uninstall((s) => missing(s).release("a")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.template((s) => missing(s).release("a").chart("c")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.lint((s) => missing(s).chart("c")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.dependencyUpdate((s) => missing(s).chart("c")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.repoAdd((s) => missing(s).name("n").url("u")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => HelmTasks.package((s) => missing(s).chart("c")),
    ToolNotFoundError,
  );
});
