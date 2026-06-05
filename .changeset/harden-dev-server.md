---
'@rosbel/crawl-n-snap': patch
---

Harden the local dev API server (`src/dev-server.ts`):

- Bind to `127.0.0.1` only (never the LAN), and only listen when run directly.
- Constrain `/api/file`, `/api/open`, and the manifest read to the serve root
  using a `path.relative` containment check (the old `startsWith` check let a
  sibling directory like `<root>-secret` through), and restrict `/api/file` to
  image file types.
- Drop wildcard CORS and reject cross-site state-changing requests
  (`Sec-Fetch-Site`/Origin check).
- Cap request body size (413), cap concurrent runs (429), restrict run targets
  to http(s), and evict old finished runs to bound memory.
