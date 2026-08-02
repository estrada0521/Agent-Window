## Agent Window Design Philosophy

[日本語](DESIGN_jp.md)

Agent Window is not a framework for managing multiple AI agents. It is an intentionally thin interface that launches existing CLIs, sends them text, and brings their messages into a single screen and timeline.

Every feature is decided by one test: **is this something a sufficiently capable participant can settle by thinking?** If it is, Agent Window does not implement it. If it is not, Agent Window must. The former grows less necessary as models improve; the latter grows more necessary. What follows is to do as little as possible beyond the obvious.

A tmux session tied to one workspace is treated as a single working environment. Even when any number of different CLIs are launched within it, the conversation is not divided by agent. There is one project, and agents participate in its work temporarily. Even as CLIs repeatedly exit and restart, the record remains in the same timeline.

There is no need to treat humans and AI—or AIs with one another—exchanging text and dividing work when necessary as orchestration. It is fundamentally just ordinary communication. When an application predefines concepts such as roles, handoffs, task graphs, shared memory, or worktree ownership, it creates a form of debt: the work must then conform to that structure. There is no reason to turn what natural language can adequately express into a separate formal system.

Coordination is not a feature to be built; it is something participants do. Given a channel and a record, review, division of labor, and agreed limits appear when they are needed, in the form they are needed. They also arrive with their reasons attached. A protocol handed down by an application arrives with only its rules.

The same applies to communication between agents. `agent-send` is a lowest-level mechanism that simply enters text into another Agent CLI specified by the sending Agent; technically, it is nothing more than a wrapper around `tmux send-keys`. From the receiver's perspective, there is no essential difference between text entered by a human and text sent by another agent. It does not introduce a dedicated communication protocol or shared mailbox; it merely shortens, in the smallest possible way, the act of a human entering text into another CLI.

The unified log records messages sent from humans to Agents, from Agents to humans, and from one Agent to another, in the order they occurred. It does not record the tool calls or command output contained in each CLI's native log. It brings together only ordinary messages that can serve as a project history and conversation record for humans and Agents to read.

This is not a feature of the interface. It is one file in the workspace. Agent Window does not own it, and it can be read without Agent Window. Where someone was wrong and later corrected it, that too remains, unsummarized.

Agent Window is responsible for launching CLIs, delivering input, capturing messages, persisting logs, and reflecting workspace state—the layer that no amount of intelligence can satisfy, only mechanism. Decisions such as which agents to use, how to divide work, whether to use worktrees, and who should decide are left to humans or agents, leaving their intelligence unobstructed.

In other words: **implement unavoidable mechanisms, but do not institutionalize decisions that intelligent actors can make for themselves.**

Contracts added to compensate for limitations in model capabilities can become liabilities as models grow more capable. Agent Window does not reimplement agent planning, division of labor, Git operations, or context management as features of its own. As upstream CLIs and models improve, it uses those capabilities directly. It is designed not to obstruct the progress of models or freeze assumptions from the past.

Agent Window prioritizes agents from organizations that control large-scale computing resources themselves, develop or directly operate their models, and provide them through first-party CLIs. This is not a judgment of quality; it is a question of who owns the interface. Aggregators that merely place third-party APIs behind a common interface, and provider-neutral agent frameworks, make their behavior depend on a layer they do not control. Since Agent Window implements nothing to compensate for an agent's limitations, it depends entirely on the upstream CLI. Choosing what to connect to is the consequence.
