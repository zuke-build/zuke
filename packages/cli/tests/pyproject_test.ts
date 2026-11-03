// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

import { assertEquals, assertThrows } from "../../core/tests/_assert.ts";
import { parsePyproject } from "../src/pyproject.ts";

Deno.test("parsePyproject reads poethepoet tasks in every form", () => {
  const tasks = parsePyproject(`
[tool.poe.tasks]
lint = "ruff check ."
fmt = { cmd = "ruff format .", help = "Format the code" }
types.shell = "pyright"
check = ["lint", "types"]
test = { cmd = "pytest", deps = ["lint", "nope", 3] }
docs = { script = "app.docs:main" }
alias = { ref = "lint" }
with_args = { ref = "lint --fix" }
ci.sequence = ["check", "lint", "echo done", { cmd = "echo cmd" }, { ref = "test" }, { expr = "1" }]
`);
  assertEquals(tasks, [
    { name: "lint", steps: [{ command: "ruff check ." }], deps: [] },
    { name: "fmt", steps: [{ command: "ruff format ." }], deps: [] },
    { name: "types", steps: [{ command: "pyright" }], deps: [] },
    { name: "check", steps: [], deps: ["lint", "types"] },
    { name: "test", steps: [{ command: "pytest" }], deps: ["lint"] },
    {
      name: "docs",
      steps: [{ todo: 'translate this task: {"script":"app.docs:main"}' }],
      deps: [],
    },
    { name: "alias", steps: [], deps: ["lint"] },
    {
      name: "with_args",
      steps: [{ todo: 'translate this task: {"ref":"lint --fix"}' }],
      deps: [],
    },
    {
      name: "ci",
      steps: [
        { command: "echo done" },
        { command: "echo cmd" },
        // After a command, a dependency would run `test` too early.
        {
          todo:
            "run the test task here; it follows a command, so it is not a dependency",
        },
        { todo: 'translate this task: {"expr":"1"}' },
      ],
      deps: ["check", "lint"],
    },
  ]);
});

Deno.test("parsePyproject reads pdm scripts, skipping the shared _ options", () => {
  const tasks = parsePyproject(`
[tool.pdm.scripts]
_.env_file = ".env"
start = "flask run -p 54321"
argv = { cmd = ["pytest", "-k", "not slow"] }
sh = { shell = "cat a | grep b" }
all = { composite = ["start", "argv", "echo end"] }
serve = { call = "app:main" }
args = "pytest {args}"
args_list = { cmd = ["pytest", "{args:tests}"] }
`);
  assertEquals(tasks.map((t) => t.name), [
    "start",
    "argv",
    "sh",
    "all",
    "serve",
    "args",
    "args_list",
  ]);
  assertEquals(tasks[1].steps, [{ argv: ["pytest", "-k", "not slow"] }]);
  assertEquals(tasks[2].steps, [{ command: "cat a | grep b" }]);
  assertEquals(tasks[3], {
    name: "all",
    steps: [{ command: "echo end" }],
    deps: ["start", "argv"],
  });
  assertEquals(tasks[4].steps, [{
    todo: 'translate this task: {"call":"app:main"}',
  }]);
  // A placeholder only pdm fills is not a literal argument.
  assertEquals(tasks[5].steps, [{
    todo: "translate this task runner placeholder: pytest {args}",
  }]);
  assertEquals(tasks[6].steps, [{
    todo: "translate this task runner placeholder: pytest {args:tests}",
  }]);
});

Deno.test("parsePyproject reads hatch default-environment scripts", () => {
  const tasks = parsePyproject(`
[tool.hatch.envs.default.scripts]
test = "pytest"
cov = ["test", "coverage report", "coverage html"]
`);
  assertEquals(tasks, [
    { name: "test", steps: [{ command: "pytest" }], deps: [] },
    {
      name: "cov",
      steps: [{ command: "coverage report" }, { command: "coverage html" }],
      deps: ["test"],
    },
  ]);
});

Deno.test("parsePyproject reads taskipy and rye tables", () => {
  assertEquals(
    parsePyproject(
      '[tool.taskipy.tasks]\ntest = { cmd = "pytest", help = "h" }',
    ),
    [{ name: "test", steps: [{ command: "pytest" }], deps: [] }],
  );
  assertEquals(
    parsePyproject(`
[tool.rye.scripts]
serve = { cmd = "flask run", env = { FLASK_DEBUG = "1" } }
lint = { chain = ["lint:black", "serve"] }
"lint:black" = "black --check src"
`),
    [
      { name: "serve", steps: [{ command: "flask run" }], deps: [] },
      { name: "lint", steps: [], deps: ["lint:black", "serve"] },
      {
        name: "lint:black",
        steps: [{ command: "black --check src" }],
        deps: [],
      },
    ],
  );
});

Deno.test("parsePyproject reads only the first task table present", () => {
  const tasks = parsePyproject(`
[tool.pdm.scripts]
a = "x"
[tool.poe.tasks]
b = "y"
`);
  assertEquals(tasks.map((t) => t.name), ["b"]);
});

Deno.test("parsePyproject finds no tasks without a task table", () => {
  assertEquals(parsePyproject('[project]\nname = "app"\n'), []);
  assertEquals(parsePyproject("[tool]\npoe = 1\n"), []);
  assertEquals(parsePyproject(""), []);
});

Deno.test("parsePyproject keeps a value it cannot read as a TODO", () => {
  const tasks = parsePyproject(`
[tool.poe.tasks]
n = 3
e = []
odd = { cmd = [] }
`);
  assertEquals(tasks, [
    { name: "n", steps: [{ todo: "translate this task: 3" }], deps: [] },
    { name: "e", steps: [], deps: [] },
    {
      name: "odd",
      steps: [{ todo: 'translate this task: {"cmd":[]}' }],
      deps: [],
    },
  ]);
});

Deno.test("parsePyproject records a repeated or self-naming step once", () => {
  const [task] = parsePyproject(
    '[tool.poe.tasks]\nloop = ["loop", "loop", { ref = "loop" }]\n',
  );
  // Left for the generator's cycle check to drop, with a note.
  assertEquals(task.deps, ["loop"]);
});

Deno.test("parsePyproject turns a pathologically nested value into a friendly error", () => {
  // The reader recurses per array level; a hostile file nesting deep enough
  // to exhaust the stack must still fail as "cannot read", not crash.
  assertThrows(
    () => parsePyproject(`x = ${"[".repeat(200_000)}`),
    Error,
    "zuke import: cannot read pyproject.toml",
  );
});

Deno.test("parsePyproject names the line of malformed TOML", () => {
  assertThrows(
    () => parsePyproject('[tool.poe.tasks]\nlint = "ruff\n'),
    Error,
    "zuke import: cannot read pyproject.toml — line 2: unterminated string",
  );
});
