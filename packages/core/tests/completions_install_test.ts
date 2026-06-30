import { assertEquals, assertStringIncludes } from "./_assert.ts";
import { Build, target } from "../mod.ts";
import { discoverTargets } from "../src/build.ts";
import { discoverParameters } from "../src/params.ts";
import { installCompletions } from "../src/completions_install.ts";

class Sample extends Build {
  build = target().description("Compile").executes(() => {});
}

const targets = discoverTargets(new Sample());
const params = discoverParameters(new Sample());

/**
 * An env reader that reports everything as unset, so tests are isolated from
 * the runner's real `XDG_CONFIG_HOME` and the config dir defaults to
 * `<home>/.config`.
 */
const isolatedEnv = () => undefined;

/** Run `fn` against a fresh temp directory used as the home dir. */
async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await Deno.makeTempDir();
  try {
    await fn(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("install bash writes the script and sources it from .bashrc", async () => {
  await withHome(async (home) => {
    const result = await installCompletions("bash", targets, params, {
      home,
      env: isolatedEnv,
    });
    assertEquals(result.shell, "bash");
    assertEquals(result.alreadySourced, false);
    assertEquals(
      result.scriptPath,
      `${home}/.config/zuke/completions/zuke.bash`,
    );
    assertEquals(result.rcPath, `${home}/.bashrc`);

    const script = await Deno.readTextFile(result.scriptPath);
    assertStringIncludes(script, "complete -F _zuke_complete zuke");
    const rc = await Deno.readTextFile(`${home}/.bashrc`);
    assertStringIncludes(rc, `source '${result.scriptPath}'`);
    assertStringIncludes(rc, "# zuke shell completion");
  });
});

Deno.test("install is idempotent — the rc is sourced once", async () => {
  await withHome(async (home) => {
    const first = await installCompletions("zsh", targets, params, {
      home,
      env: isolatedEnv,
    });
    assertEquals(first.alreadySourced, false);
    const second = await installCompletions("zsh", targets, params, {
      home,
      env: isolatedEnv,
    });
    assertEquals(second.alreadySourced, true);

    const rc = await Deno.readTextFile(`${home}/.zshrc`);
    const line = `source '${first.scriptPath}'`;
    const occurrences = rc.split(line).length - 1;
    assertEquals(occurrences, 1);
  });
});

Deno.test("install preserves existing rc content and appends", async () => {
  await withHome(async (home) => {
    await Deno.writeTextFile(`${home}/.bashrc`, "export FOO=1");
    const result = await installCompletions("bash", targets, params, {
      home,
      env: isolatedEnv,
    });
    const rc = await Deno.readTextFile(`${home}/.bashrc`);
    assertStringIncludes(rc, "export FOO=1");
    assertStringIncludes(rc, `source '${result.scriptPath}'`);
  });
});

Deno.test("install fish drops a file in the completions dir, no rc edit", async () => {
  await withHome(async (home) => {
    const result = await installCompletions("fish", targets, params, {
      home,
      env: isolatedEnv,
    });
    assertEquals(result.rcPath, undefined);
    assertEquals(result.alreadySourced, false);
    assertEquals(
      result.scriptPath,
      `${home}/.config/fish/completions/zuke.fish`,
    );
    const script = await Deno.readTextFile(result.scriptPath);
    assertStringIncludes(script, "complete -c zuke -f");
  });
});

Deno.test("install honours XDG_CONFIG_HOME for the script location", async () => {
  await withHome(async (home) => {
    const xdg = `${home}/xdg`;
    const result = await installCompletions("bash", targets, params, {
      home,
      env: (name) => (name === "XDG_CONFIG_HOME" ? xdg : undefined),
    });
    assertEquals(result.scriptPath, `${xdg}/zuke/completions/zuke.bash`);
  });
});

Deno.test("install single-quotes the sourced path so it can't be interpreted", async () => {
  await withHome(async (home) => {
    // A config dir carrying shell metacharacters must not break out of the rc
    // line: the whole path is single-quoted and any embedded `'` is escaped.
    const configHome = `${home}/o'brien$(touch pwned)`;
    const result = await installCompletions("bash", targets, params, {
      home,
      configHome,
    });
    const rc = await Deno.readTextFile(`${home}/.bashrc`);
    const escaped = result.scriptPath.replaceAll("'", "'\\''");
    assertStringIncludes(rc, `source '${escaped}'`);
  });
});
