<div align="center">

# Agent Window

A UNIX-philosophy Agent application for macOS.

https://okadaharuto.com/agent-window/

</div>

<p align="center">
  <img src="media/agent-window-hero-1.png" width="100%" alt="Agent Window, light theme">
  <img src="media/agent-window-hero-2.png" width="100%" alt="Agent Window, dark theme">
</p>

<div align="center">

Supported CLI: Claude・Codex・Antigravity・Cursor・Grok

</div>

---

## Principle of Agent Window

1. The unit is a Timeline, stored as a JSONL log.
2. An Agent Process is a regular CLI.
3. Agents and the workspace can be swapped mid-timeline.

## More About Agent Window

<details>
<summary>Fit Window</summary>

The application uses only the space it needs.

- Enable `Fit Window` with `⌥⌘H` to resize the window automatically around the latest messages.
- Adjust the number of visible messages with `⌥⌘[` and `⌥⌘]`.
- Use `⌥⌘M` to collapse the window to its minimum size until the next new message arrives.

</details>

<details>
<summary>Window Resize / Move</summary>

Resizing preserves the proportions of the entire window. Quickly adjust its size and position to keep it out of your way.

</details>

<details>
<summary>Hub Menu</summary>

Almost every Agent Window-specific shortcut is also available from the Hub Menu.\
Switch the color theme (system / light / dark) here.

</details>

<details>
<summary>Timeline States Actions</summary>

Rename, archive, or revive a timeline. Archiving preserves its log; reviving resumes it with the saved workspace and agent configuration. While archived, you can also change its workspace, reset its agent configuration, or delete the timeline.

</details>

<details>
<summary>Prompt Box</summary>

The prompt box appears only when needed, leaving the timeline unobstructed. Your text is entered directly into the agent CLI's pane. Switch recipients with `⌃1`–`⌃9`.

</details>

<details>
<summary>Commands</summary>

Type `/` in the prompt box to see AW's own commands. Run the CLI's commands from the pane itself.

</details>

<details>
<summary>Substance is CLI</summary>

Open the CLI itself with `/openpane`, `timeline menu → tmux pane`, or by tapping the Running indicator.

</details>

<details>
<summary>Agent to Agent</summary>

Use `tmux/agent_send/SKILL.md` for agent-to-agent communication. There is no protocol: `tmux send-keys` sends text to the recipient's pane with a prefix such as `[From: Claude]`. To use it, add `tmux/agent_send/agent-send` to your PATH.

</details>

<details>
<summary>File Attachment</summary>

Attach files with `+`, drag and drop, or paste. Files are saved in `<workspace>/.agent-window/uploads/`, and their paths are appended to your message as plain text.

</details>

<details>
<summary>File Search</summary>

Type `@` in the prompt box to search files in the workspace. Search is limited to files under Git management. Adding a child repository to the monitored repositories also includes its files.

</details>

<details>
<summary>File Open</summary>

The desktop app has no custom file viewer. Files normally open in their default applications, and diffs use the diff tool configured in Git. For a quick preview, use macOS Quick Look with `⌥ + click` or `⌘Y`.

</details>

<details>
<summary>Sidebar</summary>

The sidebar shows Git and workspace state through event-driven updates using `FSEvents`. Adjust its width, swap Git and Workspace vertically with `⇧⌥⌘E`, or move the sidebar to the opposite side with `⇧⌘E`.

</details>

<details>
<summary>Independent Sidebar</summary>

In `Fit Window` mode, the sidebar becomes an independent window. Keep it at any position and size you choose.

</details>

<details>
<summary>Add Repository</summary>

Add or remove a child directory as a monitored repository root. Added repositories appear under `timeline menu → Repository`, where you can switch the sidebar's view. The worktree list belongs to the selected repository.

</details>

<details>
<summary>Worktrees</summary>

Use `timeline menu → Worktree` to choose which linked worktree the sidebar displays.

</details>

<details>
<summary>Follow Changes</summary>

Enable Follow Changes to make the sidebar follow the most recently updated repository and worktree. Choosing a view explicitly turns it off.

</details>

<details>
<summary>Pin Changes</summary>

Keep a compact view of the current changes at the top of the timeline without opening the sidebar. Hover to expand the list.

</details>

<details>
<summary>Timeline Search</summary>

Search the entire timeline with `⌘F`. Hold `⇧` to move through matches ten at a time.

</details>

<details>
<summary>What AW records</summary>

Agent messages record the path and offset of their source native log. User messages record the sending client: mobile or desktop.

Right-click a message to copy it at different levels of detail; on mobile, long-press the Copy button. Open the canonical JSONL log with `⌥⌘L`.

</details>

<details>
<summary>Export</summary>

Export a selected range of the timeline log as JSONL or HTML. HTML captures the rendered WebView, preserving its appearance.

</details>

<details>
<summary>Open in browser</summary>

Use Agent Window's basic features entirely in a browser (`⇧⌥⌘O`). You can also open a specific timeline directly in a browser (`⌥⌘O`).

</details>

<details>
<summary>HUD</summary>

From errors to feedback on everyday actions, temporary notifications appear in the HUD at the top of the timeline and transition smoothly. Some notifications remain visible.

</details>

## Control from Everywhere

Connect via Tailscale & use as PWA

<p align="center">
  <img src="media/agent-window-mobile-light-1.png" width="48%" alt="Mobile UI, light 1">
  <img src="media/agent-window-mobile-dark-1.png" width="48%" alt="Mobile UI, dark 1">
</p>

<details>
<summary>More screenshots</summary>

<p align="center">
  <img src="media/agent-window-mobile-light-2.png" width="48%" alt="Mobile UI, light 2">
  <img src="media/agent-window-mobile-dark-2.png" width="48%" alt="Mobile UI, dark 2">
  <img src="media/agent-window-mobile-light-3.png" width="48%" alt="Mobile UI, light 3">
  <img src="media/agent-window-mobile-dark-3.png" width="48%" alt="Mobile UI, dark 3">
  <img src="media/agent-window-mobile-light-4.png" width="48%" alt="Mobile UI, light 4">
  <img src="media/agent-window-mobile-dark-4.png" width="48%" alt="Mobile UI, dark 4">
  <img src="media/agent-window-mobile-light-5.png" width="48%" alt="Mobile UI, light 5">
  <img src="media/agent-window-mobile-dark-5.png" width="48%" alt="Mobile UI, dark 5">
</p>

</details>

## Footprint

- **Source**:
  - **Size**: 1.6 MB・40,000 LOC
  - **Stack**: HTML・CSS・vanilla JavaScript・Python stdlib
- **App**:
  - **Spec**: native launcher of local repo
  - **Requirements**: python3・tmux・Xcode CLI
  - **Build**: 1s from ./macos/build
  - **Size** : < 200 KB
- **System**:
  - **Network**: CDN (marked・DOMPurify・katex・highlight.js)
  - **Port**: value of server/port (default 8788)
  - **Files**: ~/.agent-window/(log)・{workspace}/.agent-window/(symlink・uploaded file)
