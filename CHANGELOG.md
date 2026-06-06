# @rosbel/crawl-n-snap

## 1.2.0

### Minor Changes

- 4289f76: Add capture options and faster, more reliable navigation:

  - New `--format <png|jpeg>` / `--quality <1-100>` for smaller screenshots.
  - New `--selector <css>` (single-element capture) and `--clip <x,y,w,h>` (region capture).
  - New `--wait-for-selector <css>` and `--disable-animations` for deterministic shots.
  - New `--nav-timeout <ms>` to configure the hard navigation cap (was hardcoded to 30s).
  - `--wait-until` now defaults to `load` (faster and more predictable than `networkidle`).
  - The viewport is set before navigation so responsive layouts render at the target width.
  - Redundant per-page navigation is removed in the default (non-crawl) path.

- b7cc09f: Add crawl controls and scripting-friendly output:

  - `--depth <n>` — bound how far a crawl follows links (in hops from the seed URL).
  - `--dry-run` — print the resolved run plan (target, output base, resolutions,
    crawl settings) and exit without launching a browser.
  - `--json` — emit the run manifest as the only thing on stdout (human logs are
    routed to stderr), so `crawl-n-snap … --json | jq` works.
  - `--no-color` — use plain ASCII status markers (`[OK]`/`[FAIL]`) instead of
    unicode, for pipes and CI logs.

- 908c669: Add device emulation and authentication, all wired through the browser context:

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

### Patch Changes

- 836663a: Harden the local dev API server (`src/dev-server.ts`):

  - Bind to `127.0.0.1` only (never the LAN), and only listen when run directly.
  - Constrain `/api/file`, `/api/open`, and the manifest read to the serve root
    using a `path.relative` containment check (the old `startsWith` check let a
    sibling directory like `<root>-secret` through), and restrict `/api/file` to
    image file types.
  - Drop wildcard CORS and reject cross-site state-changing requests
    (`Sec-Fetch-Site`/Origin check).
  - Cap request body size (413), cap concurrent runs (429), restrict run targets
    to http(s), and evict old finished runs to bound memory.

- 4289f76: Correctness fixes:

  - Fix the concurrency limiter: `--concurrency` is now actually bounded, and the
    results array is complete and in input order, so the console summary and
    `run.json` manifest no longer under-report captured resolutions.
  - Honor documented CLI/config precedence (explicit flag > config file > default)
    and make previously-dead config keys (`fullPage`, `headless`, `continueOnError`)
    take effect.
  - Device presets no longer leak the default 1920x1080 (`--mobile` alone now
    captures only 390x844). A custom `-r` replaces the default instead of adding to it.
  - Report the real retry count instead of always claiming the maximum.
  - Fail fast on an invalid target URL.
