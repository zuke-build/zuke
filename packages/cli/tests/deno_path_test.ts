// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "../../core/tests/_assert.ts";
import {
  defaultDenoHost,
  denoCandidates,
  type DenoHost,
  DenoNotFoundError,
  pathWithDeno,
  spawnDeno,
} from "../src/deno_path.ts";
import { launcherBash, launcherPwsh } from "../src/launcher.ts";

/** A {@link DenoHost} whose four answers the test dictates. */
function host(overrides: Partial<DenoHost> = {}): DenoHost {
  return {
    standalone: () => true,
    execPath: () => "/opt/deno/bin/deno",
    env: () => undefined,
    windows: () => false,
    ...overrides,
  };
}

/** A host whose `env` answers from a plain record. */
function envHost(
  vars: Record<string, string>,
  overrides: Partial<DenoHost> = {},
): DenoHost {
  return host({ env: (name) => vars[name], ...overrides });
}

/** A name no executable on any machine answers to. */
const MISSING = "zuke-no-such-deno-8f3a1c";

Deno.test("running under deno run, the running executable is the only candidate", () => {
  const candidates = denoCandidates(
    host({ standalone: () => false, execPath: () => "/usr/local/bin/deno" }),
  );
  assertEquals(candidates, ["/usr/local/bin/deno"]);
});

Deno.test("compiled, PATH comes first and DENO_INSTALL second", () => {
  const candidates = denoCandidates(
    envHost({ DENO_INSTALL: "/opt/zuke-deno", HOME: "/home/ana" }),
  );
  assertEquals(candidates, ["deno", "/opt/zuke-deno/bin/deno"]);
});

Deno.test("compiled, an unset DENO_INSTALL falls back to ~/.deno", () => {
  assertEquals(denoCandidates(envHost({ HOME: "/home/ana" })), [
    "deno",
    "/home/ana/.deno/bin/deno",
  ]);
});

Deno.test("compiled, an empty DENO_INSTALL falls back to ~/.deno", () => {
  assertEquals(
    denoCandidates(envHost({ DENO_INSTALL: "", HOME: "/home/ana" })),
    ["deno", "/home/ana/.deno/bin/deno"],
  );
});

Deno.test("compiled on windows, USERPROFILE stands in for HOME and the binary is deno.exe", () => {
  assertEquals(
    denoCandidates(
      envHost({ USERPROFILE: "C:/Users/Ana" }, { windows: () => true }),
    ),
    ["deno", "C:/Users/Ana/.deno/bin/deno.exe"],
  );
});

Deno.test("compiled with no home directory at all, PATH is the only candidate", () => {
  assertEquals(denoCandidates(envHost({})), ["deno"]);
});

Deno.test("compiled with an empty HOME, PATH is the only candidate", () => {
  assertEquals(denoCandidates(envHost({ HOME: "" })), ["deno"]);
});

Deno.test("a bare candidate overlays no PATH", () => {
  assertEquals(pathWithDeno("deno", envHost({ PATH: "/usr/bin" })), {});
});

Deno.test("a resolved candidate puts its own directory first on PATH", () => {
  assertEquals(
    pathWithDeno("/home/ana/.deno/bin/deno", envHost({ PATH: "/usr/bin" })),
    { PATH: "/home/ana/.deno/bin:/usr/bin" },
  );
});

Deno.test("with no inherited PATH, the candidate's directory is the whole PATH", () => {
  assertEquals(pathWithDeno("/home/ana/.deno/bin/deno", envHost({})), {
    PATH: "/home/ana/.deno/bin",
  });
});

Deno.test("a windows PATH is joined with semicolons", () => {
  assertEquals(
    pathWithDeno(
      "C:\\Users\\Ana\\.deno\\bin\\deno.exe",
      envHost({ PATH: "C:/Windows" }, { windows: () => true }),
    ),
    { PATH: "C:/Users/Ana/.deno/bin;C:/Windows" },
  );
});

Deno.test("spawnDeno skips a candidate that is not installed", async () => {
  // Only the second candidate can have produced this output, so the skip is
  // what the assertions prove.
  const child = spawnDeno(
    ["eval", "console.log('ok')"],
    { stdout: "piped", stderr: "piped" },
    [MISSING, Deno.execPath()],
  );
  const { code, stdout } = await child.output();
  assertEquals(code, 0);
  assertStringIncludes(new TextDecoder().decode(stdout), "ok");
});

Deno.test("spawnDeno reports every candidate it tried when none is installed", () => {
  const error = assertThrows(
    () => spawnDeno(["--version"], {}, [MISSING, `${MISSING}-2`]),
    DenoNotFoundError,
  );
  assertEquals(
    error instanceof DenoNotFoundError ? error.tried : [],
    [MISSING, `${MISSING}-2`],
  );
  assertStringIncludes(error.message, MISSING);
  assertStringIncludes(error.message, "./zuke launcher");
});

Deno.test({
  name: "spawnDeno surfaces a failure that is not a missing binary",
  // Windows refuses a non-executable file differently, and the point of the
  // branch — do not report "not found" for a candidate that is there — is the
  // same wherever it is proved.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "zuke-deno-path-" });
    try {
      const notExecutable = `${dir}/deno`;
      await Deno.writeTextFile(notExecutable, "not a binary\n");
      const error = assertThrows(() =>
        spawnDeno(["--version"], {}, [
          notExecutable,
        ])
      );
      assertEquals(error instanceof DenoNotFoundError, false);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("the default host answers from the running process", () => {
  assertEquals(defaultDenoHost.standalone(), false);
  assertEquals(defaultDenoHost.execPath(), Deno.execPath());
  assertEquals(defaultDenoHost.windows(), Deno.build.os === "windows");
  assertEquals(defaultDenoHost.env("PATH"), Deno.env.get("PATH"));
});

Deno.test("compiled, a relative DENO_INSTALL is refused rather than resolved", () => {
  // `absolutePath` refuses a path with no root instead of guessing a base, so
  // the candidate cannot be built — and a crash on the way to spawning a build
  // would be worse than falling back to PATH alone.
  assertEquals(denoCandidates(envHost({ DENO_INSTALL: "relative/deno" })), [
    "deno",
  ]);
});

Deno.test("compiled, a relative HOME is refused rather than resolved", () => {
  assertEquals(denoCandidates(envHost({ HOME: "relative" })), ["deno"]);
});

Deno.test("an empty inherited PATH is not joined onto", () => {
  // A zero-length PATH element is the POSIX spelling of "the current
  // directory", so `"<binDir>:"` would put the build's own working directory
  // on every child's PATH.
  assertEquals(
    pathWithDeno("/home/ana/.deno/bin/deno", envHost({ PATH: "" })),
    {
      PATH: "/home/ana/.deno/bin",
    },
  );
});

Deno.test("spawnDeno does not blame Deno for a cwd that is gone", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-deno-path-" });
  await Deno.remove(dir);
  const error = assertThrows(() =>
    spawnDeno(["--version"], { cwd: dir }, [Deno.execPath()])
  );
  assertEquals(error instanceof DenoNotFoundError, false);
  assertEquals(error instanceof Deno.errors.NotFound, true);
});

Deno.test("spawnDeno does not blame Deno for a cwd that is a file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "zuke-deno-path-" });
  try {
    const file = `${dir}/not-a-directory`;
    await Deno.writeTextFile(file, "");
    const error = assertThrows(() =>
      spawnDeno(["--version"], { cwd: file }, [Deno.execPath()])
    );
    assertEquals(error instanceof DenoNotFoundError, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the compiled order is the one the launchers use in shell", () => {
  // The module doc says the compiled resolution mirrors the launchers. They
  // answer the same question in bash and PowerShell — before Deno exists, so
  // there is no module for either side to import and the two statements of
  // the order can only be held together by asserting them against each other.
  // Change a launcher's order and this fails, naming the resolver that has to
  // follow.
  const bash = launcherBash({ bootstrapDeno: true });
  const pwsh = launcherPwsh({ bootstrapDeno: true });
  const before = (haystack: string, first: string, second: string) => {
    const at = haystack.indexOf(first);
    const then = haystack.indexOf(second);
    assertEquals(at >= 0 && then >= 0 && at < then, true);
  };
  // PATH first, the bootstrap directory second — in both launchers, and in
  // `denoCandidates` below.
  before(bash, "command -v deno", '"$deno_install/bin/deno"');
  before(
    pwsh,
    "Get-Command deno",
    'Join-Path $env:DENO_INSTALL "bin\\deno.exe"',
  );
  // And the bootstrap directory is the same one, spelled the same way.
  assertStringIncludes(bash, 'deno_install="${DENO_INSTALL:-$HOME/.deno}"');
  assertStringIncludes(pwsh, '$env:DENO_INSTALL = Join-Path $HOME ".deno"');
  assertEquals(denoCandidates(envHost({ HOME: "/home/ana" })), [
    "deno",
    "/home/ana/.deno/bin/deno",
  ]);
});
