import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "../../core/tests/_assert.ts";
import { ToolNotFoundError } from "@zuke/core/tooling";
import {
  DockerBuildSettings,
  DockerExecSettings,
  DockerImagesSettings,
  DockerLoadSettings,
  DockerLoginSettings,
  DockerPsSettings,
  DockerPullSettings,
  DockerPushSettings,
  DockerRmiSettings,
  DockerRmSettings,
  DockerRunSettings,
  DockerSaveSettings,
  DockerStartSettings,
  DockerStopSettings,
  DockerTagSettings,
  DockerTasks,
} from "../src/docker.ts";

Deno.test("the default binary is docker", () => {
  assertEquals(new DockerPsSettings().argv()[0], "docker");
});

Deno.test("build: tags, file, target, platform, build-arg, flags, context", () => {
  const argv = new DockerBuildSettings()
    .tag("app:1").tag("app:latest").file("Dockerfile").target("prod")
    .platform("linux/amd64").buildArg("VER", "1").noCache().pull().push()
    .context("ctx").argv();
  assertEquals(argv, [
    "docker",
    "build",
    "-t",
    "app:1",
    "-t",
    "app:latest",
    "-f",
    "Dockerfile",
    "--target",
    "prod",
    "--platform",
    "linux/amd64",
    "--no-cache",
    "--pull",
    "--push",
    "--build-arg",
    "VER=1",
    "ctx",
  ]);
});

Deno.test("build: bare uses the default context", () => {
  assertEquals(new DockerBuildSettings().argv(), ["docker", "build", "."]);
});

Deno.test("run: flags, env/publish/volume, network, and command", () => {
  const argv = new DockerRunSettings()
    .image("app:1").name("c").rm().detach().interactive().tty()
    .envVar("K", "v").publish(8080, 80).volume("/h", "/c").network("net")
    .commandArgs("echo", 1).argv();
  assertEquals(argv, [
    "docker",
    "run",
    "--rm",
    "-d",
    "-i",
    "-t",
    "--name",
    "c",
    "--network",
    "net",
    "-e",
    "K=v",
    "-p",
    "8080:80",
    "-v",
    "/h:/c",
    "app:1",
    "echo",
    "1",
  ]);
});

Deno.test("run: minimal is just the image", () => {
  assertEquals(new DockerRunSettings().image("app").argv(), [
    "docker",
    "run",
    "app",
  ]);
});

Deno.test("exec: flags, env, workdir, and command", () => {
  const argv = new DockerExecSettings()
    .container("c").interactive().tty().envVar("K", "v").workdir("/app")
    .commandArgs("sh", "-c", "echo hi").argv();
  assertEquals(argv, [
    "docker",
    "exec",
    "-i",
    "-t",
    "-e",
    "K=v",
    "-w",
    "/app",
    "c",
    "sh",
    "-c",
    "echo hi",
  ]);
});

Deno.test("exec: minimal is just the container", () => {
  assertEquals(new DockerExecSettings().container("c").argv(), [
    "docker",
    "exec",
    "c",
  ]);
});

Deno.test("push/pull/tag build their argv", () => {
  assertEquals(new DockerPushSettings().image("a:1").allTags().argv(), [
    "docker",
    "push",
    "--all-tags",
    "a:1",
  ]);
  assertEquals(new DockerPushSettings().image("a:1").argv(), [
    "docker",
    "push",
    "a:1",
  ]);
  assertEquals(
    new DockerPullSettings().image("a:1").platform("linux/arm64").quietOutput()
      .argv(),
    ["docker", "pull", "--platform", "linux/arm64", "-q", "a:1"],
  );
  assertEquals(new DockerPullSettings().image("a:1").argv(), [
    "docker",
    "pull",
    "a:1",
  ]);
  assertEquals(new DockerTagSettings().source("a:1").target("b:2").argv(), [
    "docker",
    "tag",
    "a:1",
    "b:2",
  ]);
});

Deno.test("login renders credentials and registry", () => {
  assertEquals(
    new DockerLoginSettings().username("u").passwordStdin().registry("ghcr.io")
      .argv(),
    ["docker", "login", "-u", "u", "--password-stdin", "ghcr.io"],
  );
  assertEquals(new DockerLoginSettings().password("p").argv(), [
    "docker",
    "login",
    "-p",
    "p",
  ]);
  assertEquals(new DockerLoginSettings().argv(), ["docker", "login"]);
});

Deno.test("images/ps support all, quiet, filter", () => {
  assertEquals(
    new DockerImagesSettings().all().quietOutput().filter("dangling=true")
      .repository("app").argv(),
    ["docker", "images", "-a", "-q", "--filter", "dangling=true", "app"],
  );
  assertEquals(new DockerImagesSettings().argv(), ["docker", "images"]);
  assertEquals(
    new DockerPsSettings().all().quietOutput().filter("status=exited").argv(),
    ["docker", "ps", "-a", "-q", "--filter", "status=exited"],
  );
  assertEquals(new DockerPsSettings().argv(), ["docker", "ps"]);
});

Deno.test("stop/start/rm/rmi take targets and flags", () => {
  assertEquals(new DockerStopSettings().containers("a", "b").time(5).argv(), [
    "docker",
    "stop",
    "-t",
    "5",
    "a",
    "b",
  ]);
  assertEquals(new DockerStartSettings().containers("a").attach().argv(), [
    "docker",
    "start",
    "-a",
    "a",
  ]);
  assertEquals(new DockerStartSettings().containers("a").argv(), [
    "docker",
    "start",
    "a",
  ]);
  assertEquals(
    new DockerRmSettings().containers("a").force().volumes().argv(),
    [
      "docker",
      "rm",
      "-f",
      "-v",
      "a",
    ],
  );
  assertEquals(new DockerRmiSettings().images("img").force().argv(), [
    "docker",
    "rmi",
    "-f",
    "img",
  ]);
  assertEquals(new DockerStopSettings().containers("a").argv(), [
    "docker",
    "stop",
    "a",
  ]);
});

Deno.test("save/load build their argv", () => {
  assertEquals(
    new DockerSaveSettings().images("a", "b").output("o.tar").argv(),
    [
      "docker",
      "save",
      "-o",
      "o.tar",
      "a",
      "b",
    ],
  );
  assertEquals(new DockerSaveSettings().images("a").argv(), [
    "docker",
    "save",
    "a",
  ]);
  assertEquals(new DockerLoadSettings().input("i.tar").quietOutput().argv(), [
    "docker",
    "load",
    "-i",
    "i.tar",
    "-q",
  ]);
  assertEquals(new DockerLoadSettings().argv(), ["docker", "load"]);
});

Deno.test("subcommands with required arguments validate them", () => {
  assertThrows(
    () => new DockerRunSettings().argv(),
    Error,
    "image() is required",
  );
  assertThrows(
    () => new DockerExecSettings().argv(),
    Error,
    "container() is required",
  );
  assertThrows(
    () => new DockerPushSettings().argv(),
    Error,
    "image() is required",
  );
  assertThrows(
    () => new DockerPullSettings().argv(),
    Error,
    "image() is required",
  );
  assertThrows(() => new DockerTagSettings().argv(), Error, "are required");
  assertThrows(
    () => new DockerStopSettings().argv(),
    Error,
    "at least one container",
  );
  assertThrows(
    () => new DockerStartSettings().argv(),
    Error,
    "at least one container",
  );
  assertThrows(
    () => new DockerRmSettings().argv(),
    Error,
    "at least one container",
  );
  assertThrows(
    () => new DockerRmiSettings().argv(),
    Error,
    "at least one image",
  );
  assertThrows(
    () => new DockerSaveSettings().argv(),
    Error,
    "at least one image",
  );
});

Deno.test("every DockerTasks function reaches execution", async () => {
  const M = "zz-no-such-docker-binary-zz";
  const calls: Array<() => Promise<unknown>> = [
    () => DockerTasks.build((s) => s.toolPath(M)),
    () => DockerTasks.run((s) => s.image("x").toolPath(M)),
    () => DockerTasks.exec((s) => s.container("c").toolPath(M)),
    () => DockerTasks.push((s) => s.image("x").toolPath(M)),
    () => DockerTasks.pull((s) => s.image("x").toolPath(M)),
    () => DockerTasks.tag((s) => s.source("a").target("b").toolPath(M)),
    () => DockerTasks.login((s) => s.toolPath(M)),
    () => DockerTasks.images((s) => s.toolPath(M)),
    () => DockerTasks.ps((s) => s.toolPath(M)),
    () => DockerTasks.stop((s) => s.containers("c").toolPath(M)),
    () => DockerTasks.start((s) => s.containers("c").toolPath(M)),
    () => DockerTasks.rm((s) => s.containers("c").toolPath(M)),
    () => DockerTasks.rmi((s) => s.images("x").toolPath(M)),
    () => DockerTasks.save((s) => s.images("x").toolPath(M)),
    () => DockerTasks.load((s) => s.toolPath(M)),
  ];
  for (const call of calls) {
    await assertRejects(call, ToolNotFoundError);
  }
});
