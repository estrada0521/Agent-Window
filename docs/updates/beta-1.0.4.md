# multiagent-chat beta 1.0.4

Japanese version: [beta-1.0.4.ja.md](beta-1.0.4.ja.md)

Released: 2026-04-02

This note covers changes after commit `2590f14` on 2026-04-01, which prepared the beta 1.0.3 release.

## Highlights

### Daily Cron scheduling arrived in the Hub

- The Hub now includes a dedicated Cron page for scheduling one daily prompt against an existing session and agent.
- Each job keeps a name, target session, target agent, daily time, prompt body, enable / disable state, and recent status.
- `Run Now` is built into the same UI, so scheduled flows and manual checks use one operational surface instead of a separate tool.
- Cron dispatch still goes through the normal pane plus `agent-send` route, so results land back in the same chat timeline as ordinary work.
- Pending runs are tracked, one reminder can be sent if no result comes back, and silent jobs are eventually marked as timed out instead of being left ambiguous.

### File preview became closer to the chat renderer

- Markdown preview now follows the configured agent font instead of falling back to a separate preview-only type treatment.
- The preview surface can switch between dark and light themes from inside the modal, which is especially useful for longer documents and exported notes.
- Public and local routes were aligned so the same markdown preview styling and font behavior show up in both environments after reload.

### Standalone export became more faithful

- Static HTML export now preserves the live chat layout more reliably when the file is opened on its own, instead of collapsing into a partial shell in some viewers.
- Attachment-heavy exports remain much closer to the in-app reading experience on desktop and mobile.
- This makes export more practical as a handoff format, not just as a raw archive artifact.

### Hub polish continued across authoring flows

- The Hub top and related pages were simplified by removing the title-under-title explanatory copy, keeping the chrome lighter.
- New Session workspace picking was refined so direct path entry, recent paths, and folder browsing sit in one cleaner flow.
- The workspace browse control was restyled so `Browse` / `Close` no longer jumps or drifts when toggled.
- Branch-menu scrolling was repaired after a panel overflow regression, so long commit lists are scrollable again.
- Supporting docs also grew again, including new multiferroics trend notes that double as realistic preview / export samples.

## Other notable additions

- Export, file preview, and Hub compose surfaces all received follow-up refinement rather than being left as one-shot features.
- README and release-note coverage were expanded so Cron, export fidelity, and preview parity are easier to understand from outside the code.
