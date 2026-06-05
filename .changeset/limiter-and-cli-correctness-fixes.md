---
'@rosbel/crawl-n-snap': patch
---

Correctness fixes:

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
