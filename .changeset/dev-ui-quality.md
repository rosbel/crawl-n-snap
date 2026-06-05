---
---

Dev UI (React) quality fixes only — not part of the published npm package, so no
version bump:

- The UI no longer gets stuck on "running" when a run fails to start (errors are
  caught and surfaced).
- Number inputs are clamped so a cleared field never sends `NaN` to the server.
- Manifest actions (Copy / Reveal / Open / Download) target the run currently
  selected in the history, not just the most recent run.
- Auto-scroll scrolls the log pane instead of the whole page; the log buffer is
  capped and joined via memo; preview images load lazily; the run list is only
  polled while a run is active; EventSource errors are handled.
