---
name: agent-send
description: >-
  Use when the user wants to contact, notify, relay to, ask help from,
  broadcast to, or assign a session-local name to other agents in an
  Agent Window session.
  Use normal assistant output for replies to the user; never use agent-send
  for user-facing responses.
---

# Send Messages to and Name Other Agents

Use this skill only for agent-to-agent communication in an Agent Window
session. Replies to the user must use normal assistant output because native
event logs are synchronized automatically.

## Syntax

```bash
printf '%s' '<message body>' | agent-send <target>
```

Target a different session:

```bash
printf '%s' '<message body>' | agent-send --session <session_name> <target>
```

## Rules

1. For message sends, always pass the message body through stdin using `printf`.
2. For message sends, never use `echo` or a heredoc.
3. The message target is a positional argument; do not pass the message body as an inline argument.
4. Do not add a `[From: ...]` prefix. `agent-send` adds it automatically.
5. Do not use `agent-send` to reply to the user.
6. Distinguish carefully between a base target and a specific instance target.

## Base Targets and Instance Targets

A base target sends the message to every active instance of that agent:

```bash
printf '%s' 'Please review this.' | agent-send codex
```

For example, if both `codex-1` and `codex-2` are active, targeting `codex`
sends the message to both.

An instance target sends the message only to that exact instance:

```bash
printf '%s' 'Please inspect the parser.' | agent-send codex-1
printf '%s' 'Please inspect the UI.' | agent-send codex-2
```

This distinction applies to every agent type, such as `claude-1`,
`claude-2`, `gemini-1`, or `cursor-2`.

Use the exact instance names shown in the current session topology.
They are available in `MULTIAGENT_AGENTS` and through:

```bash
multiagent context
```

When only one instance of an agent is active, its name may be unsuffixed,
such as `codex`. Do not assume that `codex-1` exists.

## Current Base Targets

| Target | Agent |
|---|---|
| `claude` | Claude |
| `codex` | Codex |
| `gemini` | Antigravity |
| `copilot` | Copilot |
| `cursor` | Cursor |
| `grok` | Grok |
| `others` | Every active agent instance except yourself |

Use `gemini` when sending to Antigravity. Do not use `agy` or `antigravity`
as an `agent-send` target.

`others` excludes only the sender's own instance. For example, when
`codex-1` sends to `others`, `codex-2` is still included.

Multiple base and instance targets can be mixed:

```bash
printf '%s' 'Please check this change.' | agent-send claude,codex-2,gemini
```

Duplicate resolved targets are delivered only once.

## Agent Names

Assign a session-local name to one active agent instance:

```bash
agent-send name <target> <name>
```

For example:

```bash
agent-send name claude-2 Fable
printf '%s' 'Please review this.' | agent-send Fable
```

The assigned name is an additional address, not a replacement. In this
example, both `Fable` and `claude-2` address the same instance. The base target
`claude` also keeps its existing behavior: it addresses the only Claude
instance when one is active, or every active Claude instance when duplicated.

Names affect only `agent-send` addressing and the automatic `[From: ...]`
prefix. Canonical instance names and JSONL sender/target identities do not
change. Names are local to the Agent Window session.

The target passed to `name` must identify exactly one active instance. Use an
exact instance target such as `claude-2` when duplicate instances exist. An
existing assigned name may also be used as the target. Quote a name containing
spaces:

```bash
agent-send name claude-2 'Blue Fable'
```

List or remove names without piping stdin:

```bash
agent-send names
agent-send unname <target-or-name>
```

To manage names in another session, place `--session` before the naming
command:

```bash
agent-send --session <session_name> name <target> <name>
```

## Examples

Ask only `codex-1` for help:

```bash
printf '%s' 'Please review the current implementation.' | agent-send codex-1
```

Ask every Codex instance:

```bash
printf '%s' 'Please independently review this issue.' | agent-send codex
```

Broadcast to every other instance:

```bash
printf '%s' 'The shared interface has changed.' | agent-send others
```
