# Design Philosophy

[日本語](DESIGN_jp.md)

Agent Window is a thin interface for projecting **space** (where the work happens), **time** (its history), and the **intelligence** that acts within them — without modeling any of it.

## Assumptions

A place to work already exists. A git repository, a database, a temporary directory for an investigation, or just a folder for writing a paper. Agent Window maps it to a single implementation unit — a tmux session tied to that workspace — and does not ask what it actually is.

Time already exists too. Its trace remains as an observable order of change: commits, file updates, processes starting and exiting.

And agents and humans are the intelligence that exists in that space and time, temporarily or semi-permanently. Both are present in the same place, read the same history, and speak to each other.
Their standing differs, though. An agent is inside the workspace and reads files directly. A human is outside, and needs a window. **The Agent Window GUI is a thin window through which a human watches an agent.**
The window can break without the space breaking. tmux holds the session; the GUI only looks in from outside.

## Unified Log

It records messages — human → agent, agent → human, agent → agent — along with session topology such as Add / Remove Agent, in chronological order.

This is not the original record. The originals are each CLI's native log, git, and the filesystem. The unified log is a **projection** of those, reduced to a granularity that humans and agents can both reference across. Native logs sitting at different paths, and history spanning process restarts, converge here into a single space and time.

What it is: a single append-only jsonl, symlinked into the workspace. It does not depend on Agent Window. The log is not application-internal state; it is a record left in the workspace.

Ordinary exchanges happen directly through `agent-send`. When you want a cross-cutting view of who is handling what and where someone is stuck, you read the unified log. And when exact reproduction is needed, each line leads back to the native log it references, and to its position within it.

## What We Don't Implement

plan, role, task graph, handoff. These are things **a sufficiently capable intelligence can settle by thinking**.

Additional contracts introduced to compensate for the current limits of LLMs go stale as models improve. There is no reason to convert something into an institution of our own when it can be expressed in natural language and already exists on the side of reality.

Isolation is no different. If needed, an intelligence can simply use `git worktree` — there is no reason for the application to own it. Owning it immediately creates the next problem:

- An agent and a worktree are not 1:1.
- Their lifetimes don't match.
- It becomes a second source of truth, duplicating the git state that already lives outside the application.

Agent Window does not only target projects with clear boundaries that decompose neatly into independent tasks. It is meant to also handle work where **how to divide and proceed is itself non-obvious**.

Communication between agents is the same. `agent-send` is technically an extremely thin wrapper around `tmux send-keys`, short-circuiting — in the smallest possible form — the act of a human typing text into a CLI. It has no dedicated protocol and no shared mailbox.

## What We Implement

There is one criterion:

> **What a participant cannot invoke from within reality.**

Only this is unavoidable.

- Launching CLIs, and keeping the processes alive
- Delivering input, and attaching the sender prefix
- Watching native logs, and merging them into the unified log
- Making the workspace observable

Launching a CLI is necessary at the point when the participant to call does not yet exist. Native logs sit at a different path for each agent, and break across process restarts. Merging a scattered space into one requires a vantage point outside every participant. None of this is reachable from inside.

## Summary

Implement the mechanisms that are unavoidable; do not institutionalize what an intelligent actor can judge for itself.

Project reality. Do not model it.