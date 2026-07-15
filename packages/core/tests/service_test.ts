import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { execute } from "../src/executor.ts";
import { $, Command } from "../src/shell.ts";
import {
  service,
  ServiceBuilder,
  ServiceError,
  ServiceRegistry,
  tcpReachable,
} from "../src/service.ts";

// --- ServiceBuilder.launch_ ---

Deno.test("launch_ without a start throws ServiceError", async () => {
  await assertRejects(
    () => new ServiceBuilder().launch_("api"),
    ServiceError,
    "has no start",
  );
});

Deno.test("a service with no readiness check starts immediately", async () => {
  let stopped = false;
  const running = await service()
    .start(() => ({ stop: () => void (stopped = true) }))
    .launch_("api");
  assertEquals(running.name, "api");
  await running.stop();
  assertEquals(stopped, true);
});

Deno.test("a service waits for its readiness probe before it is up", async () => {
  let checks = 0;
  const running = await service()
    .start(() => ({ stop: () => {} }))
    .readyWhen(() => ++checks >= 2) // false once, then ready
    .launch_("api");
  assertEquals(checks >= 2, true);
  await running.stop();
});

Deno.test("a service that never becomes ready fails and is torn down", async () => {
  let stopped = false;
  await assertRejects(
    () =>
      service()
        .start(() => ({ stop: () => void (stopped = true) }))
        .readyWhen(() => false)
        .readyTimeout(30)
        .launch_("api"),
    ServiceError,
    "not ready within 30ms",
  );
  // The just-started process must be stopped, not leaked.
  assertEquals(stopped, true);
});

Deno.test("a custom stop overrides the handle's own stop", async () => {
  let handleStopped = false;
  let customStopped = false;
  const running = await service()
    .start(() => ({ stop: () => void (handleStopped = true) }))
    .stop(() => void (customStopped = true))
    .launch_("api");
  await running.stop();
  assertEquals([handleStopped, customStopped], [false, true]);
});

// --- ServiceRegistry ---

Deno.test("the registry stops services in reverse and tolerates a failure", async () => {
  const order: string[] = [];
  const reg = new ServiceRegistry();
  const stopper = (label: string) => () => {
    order.push(label);
    return Promise.resolve();
  };
  reg.register({ name: "a", stop: stopper("a") });
  reg.register({ name: "b", stop: () => Promise.reject(new Error("boom")) });
  reg.register({ name: "c", stop: stopper("c") });
  assertEquals(reg.size, 3);
  const lines: string[] = [];
  await reg.stopAll((line) => void lines.push(line));
  assertEquals(order, ["c", "a"]); // reverse order; b threw
  assertEquals(reg.size, 0);
  const joined = lines.join("\n");
  assertStringIncludes(joined, "failed to stop service b: boom");
  assertStringIncludes(joined, "stopped service c");
});

// --- tcpReachable ---

Deno.test("tcpReachable reports whether a port is accepting connections", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.transport === "tcp" ? listener.addr.port : 0;
  assertEquals(await tcpReachable(`127.0.0.1:${port}`), true);
  listener.close();
  assertEquals(await tcpReachable(`127.0.0.1:${port}`), false);
  // An empty host defaults to localhost; nothing is listening now, so this is
  // false regardless of whether localhost resolves to IPv4 or IPv6.
  assertEquals(await tcpReachable(`:${port}`), false);
});

Deno.test("tcpReachable parses a bracketed IPv6 address", async () => {
  // Port 1 is not listening, so this is false — but it exercises the
  // "[host]:port" split (a bare lastIndexOf(':') would mangle the address).
  assertEquals(await tcpReachable("[::1]:1"), false);
});

Deno.test("tcpReachable validates the address", async () => {
  await assertRejects(() => tcpReachable("host"), ServiceError, "no port");
  await assertRejects(
    () => tcpReachable("host:nope"),
    ServiceError,
    "invalid port",
  );
  // A malformed bracketed address is rejected too.
  await assertRejects(() => tcpReachable("[::1"), ServiceError, "host:port");
  await assertRejects(() => tcpReachable("[::1]x"), ServiceError, "host:port");
});

// --- Command.spawn / SpawnedProcess ---

Deno.test("Command.spawn starts a process that stop() terminates", async () => {
  const bin = Deno.execPath();
  const script = "await new Promise(() => {})"; // hangs until killed
  const proc = $`${bin} eval ${script}`.spawn();
  assertEquals(proc.pid > 0, true);
  await proc.stop();
  const status = await proc.status;
  assertEquals(status.success, false); // terminated by signal
});

Deno.test({
  name: "stop() escalates to SIGKILL when SIGTERM is ignored",
  // On Windows SIGTERM maps to TerminateProcess and cannot be ignored, so the
  // escalation path is unreachable there.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const bin = Deno.execPath();
    // Ignore SIGTERM, then hang — only SIGKILL can end it.
    const script =
      "Deno.addSignalListener('SIGTERM', () => {}); await new Promise(() => {});";
    const proc = $`${bin} eval ${script}`.spawn();
    await new Promise((r) => setTimeout(r, 300)); // let the handler install
    await proc.stop("SIGTERM", 150); // SIGTERM ignored → SIGKILL after 150ms
    const status = await proc.status;
    assertEquals(status.success, false);
  },
});

Deno.test("spawn rejects an empty command", () => {
  let threw = false;
  try {
    new Command([]).spawn();
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// --- executor integration ---

Deno.test("execute starts a service, keeps it up for dependents, and stops it after", async () => {
  const events: string[] = [];
  class E2E extends Build {
    api = service()
      .start(() => {
        events.push("start");
        return { stop: () => void events.push("stop") };
      })
      .readyWhen(() => true);
    test = target().dependsOn(this.api).executes(() =>
      void events.push("test")
    );
  }
  const build = new E2E();
  const root = discoverTargets(build).get("test");
  if (!root) throw new Error("no test target");
  const result = await execute(build, root, { silent: true, cache: false });
  assertEquals(result.ok, true);
  // Started and ready before the dependent, stopped after the build.
  assertEquals(events, ["start", "test", "stop"]);
});

Deno.test("a service that fails readiness fails the build; the dependent is skipped", async () => {
  const events: string[] = [];
  let ranTest = false;
  class E2E extends Build {
    api = service()
      .start(() => {
        events.push("start");
        return { stop: () => void events.push("stop") };
      })
      .readyWhen(() => false)
      .readyTimeout(30);
    test = target().dependsOn(this.api).executes(() => void (ranTest = true));
  }
  const build = new E2E();
  const root = discoverTargets(build).get("test");
  if (!root) throw new Error("no test target");
  const result = await execute(build, root, { silent: true, cache: false });
  assertEquals(result.ok, false);
  assertEquals(ranTest, false); // dependent never ran
  assertEquals(events, ["start", "stop"]); // launch_ tore down the process
});

Deno.test("a service is stopped even when a dependent target fails", async () => {
  const events: string[] = [];
  class E2E extends Build {
    api = service()
      .start(() => {
        events.push("start");
        return { stop: () => void events.push("stop") };
      })
      .readyWhen(() => true);
    test = target().dependsOn(this.api).executes(() => {
      events.push("test");
      throw new Error("test failed");
    });
  }
  const build = new E2E();
  const root = discoverTargets(build).get("test");
  if (!root) throw new Error("no test target");
  const result = await execute(build, root, { silent: true, cache: false });
  assertEquals(result.ok, false);
  assertEquals(events, ["start", "test", "stop"]); // stopped despite the failure
});
