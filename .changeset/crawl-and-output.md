---
'@rosbel/crawl-n-snap': minor
---

Add crawl controls and scripting-friendly output:

- `--depth <n>` — bound how far a crawl follows links (in hops from the seed URL).
- `--dry-run` — print the resolved run plan (target, output base, resolutions,
  crawl settings) and exit without launching a browser.
- `--json` — emit the run manifest as the only thing on stdout (human logs are
  routed to stderr), so `crawl-n-snap … --json | jq` works.
- `--no-color` — use plain ASCII status markers (`[OK]`/`[FAIL]`) instead of
  unicode, for pipes and CI logs.
