---
'@rosbel/crawl-n-snap': minor
---

Add device emulation and authentication, all wired through the browser context:

- `--device <name>` — emulate a Playwright device (e.g. "iPhone 13"); sets the
  viewport, DPR, touch, and User-Agent, and captures a single shot (overrides `-r`).
- `--color-scheme <light|dark|no-preference>` — emulate `prefers-color-scheme`.
- `--scale <n>` — device scale factor / DPR (e.g. `2` for retina).
- `--user-agent <string>` — override the User-Agent.
- `--header <name:value>` (repeatable), `--basic-auth <user:pass>`, and
  `--storage-state <file>` — screenshot pages behind tokens, HTTP Basic auth, or a
  saved login session.

Secret values (auth, headers, storage state) are never printed to the console or
written to `run.json` — only a boolean/count is recorded.
