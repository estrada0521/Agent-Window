# Agent Window

Agent Window is a UNIX-philosophy **local interface for macOS** that watches, from outside, a workspace where multiple Agent CLIs are running.

Each Agent CLI launches normally inside a tmux pane. It never calls a model through an API or SDK. **It uses only the capabilities each CLI already has.**

[Design philosophy](DESIGN.md) · [日本語](README_jp.md)

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

---

# Setup

The current implementation targets macOS.

## Requirements

* `python3`
* `tmux`
* `cargo`
* `tauri-cli`
* Xcode Command Line Tools

`./setup/preflight` checks for missing dependencies and the commands needed to install them. The script never installs anything itself.

Install whichever Agent CLIs you plan to use individually, and authenticate each one the normal way.

## Launch

Run the following from the repository root.

```bash
./tauri_app/tauri_start
```

This builds and launches the Tauri App. The Hub is started by the Tauri App and uses port `8788` by default.

To rebuild only the Tauri App, use:

```bash
./tauri_app/tauri-build
```

# Use

## Start a session

Choose a workspace root from `New Session` in the Hub to set up a session.
The Hub manages the list of sessions; archiving and deleting are also done from here.

## Add an Agent

`Add / Remove Agent` in the top right adds or removes Agents from the session. Running more than one instance of the same CLI Agent produces instance names such as `Claude-2`.

* `Terminal` — opens a compact, pane-switching tmux terminal directly
* `Finder` — opens the session's workspace in Finder

The separate reload button beside it hard-reloads the GUI server. If the source code has changed, the running server is replaced with the new implementation.

## Send

The input field is normally minimized to leave more room for the chat, and expands with the `O` button at the bottom of the screen or by pressing the scroll wheel. Which Agent icons are selected determines who a message is sent to.

Text in the input field is entered directly, via `tmux send-keys`, into the pane running the selected Agent CLI. It is not converted into an Agent Window-specific message format, so **slash commands and other native CLI commands also pass through the same input field.** A failed send is detected as `send_error`, but success is not notified. Minimal controls that CLIs don't offer by default — restarting a pane, interrupting from mobile — are wired in by Agent Window.

Typing `@` searches files in the workspace. Files can also be attached with the plus button or by drag-and-drop. Attached files are saved to `<workspace>/.agent-window/uploads/`, and their path is passed to the Agent as ordinary text.

## Read

The GUI displays messages from the human and every Agent participating in the session as a single timeline. **It is not split into independent chat rooms per Agent or per worktree.** Switching CLIs, or running multiple Agents at once, does not split the conversation — everything that happens within the same session stays in the same flow.

Even when a CLI exits, restarts, is removed, or is added again, the timeline continues as long as the session stays the same.

It actually lives at the following location, symlinked into the workspace.

```text
~/.agent-window/session/{session_name}/.log.jsonl
```

Tool calls are streamed to the screen while running, for a sense of progress, but are not kept in this timeline.

Technically, each CLI's native log path is resolved from its PID tree and similar process information, and kqueue watches it directly. The mapping between process and log path is re-resolved whenever necessary — a CLI restart, an Agent being re-added, a GUI server reload. So the session's timeline continues even when the CLI process is replaced.

## Watch the workspace

Git and workspace state are watched with FSEvents and projected onto the right pane. File search uses a cache of file information obtained the same way.

Clicking a file opens it in the macOS default application. The desktop version of Agent Window does not reimplement a file viewer that already exists elsewhere. Mobile can't rely on that, so a bottom-sheet-style built-in viewer opens instead.

Clicking an uncommitted change opens it in git's configured diff viewer (`git difftool`).

## Connect Agents to each other

An Agent can send a message directly to another Agent in the session with `agent-send`. Place `SKILL.md` at the designated location if needed — it is the only SKILL Agent Window has committed to.

```bash
agent-send <target> <message>
```

Technically, `agent-send` is a thin wrapper around the same `tmux send-keys` a human uses. It only resolves the destination and attaches a prefix such as `[From: Claude]`. Success here means the same thing it does for the input field above: tmux accepted the keystrokes, not that the target Agent understood or acted on it.

## Give a name

Agent Window's one and only unnecessary feature.

```bash
agent-send name <target> <name>
```

An Agent can be given a name that works within the session. The name is used only as an `agent-send` address and in the `[From: ...]` prefix; existing instance names and log identities are unchanged.

## Use it from a phone

You can connect to the same screen from a mobile device on the same LAN.

First, start the Tauri App and Hub in HTTP mode. While they are running, run:

```bash
./setup/pwa/enable
```

This script checks the running Hub and prepares mkcert and a local certificate. **mkcert installs a local CA on the system.**

From then on, `~/.agent-window/state/pwa/enabled` is detected at launch and Agent Window starts in HTTPS mode.

```bash
./tauri_app/tauri_start
```

Send mkcert's `rootCA.pem` to the device that will connect, install the certificate profile, and enable trust for it. Then open either of the following in Safari:

```text
https://<Mac LAN IP>:8788/
https://<Mac name>.local:8788/
```

Add it to the Home Screen to use it as a PWA.

For reaching Hub from outside the LAN, see [`external-access/README.md`](external-access/README.md).

<p align="center">
  <img src="media/agent-window-mobile-1.png" width="24%" alt="Mobile UI 1">
  <img src="media/agent-window-mobile-2.png" width="24%" alt="Mobile UI 2">
  <img src="media/agent-window-mobile-3.png" width="24%" alt="Mobile UI 3">
  <img src="media/agent-window-mobile-4.png" width="24%" alt="Mobile UI 4">
</p>

## Supported CLIs

Claude, Codex, Antigravity, Cursor, Grok.

The receiving side needs to know where each CLI's native log lives and what format it's in, so there is per-CLI handling.
The sending side is the same for every CLI. It only enters text into a pane, so there is no CLI-specific implementation.

# License

[0BSD](LICENSE). Do whatever you want with it.
