import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError, type ToolSettings } from "@zuke/core/tooling";
import { withAmbientEcho } from "../../core/src/ambient_echo.ts";
import {
  KubectlAnnotateSettings,
  KubectlApplySettings,
  KubectlCreateSettings,
  KubectlDeleteSettings,
  KubectlDescribeSettings,
  KubectlExecSettings,
  KubectlGetSettings,
  KubectlLabelSettings,
  KubectlLogsSettings,
  KubectlPatchSettings,
  KubectlPortForwardSettings,
  KubectlRolloutSettings,
  KubectlScaleSettings,
  KubectlSetImageSettings,
  KubectlTasks,
  KubectlTopSettings,
  KubectlWaitSettings,
  parseNamespaces,
} from "../src/kubectl.ts";

Deno.test("the default binary is kubectl", () => {
  assertEquals(new KubectlApplySettings().file("x.yaml").argv()[0], "kubectl");
});

Deno.test("global flags (namespace, context, kubeconfig) apply to a subcommand", () => {
  assertEquals(
    new KubectlGetSettings()
      .resource("pods")
      .namespace("prod")
      .context("staging")
      .kubeconfig("~/.kube/config")
      .argv()
      .slice(1),
    [
      "get",
      "--namespace",
      "prod",
      "--context",
      "staging",
      "--kubeconfig",
      "~/.kube/config",
      "pods",
    ],
  );
});

Deno.test("apply: requires file or kustomize; all options", () => {
  assertThrows(
    () => new KubectlApplySettings().argv(),
    Error,
    "KubectlTasks.apply: .file() or .kustomize() is required",
  );
  // -f and -k are mutually exclusive (kubectl rejects both together).
  assertThrows(
    () =>
      new KubectlApplySettings().file("a.yaml").kustomize("overlays/prod")
        .argv(),
    Error,
    "mutually exclusive",
  );
  // -k also rejects -R (recursive).
  assertThrows(
    () =>
      new KubectlApplySettings().kustomize("overlays/prod").recursive().argv(),
    Error,
    "cannot be combined with .recursive()",
  );
  assertEquals(new KubectlApplySettings().file("a.yaml").argv().slice(1), [
    "apply",
    "-f",
    "a.yaml",
  ]);
  assertEquals(
    new KubectlApplySettings().kustomize("overlays/prod").argv().slice(1),
    ["apply", "-k", "overlays/prod"],
  );
  assertEquals(
    new KubectlApplySettings()
      .file("a.yaml")
      .file("b.yaml")
      .recursive()
      .prune()
      .serverSide()
      .dryRun()
      .selector("app=api")
      .force()
      .argv()
      .slice(1),
    [
      "apply",
      "-f",
      "a.yaml",
      "-f",
      "b.yaml",
      "-R",
      "--prune",
      "--server-side",
      "--dry-run=client",
      "-l",
      "app=api",
      "--force",
    ],
  );
  // dryRun accepts an explicit mode.
  assertEquals(
    new KubectlApplySettings().file("a.yaml").dryRun("server").argv().slice(1),
    ["apply", "-f", "a.yaml", "--dry-run=server"],
  );
});

Deno.test("create: bare and all options", () => {
  assertEquals(new KubectlCreateSettings().argv().slice(1), ["create"]);
  assertEquals(
    new KubectlCreateSettings()
      .file("ns.yaml")
      .recursive()
      .dryRun("client")
      .output("yaml")
      .saveConfig()
      .argv()
      .slice(1),
    [
      "create",
      "-f",
      "ns.yaml",
      "-R",
      "--dry-run=client",
      "-o",
      "yaml",
      "--save-config",
    ],
  );
});

Deno.test("delete: requires file or resource; all options", () => {
  assertThrows(
    () => new KubectlDeleteSettings().argv(),
    Error,
    "KubectlTasks.delete: specify .file() or .resource(...)",
  );
  assertEquals(
    new KubectlDeleteSettings()
      .file("a.yaml")
      .resource("pod", "web")
      .selector("app=api")
      .all()
      .ignoreNotFound()
      .force()
      .gracePeriod(0)
      .recursive()
      .argv()
      .slice(1),
    [
      "delete",
      "-f",
      "a.yaml",
      "pod",
      "web",
      "-l",
      "app=api",
      "--all",
      "--ignore-not-found",
      "--force",
      "--grace-period=0",
      "-R",
    ],
  );
});

Deno.test("get: requires a resource; all options", () => {
  assertThrows(
    () => new KubectlGetSettings().argv(),
    Error,
    "KubectlTasks.get: specify a resource type",
  );
  assertEquals(
    new KubectlGetSettings()
      .resource("pods")
      .output("wide")
      .selector("app=api")
      .fieldSelector("status.phase=Running")
      .allNamespaces()
      .watch()
      .showLabels()
      .argv()
      .slice(1),
    [
      "get",
      "pods",
      "-o",
      "wide",
      "-l",
      "app=api",
      "--field-selector=status.phase=Running",
      "-A",
      "-w",
      "--show-labels",
    ],
  );
});

Deno.test("getNamespaces forces `get namespaces -o json`", () => {
  // getNamespaces builds this argv internally (the forced `.quiet()` adds no arg).
  assertEquals(
    new KubectlGetSettings().resource("namespaces").output("json").argv().slice(
      1,
    ),
    ["get", "namespaces", "-o", "json"],
  );
});

Deno.test("parseNamespaces narrows a List, a single object, and skips bad items", () => {
  const list = parseNamespaces(JSON.stringify({
    items: [
      {
        metadata: {
          name: "a",
          labels: { x: "1", n: 2 },
          creationTimestamp: "t",
        },
        status: { phase: "Active" },
      },
      { metadata: { name: "b" } }, // no status, no labels
      { metadata: {} }, // no name → skipped
      { spec: {} }, // no metadata → skipped
      "nope", // not a record → skipped
    ],
  }));
  assertEquals(list.map((n) => n.name), ["a", "b"]);
  // A non-string label value (n: 2) is dropped, not coerced.
  assertEquals(list[0], {
    name: "a",
    status: "Active",
    labels: { x: "1" },
    createdAt: "t",
  });
  assertEquals(list[1], {
    name: "b",
    status: "",
    labels: {},
    createdAt: undefined,
  });

  // A single namespace object (kubectl get ns <name> -o json) → one-element array.
  assertEquals(
    parseNamespaces(
      JSON.stringify({
        metadata: { name: "solo" },
        status: { phase: "Terminating" },
      }),
    ),
    [{ name: "solo", status: "Terminating", labels: {}, createdAt: undefined }],
  );
  assertEquals(parseNamespaces(JSON.stringify({ items: [] })), []);
  assertEquals(parseNamespaces(JSON.stringify({})), []); // no name → dropped
  assertEquals(parseNamespaces("  "), []); // empty/whitespace → no rows
  assertThrows(() => parseNamespaces("{not json"), Error);
});

Deno.test("getNamespaces runs kubectl and parses the JSON (POSIX fake binary)", async () => {
  if (Deno.build.os === "windows") return; // shebang script; argv is covered above.
  const dir = await Deno.makeTempDir();
  try {
    const argvFile = `${dir}/argv`;
    const jsonFile = `${dir}/ns.json`;
    await Deno.writeTextFile(
      jsonFile,
      JSON.stringify({
        items: [
          {
            metadata: {
              name: "default",
              labels: { env: "prod" },
              creationTimestamp: "2026-01-01T00:00:00Z",
            },
            status: { phase: "Active" },
          },
          { metadata: { name: "kube-system" } },
        ],
      }),
    );
    const fake = `${dir}/kubectl`;
    await Deno.writeTextFile(
      fake,
      `#!/bin/sh\nprintf '%s' "$*" > "${argvFile}"\ncat "${jsonFile}"\n`,
    );
    await Deno.chmod(fake, 0o755);

    // The caller sets `.output("yaml")` and a `.selector()`: getNamespaces must
    // FORCE `-o json` over the caller's yaml (or parsing would fail) while still
    // threading the caller's selector through.
    const namespaces = await KubectlTasks.getNamespaces((s) =>
      s.toolPath(fake).output("yaml").selector("team=web")
    );
    assertEquals(namespaces.map((n) => n.name), ["default", "kube-system"]);
    assertEquals(namespaces[0].status, "Active");
    assertEquals(namespaces[0].labels, { env: "prod" });
    assertEquals(namespaces[0].createdAt, "2026-01-01T00:00:00Z");
    assertEquals(namespaces[1].status, ""); // no status.phase
    assertEquals(
      await Deno.readTextFile(argvFile),
      "get namespaces -o json -l team=web",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("getNamespaces with no configure runs the command (dry run yields no rows)", async () => {
  // Under a deep-dry-run echo sink the command is echoed, not spawned; the
  // empty output parses to no rows. Exercises the no-configure path.
  const echoed: string[] = [];
  const result = await withAmbientEcho(
    (line) => echoed.push(line),
    () => KubectlTasks.getNamespaces(),
  );
  assertEquals(result, []);
  assertStringIncludes(echoed[0], "kubectl get namespaces -o json");
});

Deno.test("getNamespaces reaches execution", async () => {
  await assertRejects(
    () =>
      KubectlTasks.getNamespaces((s) => {
        s.os_ = "linux";
        return s.toolPath("zuke-no-such-kubectl-xyz");
      }),
    ToolNotFoundError,
  );
});

Deno.test("getNamespaces neutralizes a caller's .watch() so it never streams", async () => {
  // A watch (`-w`) would stream forever and never yield parseable JSON; the
  // helper must force it off. Echoed under a dry run so nothing spawns.
  const echoed: string[] = [];
  await withAmbientEcho(
    (line) => echoed.push(line),
    () => KubectlTasks.getNamespaces((s) => s.watch()),
  );
  assertStringIncludes(echoed[0], "get namespaces -o json");
  assertEquals(echoed[0].includes("-w"), false);
});

Deno.test("KubectlGetSettings.watch(false) disables an earlier watch", () => {
  assertEquals(
    new KubectlGetSettings().resource("pods").watch().watch(false).argv()
      .includes("-w"),
    false,
  );
});

Deno.test("describe: requires a resource type; selector is a filter", () => {
  assertThrows(
    () => new KubectlDescribeSettings().argv(),
    Error,
    "specify a resource type",
  );
  // A bare selector with no resource type is rejected by kubectl.
  assertThrows(
    () => new KubectlDescribeSettings().selector("app=api").argv(),
    Error,
    "specify a resource type",
  );
  assertEquals(
    new KubectlDescribeSettings().resource("deployment/api").argv().slice(1),
    ["describe", "deployment/api"],
  );
  assertEquals(
    new KubectlDescribeSettings().resource("pods").selector("app=api").argv()
      .slice(1),
    ["describe", "pods", "-l", "app=api"],
  );
});

Deno.test("logs: requires resource or selector; all options", () => {
  assertThrows(
    () => new KubectlLogsSettings().argv(),
    Error,
    "KubectlTasks.logs: specify .resource() or .selector()",
  );
  assertEquals(
    new KubectlLogsSettings()
      .resource("web-0")
      .container("api")
      .follow()
      .previous()
      .tail(100)
      .since("5m")
      .allContainers()
      .timestamps()
      .argv()
      .slice(1),
    [
      "logs",
      "web-0",
      "-c",
      "api",
      "-f",
      "--previous",
      "--tail=100",
      "--since=5m",
      "--all-containers",
      "--timestamps",
    ],
  );
  // Selector form needs no pod name.
  assertEquals(
    new KubectlLogsSettings().selector("app=api").argv().slice(1),
    ["logs", "-l", "app=api"],
  );
  // A pod name and a selector are mutually exclusive.
  assertThrows(
    () =>
      new KubectlLogsSettings().resource("web-0").selector("app=api").argv(),
    Error,
    "mutually exclusive",
  );
});

Deno.test("exec: requires resource and command; ordering with --", () => {
  assertThrows(
    () => new KubectlExecSettings().command("ls").argv(),
    Error,
    "KubectlTasks.exec: .resource() is required",
  );
  assertThrows(
    () => new KubectlExecSettings().resource("web-0").argv(),
    Error,
    "KubectlTasks.exec: .command(...) is required",
  );
  assertEquals(
    new KubectlExecSettings()
      .resource("web-0")
      .container("api")
      .stdin()
      .tty()
      .command("sh", "-c", "echo hi")
      .argv()
      .slice(1),
    ["exec", "-i", "-t", "-c", "api", "web-0", "--", "sh", "-c", "echo hi"],
  );
});

Deno.test("rollout: requires action and resource; sub-actions and flags", () => {
  assertThrows(
    () => new KubectlRolloutSettings().resource("deployment/api").argv(),
    Error,
    "choose .status(), .restart(), .undo(), or .history()",
  );
  assertThrows(
    () => new KubectlRolloutSettings().status().argv(),
    Error,
    "KubectlTasks.rollout: .resource() is required",
  );
  assertEquals(
    new KubectlRolloutSettings()
      .status()
      .resource("deployment/api")
      .timeout("120s")
      .argv()
      .slice(1),
    ["rollout", "status", "deployment/api", "--timeout=120s"],
  );
  assertEquals(
    new KubectlRolloutSettings()
      .undo()
      .resource("deployment/api")
      .toRevision(3)
      .argv()
      .slice(1),
    ["rollout", "undo", "deployment/api", "--to-revision=3"],
  );
  assertEquals(
    new KubectlRolloutSettings().restart().resource("deployment/api").argv()
      .slice(1),
    ["rollout", "restart", "deployment/api"],
  );
  assertEquals(
    new KubectlRolloutSettings().history().resource("deployment/api").argv()
      .slice(1),
    ["rollout", "history", "deployment/api"],
  );
});

Deno.test("scale: requires replicas and a target; all options", () => {
  assertThrows(
    () => new KubectlScaleSettings().resource("deployment/api").argv(),
    Error,
    "KubectlTasks.scale: .replicas() is required",
  );
  assertThrows(
    () => new KubectlScaleSettings().replicas(3).argv(),
    Error,
    "KubectlTasks.scale: specify .resource() or .file()",
  );
  assertEquals(
    new KubectlScaleSettings()
      .replicas(3)
      .resource("deployment/api")
      .currentReplicas(1)
      .selector("app=api")
      .all()
      .argv()
      .slice(1),
    [
      "scale",
      "--replicas=3",
      "--current-replicas=1",
      "deployment/api",
      "-l",
      "app=api",
      "--all",
    ],
  );
  // File form.
  assertEquals(
    new KubectlScaleSettings().replicas(2).file("deploy.yaml").argv().slice(1),
    ["scale", "--replicas=2", "-f", "deploy.yaml"],
  );
});

Deno.test("setImage: requires resource and image; all options", () => {
  assertThrows(
    () => new KubectlSetImageSettings().image("api", "api:1").argv(),
    Error,
    "KubectlTasks.setImage: .resource() is required",
  );
  assertThrows(
    () => new KubectlSetImageSettings().resource("deployment/api").argv(),
    Error,
    "KubectlTasks.setImage: at least one .image() is required",
  );
  assertEquals(
    new KubectlSetImageSettings()
      .resource("deployment/api")
      .image("api", "api:1.4")
      .image("sidecar", "proxy:2")
      .selector("tier=web")
      .all()
      .argv()
      .slice(1),
    [
      "set",
      "image",
      "deployment/api",
      "api=api:1.4",
      "sidecar=proxy:2",
      "-l",
      "tier=web",
      "--all",
    ],
  );
});

Deno.test("annotate: resource + annotations, remove, and flags", () => {
  // Resource tokens + one annotation + --overwrite.
  assertEquals(
    new KubectlAnnotateSettings()
      .resource("deploy", "api")
      .annotation("team", "payments")
      .overwrite()
      .argv()
      .slice(1),
    ["annotate", "deploy", "api", "team=payments", "--overwrite"],
  );
  // remove(key) renders kubectl's `key-` syntax.
  assertEquals(
    new KubectlAnnotateSettings()
      .resource("deploy", "api")
      .remove("team")
      .argv()
      .slice(1),
    ["annotate", "deploy", "api", "team-"],
  );
  // Everything together, incl. --all and the label selector.
  assertEquals(
    new KubectlAnnotateSettings()
      .resource("pods")
      .annotation("team", "payments")
      .remove("old")
      .overwrite()
      .all()
      .selector("app=web")
      .argv()
      .slice(1),
    [
      "annotate",
      "pods",
      "team=payments",
      "old-",
      "--overwrite",
      "--all",
      "-l",
      "app=web",
    ],
  );
});

Deno.test("label: resource + labels, remove, and flags", () => {
  // Resource + a label + -l selector.
  assertEquals(
    new KubectlLabelSettings()
      .resource("pods")
      .label("team", "payments")
      .selector("app=web")
      .argv()
      .slice(1),
    ["label", "pods", "team=payments", "-l", "app=web"],
  );
  // Everything together, incl. remove(key), --overwrite, and --all.
  assertEquals(
    new KubectlLabelSettings()
      .resource("deploy", "api")
      .label("team", "payments")
      .remove("old")
      .overwrite()
      .all()
      .argv()
      .slice(1),
    ["label", "deploy", "api", "team=payments", "old-", "--overwrite", "--all"],
  );
});

Deno.test("annotate and label honour the shared cluster flags", () => {
  assertEquals(
    new KubectlAnnotateSettings()
      .resource("deploy", "api")
      .annotation("team", "payments")
      .namespace("prod")
      .argv()
      .slice(1),
    ["annotate", "deploy", "api", "team=payments", "--namespace", "prod"],
  );
  assertEquals(
    new KubectlLabelSettings()
      .resource("deploy", "api")
      .label("team", "payments")
      .namespace("prod")
      .argv()
      .slice(1),
    ["label", "deploy", "api", "team=payments", "--namespace", "prod"],
  );
});

Deno.test("annotate and label require a resource type and a payload", () => {
  // A payload but no resource type — a bare selector or --all is not enough.
  assertThrows(
    () => new KubectlAnnotateSettings().annotation("a", "b").argv(),
    Error,
    "a resource type is required",
  );
  assertThrows(
    () =>
      new KubectlAnnotateSettings().selector("app=web").annotation("a", "b")
        .argv(),
    Error,
    "a resource type is required",
  );
  assertThrows(
    () => new KubectlAnnotateSettings().all().annotation("a", "b").argv(),
    Error,
    "a resource type is required",
  );
  // A resource type but no annotation/removal.
  assertThrows(
    () => new KubectlAnnotateSettings().resource("deploy").argv(),
    Error,
    "at least one .annotation()",
  );
  assertThrows(
    () => new KubectlLabelSettings().label("a", "b").argv(),
    Error,
    "a resource type is required",
  );
  assertThrows(
    () => new KubectlLabelSettings().all().label("a", "b").argv(),
    Error,
    "a resource type is required",
  );
  assertThrows(
    () => new KubectlLabelSettings().resource("deploy").argv(),
    Error,
    "at least one .label()",
  );
});

Deno.test("patch: requires resource and patch; --type ordering", () => {
  assertThrows(
    () => new KubectlPatchSettings().patch("{}").argv(),
    Error,
    "KubectlTasks.patch: .resource() is required",
  );
  assertThrows(
    () => new KubectlPatchSettings().resource("deployment/api").argv(),
    Error,
    "KubectlTasks.patch: .patch() is required",
  );
  assertEquals(
    new KubectlPatchSettings()
      .resource("deployment/api")
      .type("merge")
      .patch('{"spec":{"replicas":2}}')
      .argv()
      .slice(1),
    [
      "patch",
      "deployment/api",
      "--type",
      "merge",
      "-p",
      '{"spec":{"replicas":2}}',
    ],
  );
});

Deno.test("portForward: requires resource and a port; --address ordering", () => {
  assertThrows(
    () => new KubectlPortForwardSettings().port("8080:80").argv(),
    Error,
    "KubectlTasks.portForward: .resource() is required",
  );
  assertThrows(
    () => new KubectlPortForwardSettings().resource("svc/api").argv(),
    Error,
    "KubectlTasks.portForward: at least one .port() is required",
  );
  assertEquals(
    new KubectlPortForwardSettings()
      .resource("svc/api")
      .address("0.0.0.0")
      .port("8080:80")
      .port("9090")
      .argv()
      .slice(1),
    ["port-forward", "--address", "0.0.0.0", "svc/api", "8080:80", "9090"],
  );
});

Deno.test("wait: requires a target and a condition; all options", () => {
  assertThrows(
    () => new KubectlWaitSettings().forCondition("delete").argv(),
    Error,
    "KubectlTasks.wait: specify .file() or .resource(...)",
  );
  assertThrows(
    () => new KubectlWaitSettings().resource("pod/web").argv(),
    Error,
    "KubectlTasks.wait: .forCondition() is required",
  );
  assertEquals(
    new KubectlWaitSettings()
      .file("job.yaml")
      .resource("pod/web")
      .forCondition("condition=Ready")
      .timeout("60s")
      .selector("app=api")
      .all()
      .argv()
      .slice(1),
    [
      "wait",
      "-f",
      "job.yaml",
      "pod/web",
      "--for=condition=Ready",
      "--timeout=60s",
      "-l",
      "app=api",
      "--all",
    ],
  );
});

Deno.test("top: requires pods or nodes; all options", () => {
  assertThrows(
    () => new KubectlTopSettings().argv(),
    Error,
    "KubectlTasks.top: choose .pods() or .nodes()",
  );
  assertEquals(
    new KubectlTopSettings()
      .pods()
      .name("web-0")
      .selector("app=api")
      .containers()
      .allNamespaces()
      .argv()
      .slice(1),
    ["top", "pods", "web-0", "-l", "app=api", "--containers", "-A"],
  );
  assertEquals(
    new KubectlTopSettings().nodes().argv().slice(1),
    ["top", "nodes"],
  );
  // --containers and -A are pod-only; kubectl rejects them on `top node`.
  assertThrows(
    () => new KubectlTopSettings().nodes().containers().argv(),
    Error,
    "only valid with .pods()",
  );
  assertThrows(
    () => new KubectlTopSettings().nodes().allNamespaces().argv(),
    Error,
    "only valid with .pods()",
  );
  // A selector stays valid on `top nodes`.
  assertEquals(
    new KubectlTopSettings().nodes().selector("role=worker").argv().slice(1),
    ["top", "nodes", "-l", "role=worker"],
  );
});

/**
 * Point a settings object at a guaranteed-missing binary with the shim
 * fallback disabled, so each KubectlTasks function reaches execution WITHOUT
 * ever invoking a real kubectl (tests must stay hermetic).
 */
const missing = <S extends ToolSettings>(s: S): S => {
  s.os_ = "linux";
  return s.toolPath("zuke-no-such-kubectl-xyz");
};

Deno.test("every KubectlTasks function reaches execution", async () => {
  await assertRejects(
    () => KubectlTasks.apply((s) => missing(s).file("a.yaml")),
    ToolNotFoundError,
  );
  await assertRejects(() => KubectlTasks.create(missing), ToolNotFoundError);
  await assertRejects(
    () => KubectlTasks.delete((s) => missing(s).resource("pod", "web")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => KubectlTasks.get((s) => missing(s).resource("pods")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => KubectlTasks.describe((s) => missing(s).resource("pod/web")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => KubectlTasks.logs((s) => missing(s).resource("web-0")),
    ToolNotFoundError,
  );
  await assertRejects(
    () => KubectlTasks.exec((s) => missing(s).resource("web-0").command("sh")),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.rollout((s) => missing(s).status().resource("deploy/api")),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.scale((s) => missing(s).replicas(2).resource("deploy/api")),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.setImage((s) =>
        missing(s).resource("deploy/api").image("api", "api:1")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.annotate((s) =>
        missing(s).resource("deploy", "api").annotation("team", "payments")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.label((s) =>
        missing(s).resource("deploy", "api").label("team", "payments")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.patch((s) => missing(s).resource("deploy/api").patch("{}")),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.portForward((s) =>
        missing(s).resource("svc/api").port("80")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () =>
      KubectlTasks.wait((s) =>
        missing(s).resource("pod/web").forCondition("delete")
      ),
    ToolNotFoundError,
  );
  await assertRejects(
    () => KubectlTasks.top((s) => missing(s).nodes()),
    ToolNotFoundError,
  );
});
