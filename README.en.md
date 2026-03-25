# Multiagent (local)

Run multiple AI agents in **tmux** and drive them from the **Hub** and **chat UI**.

**→ 日本語:** [README.md](README.md)

This README is for people who **only use the Hub and chat in a browser**. Concrete terminal commands and setup steps are expected to live elsewhere (e.g. [OVERVIEW.md](OVERVIEW.md)) for operators.

---

## First steps (must-do)

After starting a new session, go through this flow once—it makes day-to-day use much smoother.

1. **Open the Hub**  
   Use the URL shared by your admin. This is the home view with sessions and menus.

2. **New Session**  
   Create a new session from the Hub (workspace, agent counts, etc.—follow the on-screen form).

3. **Chat UI opens**  
   When creation finishes, you land in the **chat** for that session. This is where you talk to agents and read their replies.

4. **Hamburger menu → Terminal**  
   Open the **hamburger (three lines)** in the chat header and choose **Terminal**. You can inspect each agent’s **tmux pane** output directly in the browser (raw activity log).  
   On narrow screens, the same entry opens a pane viewer inside the menu panel.

5. **Plus → Agent → Brief**  
   Open the **+** menu near the composer, then **Agent → Brief**. This sends a **briefing about the multiagent environment** to the agent panes so later collaboration works more reliably.

---

## What you can do in the Hub (overview)

| Area | What it’s for |
|------|----------------|
| **Home** | Active / archived sessions and a quick stats view (mobile is list-oriented). |
| **New Session** | Create a workspace and jump into chat. |
| **Resume** | Re-open an existing session. |
| **Statistics** | Cross-session aggregates (messages, thinking time, etc.). |
| **Settings** | Theme, fonts, and other UI / behavior options. |
| **Top hamburger** | On the Hub: New Session, Statistics, Settings, **Reload**. On **chat**: **Reload**, **Terminal**, transcript **Export**, **Add Agent** / **Remove Agent**, and related items. |
| **Logo** | Return toward the Hub home (may also close a chat overlay depending on layout). |

---

## What you can do in chat (overview)

| Area | What it’s for |
|------|----------------|
| **Messages** | Send instructions to agents. **Reply** ties follow-ups to a specific message. |
| **Targets** | Choose which agent(s) receive the next send (multi-select). |
| **Copy** | Copy message body to the clipboard. |
| **Markdown** | Headings, code blocks, tables, and common Markdown features. |
| **Math** | Inline `$...$` and display `$$...$$` via **KaTeX**. |
| **Mermaid** | Diagrams in fenced `mermaid` code blocks. |
| **Files** | Paths in messages can render as **file cards** with preview / editor flows. |
| **Filter** | Narrow the timeline by agent. |
| **Agent status** | Shows states such as thinking (on mobile, tapping a row may open detail). |
| **+ menu** | **Import** (files), **Raw**, **Agent** (Brief / Load / Memory), **Command** (Restart / Resume / Ctrl+C / Enter), and **Esc** (interrupt). |
| **Composer** | Bottom input area. A **floating O-shaped control** may appear to toggle the composer when you are scrolled near the bottom of a long thread. |
| **Other header icons** | Panels for attached files, branch/commit context, etc. |

---

## Notification sounds

The repo starts **silent**. To use sounds, add **OGG files under `sounds/`**. See [sounds/README.md](sounds/README.md) for filenames and meanings.

---

## Operators: first-time setup entry point

Cloning, dependencies, and starting the Hub are **terminal tasks**. Put the detailed command list in docs like [OVERVIEW.md](OVERVIEW.md).  
On macOS, **Homebrew should already be installed**; `quickstart` may interactively check **tmux**, **Python 3**, and **agent CLIs**.

---

## Phones and HTTPS (certificates)

If the Hub serves **HTTPS** via a **local CA** (e.g. mkcert), **phones may not trust that CA** and will warn. Export the root CA from the Mac and trust it on the device.  
Plain **HTTP** on the LAN is often usable without that step.

---

## Access from the internet (public)

Exposing the Hub outside your LAN requires your own **tunnel, reverse proxy, and DNS**. Example notes (adapt to your setup):

- [docs/cloudflare-quick-tunnel.md](docs/cloudflare-quick-tunnel.md)
- [docs/cloudflare-access.md](docs/cloudflare-access.md)
- [docs/cloudflare-daemon.md](docs/cloudflare-daemon.md)

---

## More links

- Broader architecture / commands: [OVERVIEW.md](OVERVIEW.md)
- Agent definitions in code: `lib/agent_index/agent_registry.py`

---

## License

(Add a LICENSE file when publishing and name it here.)
