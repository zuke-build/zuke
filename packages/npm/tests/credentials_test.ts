// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * No credential this wrapper is handed may reach the command line.
 *
 * A child's argv is world-readable on a default Linux host — `ps aux`, or
 * `/proc/<pid>/cmdline` — so every other user on the machine, and every process
 * the build starts, can read it while the command runs. On a shared or
 * self-hosted CI runner that is every co-tenant.
 *
 * npm maps each config key to `npm_config_<key>`, so the one-time password has
 * somewhere else to go. The token handed to `token revoke` does not: npm takes
 * it positionally, so it is masked in every rendering and the process-table
 * exposure is stated rather than papered over.
 *
 * Each class below records what it registers with the run's redactor.
 * `markSecret` is protected and its effect lands on an ambient redactor a
 * wrapper package cannot install, so the observable thing here is the call,
 * which is the wrapper's half of the contract. That the redactor then masks is
 * core's half, and core tests it.
 */

import { assertEquals } from "../../core/tests/_assert.ts";
import {
  NpmAccessSettings,
  NpmDeprecateSettings,
  NpmOwnerSettings,
  NpmPublishSettings,
  NpmTokenSettings,
} from "../mod.ts";

const OTP = "123456";

class SpyPublish extends NpmPublishSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class SpyDeprecate extends NpmDeprecateSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class SpyAccess extends NpmAccessSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class SpyOwner extends NpmOwnerSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}
class SpyToken extends NpmTokenSettings {
  readonly marked: string[] = [];
  protected override markSecret(value: string): void {
    this.marked.push(value);
  }
}

/** Every settings class npm accepts `--otp` for, in a minimal valid form. */
function withOtp(): ReadonlyArray<
  [string, { argv(): string[]; readonly marked: string[] }]
> {
  return [
    ["publish", new SpyPublish().otp(OTP)],
    [
      "deprecate",
      new SpyDeprecate().spec("app@<2").message("upgrade").otp(OTP),
    ],
    ["access", new SpyAccess().setMfa("automation").otp(OTP)],
    ["owner", new SpyOwner().rm("someone", "app").otp(OTP)],
    ["token", new SpyToken().list().otp(OTP)],
  ];
}

Deno.test("a one-time password never reaches the command line", () => {
  const cases = withOtp();
  // All five, because this is the failure that shows up at the one site
  // somebody forgot — the flag was written out separately in each class before
  // they shared an implementation.
  assertEquals(cases.length, 5);
  for (const [name, settings] of cases) {
    const argv = settings.argv();
    // Asserted on the whole argv rather than on the flag: a regression could
    // pass it as `--otp 123456`, or positionally, and a flag-only check would
    // miss both.
    assertEquals(
      argv.some((a) => a.includes(OTP)),
      false,
      `${name}: the one-time password reached argv as ${JSON.stringify(argv)}`,
    );
    // And the other half. Keeping it out of argv is the fix; registering it
    // covers the renderings the environment route does not — and a chainer
    // that set the variable itself instead of going through the shared helper
    // would satisfy the assertion above while silently losing this one.
    assertEquals(settings.marked, [OTP], `${name}: not registered as a secret`);
  }
});

Deno.test("revoking a token still names it, because npm takes it positionally", () => {
  // The honest other half. There is no environment route for this one, so the
  // value is in argv and the wrapper says so; what it does is mask every
  // rendering. Pinned so a later change cannot quietly drop the argument and
  // call the finding fixed.
  const settings = new SpyToken().revoke("npm_live_value");
  assertEquals(settings.argv().slice(1), ["token", "revoke", "npm_live_value"]);
  // Masked whichever it is — npm accepts an id or the token itself here, and
  // nothing in the string says which, so the safe direction is to register it.
  assertEquals(settings.marked, ["npm_live_value"]);
});
