import { assertEquals } from "./_assert.ts";
import { terminateProcess } from "../src/terminate.ts";

/**
 * A stand-in for `Deno.ChildProcess` that records the signals it receives and
 * exits only when told to — the seam the escalation logic is tested through.
 */
function fakeChild(
  options: { exitsOn?: Deno.Signal; killThrows?: boolean } = {},
) {
  const signals: Deno.Signal[] = [];
  // The Promise executor runs synchronously, so `exit` is assigned before use;
  // the no-op initialiser keeps the field definitely assigned without a `!`.
  let exit: () => void = () => {};
  const status = new Promise<Deno.CommandStatus>((resolve) => {
    exit = () => resolve({ success: false, code: 137, signal: "SIGKILL" });
  });
  return {
    signals,
    status,
    kill(signal: Deno.Signal = "SIGTERM") {
      if (options.killThrows) throw new TypeError("process already exited");
      signals.push(signal);
      if (signal === "SIGKILL" || signal === options.exitsOn) exit();
    },
  };
}

Deno.test("terminateProcess stops at SIGTERM when the process exits in grace", async () => {
  const child = fakeChild({ exitsOn: "SIGTERM" });
  await terminateProcess(child, "SIGTERM", 30_000);
  assertEquals(child.signals, ["SIGTERM"]);
});

Deno.test("terminateProcess escalates to SIGKILL when the grace window expires", async () => {
  const child = fakeChild(); // ignores SIGTERM entirely
  await terminateProcess(child, "SIGTERM", 5);
  assertEquals(child.signals, ["SIGTERM", "SIGKILL"]);
});

Deno.test("terminateProcess sends the requested signal", async () => {
  const child = fakeChild({ exitsOn: "SIGINT" });
  await terminateProcess(child, "SIGINT", 30_000);
  assertEquals(child.signals, ["SIGINT"]);
});

Deno.test("terminateProcess treats an already-exited process as stopped", async () => {
  const child = fakeChild({ killThrows: true });
  await terminateProcess(child, "SIGTERM", 5);
  // Nothing was delivered, and it did not wait out the grace window or throw.
  assertEquals(child.signals, []);
});

Deno.test("terminateProcess tolerates a process that exits as SIGKILL is sent", async () => {
  const child = fakeChild();
  let killed = 0;
  const racing = {
    status: child.status,
    kill(signal: Deno.Signal = "SIGTERM") {
      killed++;
      // The first signal lands; by the time the escalation fires the process is
      // gone, so the second kill throws — which must not surface.
      if (killed > 1) throw new TypeError("process already exited");
      child.signals.push(signal);
      setTimeout(() => child.kill("SIGKILL"), 20);
    },
  };
  await terminateProcess(racing, "SIGTERM", 5);
  assertEquals(killed, 2);
});
