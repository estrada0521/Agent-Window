# Agent Window

Agent Window is a **local interface for macOS** that I developed to work with Agent CLIs such as Claude, Codex, Gemini, Cursor, and Copilot in a single workspace and timeline. Each Agent CLI runs normally inside a tmux pane. Agent Window sends text to the selected pane, retrieves messages from each CLI's native log, and brings them together on one screen. Without wrapping the CLIs in a common API or replacing their runtimes with a custom agent runtime, it **uses the capabilities provided natively by each CLI**.

[Design philosophy](DESIGN.md) · [日本語](README_jp.md)

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

# Architecture

Each Agent Window session is associated with one workspace, one tmux process, one chat server, and one local JSONL log. Any Agent CLI can be added to or removed from the tmux panes. Multiple instances of the same Agent can run at once; each is identified by an instance name such as `Claude-3`. Conversation history belongs to the Agent Window session rather than to a CLI process. Even when a CLI is exited, restarted, removed, or added again, ordinary messages continue to be appended to the same JSONL as long as the session remains the same. The basic data flow is:

```text
Input field
  → chat server
  → tmux pane
  → Agent CLI

Agent CLI
  → native log
  → native log watcher
  → chat server
  → UI / session JSONL
```

Workspace and Git state are monitored separately through FSEvents and reflected in the right pane.

## Sending

The sending backend uses `tmux send-keys`. Text sent from the input field is entered directly into the pane running the selected Agent CLI. Because it is not converted into an Agent Window-specific message format, slash commands and other native CLI commands can be used as-is. Agent-to-agent messages are sent with `agent-send`. This is a thin wrapper that enters text into another specified Agent CLI, whether it is in the same session or a different one.

## Receiving

The receiving side resolves each CLI's native log path from its PID tree and related process information, then monitors it directly with kqueue. The mapping between processes and log paths is resolved again when necessary, such as after a CLI restart, an Agent being added again, or a chat server reload. The Agent Window session timeline therefore continues even when the CLI process changes. Events obtained from native logs are classified into ordinary messages, tool calls, and other categories. Ordinary messages sent from humans to Agents, from Agents to humans, and from one Agent to another are stored in the session JSONL. Tool calls and command output may be streamed temporarily to the screen when needed, but they are not indiscriminately persisted in the shared conversation history.

## App

Agent Window is fundamentally a locally running web app. The macOS version is a thin wrapper built with Rust and Tauri. It handles the parts required of a desktop application, such as window control and appearance. A PWA is also provided so mobile devices can connect to the same interface.

# Interface

## Hub

The Hub on the left manages the list of Agent Window sessions. New sessions are started, archived, and deleted from the Hub. Appearance and functional settings shared across sessions are also stored there. The three appearance themes are Dark, Light, and Hybrid. Enabling `Always on Top` keeps the Tauri window in front of other windows.

## Chat

The center of the interface displays ordinary messages exchanged with every Agent participating in the session as a single timeline. The display is not divided into independent chat rooms for each Agent. Switching between CLIs or running multiple Agents at the same time does not split the conversation: everything that happens within the same session remains in the same flow.

### Agent selection and input

Messages are sent to the currently selected Agent CLI. The input field is normally minimized to leave more room for the chat. Use the `O` button at the bottom of the screen to expand it. Typing `@` searches files in the workspace. The search uses a cache of file information obtained through FSEvents. Files can be attached with the plus button or by drag-and-drop. Attached files are saved to `.agent-window/uploads/` in the workspace, and their paths are passed to the Agent.

### Workspace

The right pane displays the state of the current workspace. File system changes are tracked with FSEvents, and uncommitted diffs are shown in a compact form. Untracked files can be deleted or ignored, and individual files can be reverted. The minimal embedded file viewer supports text files, HTML, Markdown, and other common formats. When `External Editor` is enabled, files open in the configured external editor. This is the normal mode of use.

### Menu

The hamburger button in the top-right provides the following actions.

* `Terminal`
  Opens the tmux terminal associated with the session.

* `Finder`
  Opens the session workspace in Finder.

* `Add / Remove Agent`
  Adds or removes Agent CLIs in the session. Multiple instances of the same Agent can also be added.

* `reload`
  Hard-reloads the chat server. If the source code has changed, the running server is replaced with the new implementation.

# Setup

The following is the minimal entry point for starting Agent Window after cloning the repository. The current implementation targets macOS. Refer to the implementation in the repository for environment-specific details and the latest behavior.

## Requirements

Install the following in advance.

* `python3`
* `tmux`
* `cargo`
* `tauri-cli`
* Xcode Command Line Tools

Install whichever Agent CLIs you intend to use and authenticate each one through its normal process. You do not need to install every supported CLI.

## Tauri App + HTTP

Run the following from the repository root.

```bash
./tauri_app/tauri_start
```

This builds and launches the Tauri App. The Hub is started by the Tauri App and uses port `8788` by default. After launch, start a session with `New Session` in the Hub. To rebuild only the Tauri App, use:

```bash
./tauri_app/tauri-build
```

## PWA / HTTPS

The PWA provides access to Agent Window from a mobile device on the same LAN. First, start the Tauri App and Hub in HTTP mode. While they are running, execute:

```bash
./setup/pwa/enable
```

This script checks the running Hub and prepares mkcert and a local certificate.

After the PWA is enabled, `~/.agent-window/state/pwa/enabled` is detected on subsequent launches and Agent Window starts in HTTPS mode.

```bash
./tauri_app/tauri_start
```

Send mkcert's `rootCA.pem` to the device that will connect to Agent Window, install the certificate profile, and enable trust for it.

Then open either of the following in Safari:

```text
https://<Mac LAN IP>:8788/
https://<Mac name>.local:8788/
```

Add it to the Home Screen to use it as a PWA.

<p align="center">
  <img src="media/agent-window-mobile-1.png" width="24%" alt="Mobile UI 1">
  <img src="media/agent-window-mobile-2.png" width="24%" alt="Mobile UI 2">
  <img src="media/agent-window-mobile-3.png" width="24%" alt="Mobile UI 3">
  <img src="media/agent-window-mobile-4.png" width="24%" alt="Mobile UI 4">
</p>

# License

[0BSD](LICENSE). Do whatever you want with it.
