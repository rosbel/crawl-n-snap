---
'@rosbel/crawl-n-snap': minor
---

Add capture options and faster, more reliable navigation:

- New `--format <png|jpeg>` / `--quality <1-100>` for smaller screenshots.
- New `--selector <css>` (single-element capture) and `--clip <x,y,w,h>` (region capture).
- New `--wait-for-selector <css>` and `--disable-animations` for deterministic shots.
- New `--nav-timeout <ms>` to configure the hard navigation cap (was hardcoded to 30s).
- `--wait-until` now defaults to `load` (faster and more predictable than `networkidle`).
- The viewport is set before navigation so responsive layouts render at the target width.
- Redundant per-page navigation is removed in the default (non-crawl) path.
