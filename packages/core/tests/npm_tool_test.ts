import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "./_assert.ts";
import { withAmbientEcho } from "../src/ambient_echo.ts";
import { type OperatingSystem, operatingSystem } from "../src/host.ts";
import { installNpmTool, type NpmRunner } from "../src/npm_tool.ts";

const HOST_OS = operatingSystem();
/** The npm bin-shim suffix on the host (`.cmd` on Windows, else none). */
const EXE = HOST_OS === "windows" ? ".cmd" : "";

/**
 * A fake npm runner that records each argv and plants the package's bin file
 * under the `--prefix` it was given — the hermetic stand-in for a real
 * `npm install`, with no network and no ambient npm.
 */
function fakeNpm(
  bin: string,
  os: OperatingSystem = HOST_OS,
): { run: NpmRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: NpmRunner = async (args) => {
    calls.push(args);
    const prefix = args[args.indexOf("--prefix") + 1];
    const dir = `${prefix}/node_modules/.bin`;
    await Deno.mkdir(dir, { recursive: true });
    const file = os === "windows" ? `${bin}.cmd` : bin;
    await Deno.writeTextFile(`${dir}/${file}`, "#!/bin/sh\n");
  };
  return { run, calls };
}

Deno.test("installNpmTool installs, returns the bin path, and records the argv", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    const bin = await installNpmTool(
      { name: "vitest", version: "4.1.9" },
      { destDir: dir, run, os: "linux" },
    );
    assertEquals(bin.name, "vitest");
    assertEquals(
      bin.path.endsWith("/npm/vitest@4.1.9/node_modules/.bin/vitest"),
      true,
    );
    assertEquals(calls.length, 1);
    assertEquals(calls[0][0], "install");
    assertEquals(calls[0][1], "--prefix");
    assertEquals(calls[0][2].endsWith("/npm/vitest@4.1.9"), true);
    assertEquals(calls[0][3], "--no-save");
    assertEquals(calls[0][4], "vitest@4.1.9");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installNpmTool returns the .cmd shim path on Windows", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run } = fakeNpm("vitest", "windows");
    const bin = await installNpmTool(
      { name: "vitest", version: "1.0.0" },
      { destDir: dir, run, os: "windows" },
    );
    assertEquals(bin.name, "vitest.cmd");
    assertEquals(bin.path.endsWith("/node_modules/.bin/vitest.cmd"), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installNpmTool resolves a bin that differs from the package name", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("nest", "linux");
    const bin = await installNpmTool(
      { name: "@nestjs/cli", version: "10.0.0", bin: "nest" },
      { destDir: dir, run, os: "linux" },
    );
    assertEquals(bin.name, "nest");
    assertEquals(
      bin.path.endsWith("/npm/@nestjs/cli@10.0.0/node_modules/.bin/nest"),
      true,
    );
    assertEquals(calls[0][4], "@nestjs/cli@10.0.0"); // scoped name@version
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a matching marker with the bin present is reused without re-running npm", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const first = await installNpmTool(spec, {
      destDir: dir,
      run,
      os: "linux",
    });
    const second = await installNpmTool(spec, {
      destDir: dir,
      run,
      os: "linux",
    });
    assertEquals(first.path, second.path);
    assertEquals(calls.length, 1); // the second call short-circuited on the marker
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a different version misses the cache and re-installs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    await installNpmTool({ name: "vitest", version: "1.0.0" }, {
      destDir: dir,
      run,
      os: "linux",
    });
    await installNpmTool({ name: "vitest", version: "2.0.0" }, {
      destDir: dir,
      run,
      os: "linux",
    });
    assertEquals(calls.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a marker recording a different package is ignored (re-installs)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const bin = await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    const prefix = bin.parent().parent().parent();
    await Deno.writeTextFile(
      String(prefix(".zuke-npm-tool.json")),
      JSON.stringify({ name: "vitest", version: "9.9.9" }),
    );
    await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    assertEquals(calls.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a malformed marker is treated as absent (re-installs)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const bin = await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    const marker = String(
      bin.parent().parent().parent()(".zuke-npm-tool.json"),
    );
    // Unparseable JSON, then valid JSON of the wrong shape — both re-install.
    await Deno.writeTextFile(marker, "{not json");
    await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    await Deno.writeTextFile(marker, JSON.stringify({ name: 123 }));
    await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    assertEquals(calls.length, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a valid marker whose bin has gone re-installs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run, calls } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const bin = await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    await Deno.remove(String(bin)); // marker stays, but the bin is gone
    await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    assertEquals(calls.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installNpmTool rejects an unsafe name, version, or bin", async () => {
  let ran = 0;
  const noop: NpmRunner = () => {
    ran++;
    return Promise.resolve();
  };
  for (const name of ["", "../evil", "--registry=x", "a/b/c", "foo bar"]) {
    await assertRejects(
      () => installNpmTool({ name, version: "1.0.0" }, { run: noop }),
      Error,
      "invalid npm tool name",
    );
  }
  for (const version of ["", "-1", "../x", "1 2", "a/b"]) {
    await assertRejects(
      () => installNpmTool({ name: "vitest", version }, { run: noop }),
      Error,
      "invalid version",
    );
  }
  await assertRejects(
    () =>
      installNpmTool({ name: "x", version: "1.0.0", bin: "../evil" }, {
        run: noop,
      }),
    Error,
    "invalid bin",
  );
  assertEquals(ran, 0); // validation rejects before npm is ever invoked
});

Deno.test("installNpmTool throws when npm plants no bin, writing no marker", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const calls: string[][] = [];
    // A runner that "succeeds" but plants nothing — a typo'd bin, or a package
    // that ships no executable: npm exits 0 without creating node_modules/.bin.
    const emptyRun: NpmRunner = async (args) => {
      calls.push(args);
      await Deno.mkdir(args[args.indexOf("--prefix") + 1], { recursive: true });
    };
    const spec = { name: "vitest", version: "4.1.9" };
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run: emptyRun, os: "linux" }),
      Error,
      "its bin was not found",
    );
    // No marker was written, so a retry re-runs npm (no false cache hit).
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run: emptyRun, os: "linux" }),
      Error,
      "its bin was not found",
    );
    assertEquals(calls.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a rejecting npm runner propagates and writes no marker", async () => {
  const dir = await Deno.makeTempDir();
  try {
    let calls = 0;
    const failing: NpmRunner = () => {
      calls++;
      return Promise.reject(new Error("npm exploded"));
    };
    const spec = { name: "vitest", version: "4.1.9" };
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run: failing, os: "linux" }),
      Error,
      "npm exploded",
    );
    // A failed install must not poison the cache — the retry re-runs.
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run: failing, os: "linux" }),
      Error,
      "npm exploded",
    );
    assertEquals(calls, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a non-NotFound error reading the marker surfaces (not swallowed)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const bin = await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    // Replace the marker file with a directory → readTextFile throws EISDIR,
    // which is not NotFound and must propagate, not be treated as "no marker".
    const marker = String(
      bin.parent().parent().parent()(".zuke-npm-tool.json"),
    );
    await Deno.remove(marker);
    await Deno.mkdir(marker);
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run, os: "linux" }),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a non-NotFound error stat-ing the bin surfaces (not swallowed)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { run } = fakeNpm("vitest", "linux");
    const spec = { name: "vitest", version: "4.1.9" };
    const bin = await installNpmTool(spec, { destDir: dir, run, os: "linux" });
    // Turn node_modules into a file: stat-ing the bin path now traverses through
    // a non-directory → NotADirectory, which is not NotFound and must propagate.
    const prefix = bin.parent().parent().parent();
    await Deno.remove(String(prefix("node_modules")), { recursive: true });
    await Deno.writeTextFile(String(prefix("node_modules")), "not a dir");
    await assertRejects(
      () => installNpmTool(spec, { destDir: dir, run, os: "linux" }),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installNpmTool runs the ambient npm by default", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const echoed: string[] = [];
    // With no injected runner, the default runner spawns `npm` via the Command
    // class. Under a deep-dry-run echo sink it echoes the argv instead of
    // spawning — so npm plants no bin and the post-install check then reports
    // it, which proves the default runner (and its exact argv) was invoked.
    await assertRejects(
      () =>
        withAmbientEcho(
          (line) => echoed.push(line),
          () =>
            installNpmTool({ name: "vitest", version: "4.1.9" }, {
              destDir: dir,
              os: "linux",
            }),
        ),
      Error,
      "its bin was not found",
    );
    assertEquals(echoed.length, 1);
    assertStringIncludes(echoed[0], "npm install --prefix");
    assertStringIncludes(echoed[0], "--no-save vitest@4.1.9");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("installNpmTool defaults the install root to .zuke/tools and the host OS", async () => {
  const dir = await Deno.makeTempDir();
  const original = Deno.cwd();
  try {
    Deno.chdir(dir);
    const { run } = fakeNpm("vitest"); // host OS
    const bin = await installNpmTool(
      { name: "vitest", version: "4.1.9" },
      { run }, // no destDir, no os → .zuke/tools + host OS
    );
    assertEquals(
      bin.path.endsWith(
        `/.zuke/tools/npm/vitest@4.1.9/node_modules/.bin/vitest${EXE}`,
      ),
      true,
    );
  } finally {
    Deno.chdir(original);
    await Deno.remove(dir, { recursive: true });
  }
});
