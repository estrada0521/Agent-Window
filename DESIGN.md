## Agent Window Design Philosophy

[日本語](DESIGN_jp.md)

Agent Window is not a framework for managing multiple AI agents. It is an intentionally thin interface that launches existing CLIs, sends them text, and brings their messages into a single screen and timeline.

The basic principle is to **do as little as possible beyond the obvious**.

A tmux session tied to one workspace is treated as a single working environment. Even when any number of different CLIs are launched within it, the conversation is not divided by agent. There is one project, and agents participate in its work temporarily. Even as CLIs repeatedly exit and restart, the record remains in the same timeline.

There is no need to treat humans and AI—or AIs with one another—exchanging text and dividing work when necessary as orchestration. It is fundamentally just ordinary communication. When an application predefines concepts such as roles, handoffs, task graphs, shared memory, or worktree ownership, it creates a form of debt: the work must then conform to that structure. There is no reason to turn what natural language can adequately express into a separate formal system.

The same applies to communication between agents. `agent-send` is a lowest-level mechanism that simply enters text into another Agent CLI specified by the sending Agent; technically, it is nothing more than a wrapper around `tmux send-keys`. From the receiver's perspective, there is no essential difference between text entered by a human and text sent by another agent. It does not introduce a dedicated communication protocol or shared mailbox; it merely shortens, in the smallest possible way, the act of a human entering text into another CLI.

The unified log records messages sent from humans to Agents, from Agents to humans, and from one Agent to another. It simply monitors and consolidates the CLIs' native logs—nothing more and nothing less. It does not indiscriminately record tool calls or command output contained in each CLI's native log. It brings only ordinary messages together into a common timeline that can serve as a project history and conversation record for humans and Agents to read.

Agent Window is responsible for the unavoidable low-level mechanisms: launching CLIs, delivering input, capturing messages, persisting logs, and reflecting workspace state. Decisions such as which agents to use, how to divide work, whether to use worktrees, and who should decide are left to humans or agents, leaving their intelligence unobstructed.

In other words: **implement unavoidable mechanisms, but do not institutionalize decisions that intelligent actors can make for themselves.**

Contracts added to compensate for limitations in model capabilities can become liabilities as models grow more capable. Agent Window does not reimplement agent planning, division of labor, Git operations, or context management as features of its own. As upstream CLIs and models improve, it uses those capabilities directly. It is designed not to obstruct the progress of models or freeze assumptions from the past.

As a rule, Agent Window prioritizes agents from organizations likely to endure over the long term: organizations that control large-scale computing resources themselves, develop or directly operate their models, and provide them through first-party CLIs. Aggregators that merely place third-party APIs behind a common interface, and provider-neutral agent frameworks, are not treated as actors with a durable long-term advantage.
