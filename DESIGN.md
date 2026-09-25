# Design Philosophy

[日本語](DESIGN.jp.md)

## UNIX and E2E

Meaning goes back into human understanding. Software does not own it.

- **Beyond Abstraction**: Bet on software driven directly from the layers below, not stacked on top of them. A layer that has outlived its role drags down everything that depends on it.
- **Standing on the Shoulders of Giants**: Use low-level primitives that are stable enough at the time, directly. tmux and the agent CLIs run things, git and the filesystem keep history, Tailscale handles reach and auth, the OS default apps are the desktop viewers, and the log is `jsonl`.
- **No Proxy to Intelligence**: Use the CLIs of the providers that actually hold the compute, directly, and keep the full reach they offer. Never wrap a wrapper.
- **No Institutional Semantics**: No 1:1 mapping of agents to worktrees, no plans, task graphs, handoffs, or domain types of its own. Institutions that make up for what today's LLMs can't do go stale as models evolve.

## The Window

If the window breaks, reality doesn't.

- **Projection, Not Reality**: The unified log is not the original. It is a projection that can trace each entry back to its position in the native log. The filesystem and git are observed again on every change; no synced copy is kept. Keep the SoT, and never rescue by guessing.
- **One Step to the Source**: The browser, the log file, tmux, Finder, the git tool, and the default apps are each one action away.
- **Don’t Disturb. You're Just an Application**: The composer minimizes and the window shrinks small. In Fit Mode the window fits itself to the messages, and a minimal standby state with Always on top keeps it beside whatever else you're doing.

## Beauty and Engineering for Humans

Desire, sense, body.

- **A Simple Want**: A plain wish to work with several AIs from one place. Or...
- **Unified Log**: What a human sees as one continuous flow becomes one log, as is. Agents and workspaces may change; there is still one log to read.
- **Beautiful and Usable**: Dressed in Liquid Glass, tuned to the pixel in looks and to the tenth of a second in speed. Everyday actions stay on the keyboard, and on mobile the controls gather at the bottom for one-handed use.

## The Algorithm

How Agent Window is developed.

1. **Question the Requirement**: A wrong requirement wastes every effort built on top of it.
2. **Delete**: Improvement is only defined against something. Remove that something and the problem goes with it. **The best part is no part.**
3. **Simplify and Optimize**: Only what has passed 1 and 2. Never improve what shouldn't exist.
4. **Accelerate**: Speed up only what has been simplified. Speeding up something **needlessly** complex is foolish.
5. **Automate**: Automate only the repetition that remains.
