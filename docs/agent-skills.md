# Agent skills

Zuke ships **agent skills** so AI coding assistants set up and author builds the
right way — using the typed `*Tasks` wrappers instead of guessing the API or
shelling out. Two skills, authored once as portable
[`SKILL.md`](https://agentskills.io) folders under [`skills/`](../skills):

| Skill              | Use it to                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `zuke-setup`       | Scaffold Zuke into a project (`zuke setup`, the `./zuke` launcher, a first build).           |
| `zuke-write-build` | Write or edit a `zuke.ts` — add targets, wire dependencies, call tool wrappers, generate CI. |

## Claude Code

The skills are packaged as a Claude Code plugin distributed from this repo's
marketplace. In Claude Code:

```text
/plugin marketplace add zuke-build/zuke
/plugin install zuke@zuke
```

That makes `zuke-setup` and `zuke-write-build` available — they trigger
automatically when you ask Claude to add Zuke to a project or write a build, and
can be invoked explicitly as `/zuke:zuke-setup` and `/zuke:zuke-write-build`.

## OpenAI Codex

The same plugin installs into Codex from this repo (it carries a Codex-native
`.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json` alongside the
Claude manifests):

```text
codex plugin marketplace add zuke-build/zuke
codex plugin add zuke@zuke
```

A single skill can also be pulled straight from the repo with Codex's built-in
installer skill, e.g.
`$skill-installer install https://github.com/zuke-build/zuke/tree/master/skills/zuke-write-build`.

## Gemini CLI

The repo doubles as a Gemini CLI extension (the root `gemini-extension.json`;
Gemini auto-discovers the `skills/` folder next to it):

```text
gemini extensions install https://github.com/zuke-build/zuke
```

Gemini installs a GitHub extension from the repo's **latest release**, so the
extension tracks releases rather than `master`. Each release carries a minimal
extension archive (the manifest plus `skills/`, attached by the `release`
target), so the install downloads two skills, not the whole monorepo.

> The `SKILL.md` content is harness-agnostic (the open
> [Agent Skills](https://agentskills.io) standard); each manifest above is a
> thin adapter over the shared [`skills/`](../skills) source, so every harness
> serves the same two skills.

