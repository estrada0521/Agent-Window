# Design Philosophy

[日本語](DESIGN_jp.md)

## Assumptions

Agent Window returns semantics, and their abstraction, to where they actually belong — inside human perception — and lets no software own them.

What a human recognizes as one continuous thing changes names along the way. The workspace may change too. Agents get swapped; processes end and restart. Recognition stays softly continuous across all of it.

Agent Window doesn't convert that continuity into a fixed application object. A session name is just a display label. A workspace is just wherever work currently happens. A runtime is just an environment for keeping a process alive. A log just records the trace of what happened. Agent Window keeps no institution that syncs these as if they were one entity.

A workspace already exists. Whether it's a repository, a database, a temporary directory, or just a folder — Agent Window doesn't ask. A workspace isn't identity; it's simply where participants currently work. It can change when it needs to.

Agents and humans are the intelligence that participates in that reality, temporarily or semi-permanently. An agent handles reality directly from inside. A human needs a window to see across it from outside. Agent Window's GUI is that window.

The window can break without reality breaking.

## Unified Log

Human → agent, agent → human, and agent → agent messages, along with events Agent Window itself causes, are recorded to one log in observed order.

This is not the original record of the world. Each original lives in its own proper place; the unified log is a projection of them, reduced to a granularity both humans and agents can reference across.

What it actually is: an append-only JSONL file, reachable from the current workspace via a symlink. It isn't application-internal state — it survives Agent Window stopping, and stays readable.

Names, processes, and workspaces can change; past entries stay exactly as observed, with their provenance intact. Each entry traces back to the position in the native log it references. The projection is not one-way.

## What I Don't Implement

Agent Window doesn't assume work divides into clean boundaries.

Multiple agents may work the same workspace. One continuous thread of work may move to a different workspace. Agent Window never assumes the lifespans or boundaries of an agent, a task, a worktree, and a workspace line up.

It doesn't map an agent to a git worktree 1:1, for instance. Their lifespans and boundaries don't match, and persisting that mapping would make Agent Window itself a new source of truth.

Contracts like plan, role, task graph, or handoff aren't fixed in place just to compensate for current LLM limitations, either. Whatever intelligence itself can already handle with natural language and existing tools turns any application-side institution stale as models improve.

Whatever isolation or history-tracking is needed uses existing primitives. None of it becomes a permanent, Agent-Window-specific domain model.

## What I Implement

What Agent Window implements is limited to facts that wouldn't exist unless Agent Window created them, or mechanisms a participant can't reach directly from within reality.

For example:

- Launching participants, keeping them alive, and making them reachable to each other
- Observing scattered events and workspace changes, and projecting them into a form a human can read across
- Preserving the minimum information needed to reconstruct state across a runtime's death

`agent-send`, too, stays a razor-thin wrapper that delivers a string to an existing input path — not a messaging protocol of its own.

## Summary

Own no meaning.

Implement only what's unavoidable, and read facts from where they actually live.
