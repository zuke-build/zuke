// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals } from "./_assert.ts";
import type { HostOs } from "../src/host.ts";
import type { CommandStatus, Signal } from "../src/signal.ts";

// Each pair of functions type-checks only while the two types accept exactly
// the same values, so a signal or a field the runtime gains or loses fails
// `deno check` here rather than at a caller.
const signalFromDeno = (signal: Deno.Signal): Signal => signal;
const signalToDeno = (signal: Signal): Deno.Signal => signal;
const statusFromDeno = (status: Deno.CommandStatus): CommandStatus => status;
const statusToDeno = (status: CommandStatus): Deno.CommandStatus => status;
const osFromDeno = (os: typeof Deno.build.os): HostOs => os;
const osToDeno = (os: HostOs): typeof Deno.build.os => os;

Deno.test("Zuke's signal, status and host OS types are the runtime's, value for value", () => {
  assertEquals(signalToDeno(signalFromDeno("SIGTERM")), "SIGTERM");
  const status = {
    success: false,
    code: 143,
    signal: signalFromDeno("SIGTERM"),
  };
  assertEquals(statusToDeno(statusFromDeno(status)), status);
  assertEquals(osToDeno(osFromDeno(Deno.build.os)), Deno.build.os);
});
