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

## Principle

For the design philosophy behind Agent Window, see [DESIGN](DESIGN.md).

1. The unit is a Timeline, stored as a JSONL log.
2. An Agent Process is a regular CLI.
3. Agents and the workspace can be swapped mid-timeline.

## More About Agent Window

<details>
<summary>Hub</summary>

<p align="center">
  <img src="media/agent-window-hub-menu.png" width="100%" alt="Hub menu">
</p>

| Action | Description |
|---|---|
| New Timeline | `⌘N` |
| Switch active timeline | `⌘1`–`⌘9` |
| Open Hub in browser | `⇧⌥⌘O` |
| Restart server | `⇧⌘R`<br>Re-reads changed source |
| Copy workspace path | right-click menu |
| Show timeline stats | hover |

</details>

<details>
<summary>Composer</summary>

https://github.com/user-attachments/assets/5ce44e5a-de19-46cb-9861-11caac880c08

*The prompt box appears only when needed. It takes no space away from the timeline.*

| Action | Description |
|---|---|
| Open the input field | `Enter` / wheel click<br>The `O` button also opens it |
| Close the input field | `Esc` |
| Move the input field to bottom / center | `⌃⌘↓` / `⌃⌘↑`<br>While open |
| Switch send target | `⌃1`–`⌃9`<br>With none, it's only kept in the log |
| Search files in the workspace | `@`<br>Files not excluded by `.gitignore` |
| Attach files | `+` button / drag & drop / paste<br>Saved to `<workspace>/.agent-window/uploads/`; the path is passed to the Agent as text |

</details>

<details>
<summary>Commands</summary>

| Command | Description |
|---|---|
| `/jump YYYY-MM[-DD [HH[:MM[:SS]]]]` | Jumps to the first message in the specified month / day / time |
| `/restart` | Restarts the Agent's pane |
| `/idle` | Clears the Agent's running indicator |
| `/log` | Inserts the log's path into the message |
| `/skill` | Inserts the `agent-send` SKILL reference into the message |
| `/openpane` | Opens the Agent's pane (desktop)<br>Opens the terminal pane if none is selected |
| `/nativelog` | Reveals the Agent's native log in Finder (desktop) |
| `/terminal <text>` | Sends text to the terminal pane (mobile) |

</details>

<details>
<summary>timeline menu (<code>⌘.</code>)</summary>

<p align="center">
  <img src="media/agent-window-timeline-menu.png" width="100%" alt="Timeline menu">
</p>

| Action | Description |
|---|---|
| Add / remove Agent |  |
| Open Terminal | `⌥⌘T` |
| Open workspace in Finder | `⌥⌘R` |
| Open tmux terminal pane | `⌘T`<br>On mobile, operable from `Pane Trace` |
| Open log in Finder | `⌥⌘L` |
| Open timeline in browser | `⌥⌘O` |
| Search the full timeline | `⌘F` / Search<br>Hold `⇧` to jump 10 matches at a time |
| Export timeline as HTML / JSONL |  |

</details>

<details>
<summary>timeline</summary>

| Action | Description |
|---|---|
| Jump to top / bottom | `⌘↑` / `⌘↓` |
| Previous / next message | `⌥↑` / `⌥↓` |
| Previous / next message from the selected targets | `⌃⌥↑` / `⌃⌥↓`<br>`user` when none is selected |
| Copy | right-click / hover |
| Copy Log Entry | right-click<br>AW log JSON row / on mobile, long-press Copy |
| Copy Native Log Entry | right-click<br>Native log JSON row |
| Copy URL | right-click an external link |

</details>

<details>
<summary>CLI</summary>

https://github.com/user-attachments/assets/006bfe63-5e14-4abe-9039-e7e86b1a5851

*Open the CLI itself whenever needed.*

</details>

<details>
<summary>Timeline state actions</summary>

| Action | Description |
|---|---|
| Rename | Changes the timeline’s name |
| Archive | Ends the tmux session<br>The log stays |
| Revive | Restarts the tmux session with the saved workspace and Agents<br>Resumes the CLIs |
| Delete | Permanently deletes the timeline’s saved data<br>Archived only |
| Change Workspace | Changes the workspace<br>Archived only |
| Reset Agents | Clears the saved Agent set<br>Archived only |

</details>

<details>
<summary>git / workspace</summary>

https://github.com/user-attachments/assets/d878b522-99fb-4ba6-9326-29d73bace9ea

| **file** |  |
|---|---|
| Open file | `⌘O` |
| Quick Look | `⌘Y` / `⌥` + click |
| Reveal in Finder | `⌥⌘R` |
| Copy file | `⌘C` |
| Copy absolute path | `⌥⌘C` |
| Copy relative path | `⇧⌥⌘C` |

| **git** |  |
|---|---|
| Copy commit hash |  |
| Copy commit message |  |
| Show commit info | hover |
| Add / remove repository | Right-click folder<br>Desktop Workspace |
| Switch repository / worktree | Timeline menu; branch button on mobile |
| Follow changes | Across repositories and worktrees; ON by default |
| Pin changes | `⇧⌘P` / pin button |

</details>

<details>
<summary>sidebar</summary>

<p align="center">
  <img src="media/agent-window-hero-3.png" width="100%" alt="Workspace">
</p>

*In Fit Window mode, git and workspace live in a window independent of the timeline, at any position and size you choose.*

</details>

<details>
<summary>Resize window</summary>

https://github.com/user-attachments/assets/7d155603-6263-4f5e-971d-df41952b0b29

*Scaling preserves the proportions of the entire window. Adjust its size and position to keep the application out of your way.*

| Action | Description |
|---|---|
| Default / compact / mini size | `⌥⌘0` / `⌥⌘9` / `⌥⌘8` |
| Toggle Hub / side bar | `⌘B` / `⌘E`<br>Add `⌥` to grow the window outward |
| Swap the side bar to the other side | `⇧⌘E` |
| Swap Git and Workspace vertically | `⇧⌥⌘E` |
| Move to screen edge | `⌥⌘↑` `←` `→` `↓`<br>`↓` centers |
| Keep above other windows | `⌃⌘T` |

</details>

<details>
<summary>Fit Window</summary>

https://github.com/user-attachments/assets/d9f3cbc2-39c5-4b28-8be9-0d98c8328e1f

*`⌥⌘H` keeps the window's height matched to the latest message. `⌥⌘[` / `⌥⌘]` decrease / increase the number of messages shown. `⌥⌘M` collapses the window to its minimum; a new message restores it.*

</details>

<details>
<summary>UI・UX</summary>

| Action | Description |
|---|---|
| theme | System / light / dark |
| text size | `⌘0` / `⌘+` / `⌘-`<br>Desktop only. Resizes the window to match |
| hand | Mobile only. Optimizes for the right / left hand |
| sound | Mobile only. Just plays a sound in the page when a message arrives; not a native notification. OFF by default |

</details>

<details>
<summary>customize</summary>

| Item | Configuration |
|---|---|
| Main Font & Code Font | symlink CSS (`--font-main` / `--font-code`・`@font-face`) -> `~/.agent-window/fonts.css`; font files -> `~/.agent-window/fonts/` |
| File Icon | symlink VS Code theme json -> `~/.agent-window/file-icon-theme.json` |
| Syntax highlight | symlink highlight.js CSS -> `~/.agent-window/syntax-light(dark).css` |
| Keymacro for Pane Trace | add to `tmux/key_macro.py/PANE_TEXT_MACROS` |

</details>

<details>
<summary>A2A</summary>

An Agent can send to another Agent with `agent-send`. It's typed into the target's pane with a prefix like `[From: Claude]`.

```bash
printf '%s' '<message>' | agent-send <target>
```

To use it, add `tmux/agent_send/agent-send` to PATH and place `tmux/agent_send/SKILL.md` yourself.

<p align="center">
  <img src="media/agent-window-agent-send.png" width="100%" alt="Conversation between Claude, Codex and Grok">
</p>

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
  - **Build**: 1s from `./macos/build`
  - **Size** : < 200 KB
- **System**:
  - **Network**: CDN (`marked`・`DOMPurify`・`katex`・`highlight.js`)
  - **Port**: value of `server/port` (default `8788`)
  - **Files**: `~/.agent-window/`(log)・`{workspace}/.agent-window/`(symlink・uploaded file)
