<div align="center">

# Agent Window

A UNIX-philosophy Agent application for macOS.

[Design philosophy](DESIGN.md) · [日本語](README.jp.md)

</div>

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window hero 1">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window hero 2">
</p>

---

## Principles

1. The unit is one log. Its file: `~/.agent-window/log/{label}/.log.jsonl`.
2. An Agent is an ordinary CLI, running inside tmux. Any number of them.
3. Both workspace and CLI can be swapped mid-timeline. The same log continues.
4. Sending is `tmux send-keys`. Text from the input field goes into the Agent's pane.
5. Receiving is watching each CLI's native log. Tool calls show on screen only while running, and aren't kept in the log.

<p align="center">
  <img src="media/agent-window-running.gif" width="392" alt="Claude's running tool calls in Agent Window">
</p>

## Setup

Requires `python3`, `tmux`, Xcode Command Line Tools. Install and authenticate the Agent CLIs you'll use yourself.

```bash
./macos/build
```

Builds the app, saves it to `/Applications/Agent Window.app`, and launches it.

## timeline

`New Timeline` picks a workspace and opens a room there.

<details>
<summary>Actions</summary>

| Action | Effect | Note |
|---|---|---|
| Archive | Closes the room and its tmux session | Log stays |
| Revive | Reopens the room from the saved workspace and Agent set | Resume the conversation with the CLI's own `/resume` |
| Delete | Permanently deletes the timeline's saved data | Archived only |
| Rename | Changes the timeline's label | |
| Change Workspace | Changes the workspace | Archived only |
| Reset Agents | Clears the saved Agent set | The one used by Revive |

</details>

## Agent

`Add / Remove Agent` adds and removes Agents. Adding the same CLI more than once gets an instance name like `Claude-2`.

The CLI itself opens from `tmux window`.

## Send

The `O` button opens the input field.

`@` searches files in the workspace. Attached files are saved to `<workspace>/.agent-window/uploads/`, and their path is passed to the Agent as text.

<details>
<summary>Commands in the input field</summary>

| Command | Target | Effect | Note |
| --- | --- | --- | --- |
| `/restart` |  | Restarts the Agent's pane | |
| `/idle` |  | Clears the Agent's running indicator | |
| `/log` |  | Inserts the log's path into the message | |
| `/open-pane` | desktop | Opens the Agent's pane | Opens the terminal pane if none is selected |
| `/nativelog` | desktop | Reveals the Agent's native log in Finder | |
| `/terminal <text>` | mobile | Sends text to the terminal pane | |

</details>

An Agent can send to another Agent with `agent-send`. It's typed into the target's pane with a prefix like `[From: Claude]`.

```bash
printf '%s' '<message>' | agent-send <target>
```

To use it, add `tmux/agent_send/agent-send` to PATH and place `tmux/agent_send/SKILL.md` yourself.

## workspace

The right pane shows git status and a file tree. Diffs open in `git difftool`. Files open in the default app; on mobile, a built-in viewer.

File icons: put a symlink to a file icon theme's definition JSON (VS Code and similar) at `~/.agent-window/file-icon-theme.json`.

## Fit Height

`⌥⌘H` keeps the window's height matched to the latest message. `⌥⌘M` collapses the window to its minimum; a new message restores it.

<p align="center">
  <img src="media/agent-window-fit.gif" width="100%" alt="Fit Height demo">
</p>

## Shortcuts

<details>
<summary>Hub</summary>

| Action | Key | Note |
|---|---|---|
| New Timeline | `⌘N` | |
| Switch active timeline | `⌘1`–`⌘9` | |
| Open Hub in browser | `⇧⌥⌘O` | |

</details>

<details>
<summary>Control</summary>

| Action | Key | Note |
|---|---|---|
| Open the input field | `Enter` / wheel click | |
| Close the input field | `Esc` | |
| Switch send target | `Ctrl+1`–`Ctrl+9` | |
| Restart chat server / Hub server | `⌘R` / `⇧⌘R` | Re-reads changed source |
| Pin Git summary | `⇧⌘P` | |

</details>

<details>
<summary>chat menu (<code>⌘.</code>)</summary>

| Action | Key | Note |
|---|---|---|
| Add / remove Agent | | |
| Open Terminal | `⌘T` | |
| Open workspace in Finder | `⌥⌘R` | |
| Open tmux window | `⌥⌘T` | |
| Open log in Finder | `⌥⌘L` | |
| Open chat in browser | `⌥⌘O` | |

</details>

<details>
<summary>timeline</summary>

| Action | Key | Note |
|---|---|---|
| Jump to top / bottom | `⌘↑` / `⌘↓` | |
| Previous / next message | `⌥↑` / `⌥↓` | |

</details>

<details>
<summary>git / repo</summary>

| Action | Key | Note |
|---|---|---|
| Open file | `⌘O` | |
| Quick Look | `⌘Y` / `⌥` + click | |
| Reveal in Finder | `⌥⌘R` | |
| Copy file | `⌘C` | |
| Copy absolute path | `⌥⌘C` | |
| Copy relative path | `⇧⌥⌘C` | |
| Copy commit hash |  | |
| Copy commit message |  | |
| Show commit info | hover | |

</details>

<details>
<summary>window</summary>

| Action | Key | Note |
|---|---|---|
| Default / compact / mini size | `⌥⌘0` / `⌥⌘9` / `⌥⌘8` | |
| Toggle Hub / right pane | `⌘B` / `⌘E` | Add `⌥` to grow the window outward |
| Move to screen edge | `⌥⌘↑` `←` `→` `↓` | `↓` centers |
| Keep above other windows | `⌥⌘P` | |
| Fit Height | `⌥⌘H` | |
| Collapse to minimum | `⌥⌘M` | Restores on a new message. Fit Height only |

</details>

<details>
<summary>Appearance menu (<code>⌘,</code>)</summary>

| Action | Key | Note |
|---|---|---|
| theme | | System / light / dark |
| text size | `⌘0` / `⌘+` / `⌘-` | Resizes the window to match |

</details>

## Mobile

Connect to the Hub via Tailscale or similar, and use it as a PWA. Swipe left to open the menu that leads to git and the file tree.

`Pane Trace` shows the CLI itself. A minimal set of key macros is provided as buttons. Register frequently used CLI commands in `PANE_TEXT_MACROS` in `tmux/shortcut_command/catalog.py`.

<p align="center">
  <img src="media/agent-window-mobile-light-1.png" width="48%" alt="Mobile UI, light 1">
  <img src="media/agent-window-mobile-dark-1.png" width="48%" alt="Mobile UI, dark 1">
  <img src="media/agent-window-mobile-light-2.png" width="48%" alt="Mobile UI, light 2">
  <img src="media/agent-window-mobile-dark-2.png" width="48%" alt="Mobile UI, dark 2">
  <img src="media/agent-window-mobile-light-3.png" width="48%" alt="Mobile UI, light 3">
  <img src="media/agent-window-mobile-dark-3.png" width="48%" alt="Mobile UI, dark 3">
  <img src="media/agent-window-mobile-light-4.png" width="48%" alt="Mobile UI, light 4">
  <img src="media/agent-window-mobile-dark-4.png" width="48%" alt="Mobile UI, dark 4">
</p>

## Supported CLIs

Claude, Codex, Antigravity, Cursor, Grok.

## Stack

The stack is HTML/CSS/vanilla JavaScript, the Python standard library, and one Objective-C file for the macOS window. There is no Node runtime, npm build, or DB; the following are used directly:

- **browser primitive** — DOM, `fetch` / `EventSource`
- **native OS API** — FSEvents / kqueue, AppKit / Objective-C
- **canonical CLI** — git, tmux, Agent CLI

## Footprint

No telemetry. The only network dependencies besides the Agent CLIs are `marked` and `katex` from `cdn.jsdelivr.net`. Vendor them yourself if you want it fully local.

The Hub occupies the port in the `server/hub/port` file (default `8788`); edit the file to change it. Each room occupies a fixed port derived from its workspace's path.

Agent Window itself writes filesystem data only under `~/.agent-window/` and `<workspace>/.agent-window/`.

## License

[0BSD](LICENSE). The file icons in the screenshots are from Material Icon Theme.
