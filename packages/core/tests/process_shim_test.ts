// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { test } from "../../../tests/_testing.ts";
import { assertEquals } from "../../../tests/_assert.ts";
import { besideFile, shimScript, shimTarget } from "../src/process_shim.ts";

const SCRIPT = "..\\typescript\\bin\\tsc";

/** The shim npm writes, from version 7, as its own shim writer produces it. */
const NPM = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${SCRIPT}" %*`,
  "",
].join("\r\n");

/** The shim pnpm writes. */
const PNPM = [
  "@SETLOCAL",
  '@IF EXIST "%~dp0\\node.exe" (',
  `  "%~dp0\\node.exe"  "%~dp0\\${SCRIPT}" %*`,
  ") ELSE (",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  `  node  "%~dp0\\${SCRIPT}" %*`,
  ")",
  "",
].join("\r\n");

/** The shim Yarn 1 and early pnpm write. */
const OLD_NPM = [
  '@IF EXIST "%~dp0\\node.exe" (',
  `  "%~dp0\\node.exe"  "%~dp0\\${SCRIPT}" %*`,
  ") ELSE (",
  "  @SETLOCAL",
  "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
  `  node  "%~dp0\\${SCRIPT}" %*`,
  ")",
  "",
].join("\r\n");

test("the script a Node shim starts is read from each form the package managers write", () => {
  for (const shim of [NPM, PNPM, OLD_NPM]) {
    assertEquals(shimScript(shim), SCRIPT);
    // Line endings and a missing final one make no difference.
    assertEquals(shimScript(shim.replaceAll("\r\n", "\n").trimEnd()), SCRIPT);
  }
});

test("a file that is anything more than the shim is not seen through", () => {
  const not = (text: string) => assertEquals(shimScript(text), null);
  const start = `node "%~dp0\\cli.js" %*`;
  // An ordinary batch file, and ones that only hold the start line.
  not("@echo off\r\necho %*\r\n");
  not(`@${start}\r\n`);
  not(`@echo off\r\nset FOO=bar\r\ncd /d C:\\elsewhere\r\n${start}\r\n`);
  // Work after the start, on its line or the next.
  not(`@${start} && del /q C:\\x\r\n`);
  not(`@${start} > log.txt 2>&1\r\n`);
  for (const shim of [NPM, PNPM, OLD_NPM]) {
    not(`${shim}exit /b 0\r\n`);
    not(`@echo before\r\n${shim}`);
    not(shim.replace(" %*", " %* & del /q C:\\x"));
    // Options for Node, or an argument of the shim's own.
    not(shim.replace(`  "%`, ` --inspect "%`));
    not(shim.replaceAll(" %*", " --extra %*"));
    // A variable set for the tool, which starting the script would lose.
    not(shim.replace("SETLOCAL", "SETLOCAL\r\n@SET NODE_PATH=C:\\x"));
    not(shim.replace("SETLOCAL", 'SETLOCAL\r\n@SET "PATH=C:\\x;%PATH%"'));
    // A script that is not beside the shim, or holds a variable or a quote.
    not(shim.replaceAll(SCRIPT, "%EVIL%\\cli.js"));
    not(shim.replaceAll(SCRIPT, 'a" "b'));
    // Not the whole file, by one character.
    not(shim.replace("%*", "%1"));
    not(`\uFEFF${shim}`);
    not(shim.toLowerCase());
  }
  // A start line that is only a comment or an echo, or never reached.
  not(`@REM ${start}\r\n"%~dp0\\real.exe" %1 %2\r\n`);
  not(`@echo ${start}\r\n`);
  not(`@goto end\r\n${start}\r\n:end\r\n`);
  // Another program in front of it.
  for (const front of ['"%~dp0\\other.exe"', "npx", "start", "call", "my-"]) {
    not(`@${front} ${start}\r\n`);
  }
  // Another interpreter behind the variable, with the real one in a comment.
  not(
    NPM.replace('SET "_prog=node"', 'REM SET "_prog=node"\r\n  SET "_prog=sh"'),
  );
  not(NPM.replace('SET "_prog=node"', 'SET "_prog=calc"'));
  // The two starts of a two-branch shim disagreeing.
  not(PNPM.replace(`node  "%~dp0\\${SCRIPT}"`, 'node  "%~dp0\\other.js"'));
  not(OLD_NPM.replace(`node  "%~dp0\\${SCRIPT}"`, 'node  "%~dp0\\other.js"'));
  // What pnpm writes for a script that asks for a variable before Node.
  not(
    PNPM.replace('"%~dp0\\node.exe"  ', '"%~dp0\\NODE_ENV=x.exe"  node ')
      .replace("  node  ", "  NODE_ENV=x  node "),
  );
  not("");
});

test("a file is placed beside another by the other's directory", () => {
  assertEquals(
    besideFile("C:\\a\\b\\tsc.cmd", "node.exe"),
    "C:\\a\\b\\node.exe",
  );
  assertEquals(besideFile("C:/a/b/tsc.cmd", "x\\y"), "C:/a/b/x\\y");
  assertEquals(besideFile("tsc.cmd", "node.exe"), "node.exe");
});

test("a shim's target is the script beside it, when both are there", () => {
  const shim = "C:\\p\\node_modules\\.bin\\tsc.cmd";
  const target = `C:\\p\\node_modules\\.bin\\${SCRIPT}`;
  const readText = (path: string) => path === shim ? NPM : null;
  assertEquals(shimTarget(shim, readText, (path) => path === target), target);
  // On a share, and with forward slashes in the shim's own path.
  assertEquals(
    shimTarget("\\\\s\\p\\.bin\\tsc.cmd", () => PNPM, () => true),
    `\\\\s\\p\\.bin\\${SCRIPT}`,
  );
  assertEquals(
    shimTarget("C:/p/.bin/tsc.cmd", () => OLD_NPM, () => true),
    `C:/p/.bin/${SCRIPT}`,
  );
  // No script there, a file that cannot be read, or not a shim: not a target.
  assertEquals(shimTarget(shim, readText, () => false), null);
  assertEquals(shimTarget(shim, () => null, () => true), null);
  assertEquals(shimTarget(shim, () => "@echo off\r\n", () => true), null);
});

test("a shim not named by its full path is not read at all", () => {
  const readText = () => {
    throw new Error("read");
  };
  for (
    const file of [
      "node_modules\\.bin\\tsc.cmd",
      ".\\tsc.cmd",
      "tsc.cmd",
      "C:tsc.cmd",
      "\\p\\tsc.cmd",
    ]
  ) {
    assertEquals(shimTarget(file, readText, () => true), null);
  }
});
