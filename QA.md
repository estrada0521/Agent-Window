# Q&A

[日本語](QA_jp.md)

### Is this a product for general users?

No. It is a personal tool that the author actually uses, published as-is.
You are free to use, modify, or repurpose it, but no setup support or operational guarantees are provided.

### Why does it support only macOS?

Because the author uses it on macOS.
Cross-platform support is not a goal.

### How do you handle changes to native log formats?

When the author encounters a problem, the necessary parts are updated to match the format change.
Agent Window has been used continuously across model updates, with no issues so far.

### Why don't you use SDKs or structured protocols?

To use each CLI's authentication, subscription, commands, and context management as-is.
Because the actual runtime is an ordinary CLI, it remains operable from the terminal even if Agent Window stops.

### Why do you use tmux?

Because it is an established low-level primitive.
The proliferating `*-mux` tools are already too feature-rich.

### Why do you use `tmux send-keys` for sending?

Because all that is needed is text input.
Input from a human and input from one Agent to another are not distinguished.
Failure cases are virtually nonexistent, so formalizing acknowledgement, retries, and idempotency would be excessive.

### Why don't you use MCP for Agent-to-Agent communication?

If all that is needed is to send text, entering it into the other Agent's CLI is enough.
Adding a dedicated protocol would only increase the implementation and maintenance surface.

### Why don't you save tool calls to the shared JSONL?

To keep the shared JSONL as a meaningful conversation record.
Tool calls are displayed on screen, but persisting them would make most of the record noise. The native logs remain available when needed.

### Where are conversation history and attachments stored?

Conversation history is stored at `~/.agent-window/session/{session_name}/.log.jsonl`. A symlink is created at `.agent-window/.log.jsonl` in the workspace so Agents can easily access it.
Attachments are stored in `.agent-window/uploads/` in the workspace.

### Does Agent Window send data externally?

No. Agent Window itself does not send any data externally.
Any communication performed by an Agent CLI belongs to that CLI.

### Why don't you implement task graphs or role management?

To avoid fixing what can be handled through natural language and existing tools into an Agent Window-specific system.

### Why don't you manage worktrees automatically?

Because neither their necessity nor how work should be divided can be determined uniformly.
When needed, a human or Agent handles them through ordinary Git operations.

### Won't multiple Agents editing the same workspace conflict?

It depends on the Agents. If they are mindful of each other, they do not conflict.
Agent Window does not impose constraints and leaves this to the Agents' intelligence.

### Why does it bind to `0.0.0.0`?

To use the PWA from an iPhone on the LAN.
It assumes use on a trusted local network and does not implement authentication. In the author's environment, combining the PWA with authentication would only add an unnecessary maintenance burden.
If needed, please change the bind address or add authentication yourself.
