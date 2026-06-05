import http from 'node:http';
import {spawn, ChildProcessWithoutNullStreams} from 'node:child_process';
import {parse} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

interface RunRecord {
  id: string;
  child: ChildProcessWithoutNullStreams | null;
  logs: string[];
  status: RunStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  manifestPath?: string;
  subscribers: Set<http.ServerResponse>;
  metrics: {
    pageCurrent: number;
    pageTotal: number;
    resCurrent: number;
    resTotal: number;
  };
  url: string;
  payload: any;
}

const runs = new Map<string, RunRecord>();

// --- Safety limits -------------------------------------------------------
// Files served/opened by the dev server are constrained to this root (the
// directory the server was started from), preventing path traversal and the
// opening of arbitrary files anywhere on the machine.
const SERVE_ROOT = process.cwd();
const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BODY_BYTES = 256 * 1024; // reject larger request bodies
const MAX_ACTIVE_RUNS = 8; // cap concurrent spawned CLI processes
const MAX_FINISHED_RUNS = 50; // evict oldest finished runs beyond this

// True if `target` resolves to `root` itself or a path inside it. Uses
// path.relative instead of a string prefix check so that a sibling directory
// like `<root>-secret` is correctly rejected for root `<root>`.
function isWithinRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

// State-changing requests must originate from the local dev UI, not an
// arbitrary cross-site page in the user's browser. Browsers send Sec-Fetch-Site
// (we allow same-origin/same-site/none); when absent we fall back to checking
// that no foreign Origin header is present.
function isLocalRequest(req: http.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') {
    return site === 'same-origin' || site === 'same-site' || site === 'none';
  }
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (curl, the Vite proxy)
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function json(res: http.ServerResponse, status: number, body: any) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(text);
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => reject(new Error('request error')));
  });
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function optionsToArgs(payload: any): string[] {
  const args: string[] = [];
  // Order roughly mirrors CLI
  const res: string[] = payload.resolutions || [];
  res.forEach((r) => args.push('-r', r));

  if (payload.desktop) args.push('--desktop');
  if (payload.mobile) args.push('--mobile');
  if (payload.output) args.push('-o', payload.output);
  if (payload.browser) args.push('-b', payload.browser);
  if (payload.crawl) args.push('-c');
  if (payload.maxPages != null) args.push('-p', String(payload.maxPages));
  if (payload.timeout != null) args.push('-t', String(payload.timeout));
  if (payload.navTimeout != null) args.push('--nav-timeout', String(payload.navTimeout));
  if (payload.concurrency != null) args.push('--concurrency', String(payload.concurrency));
  if (payload.retries != null) args.push('-R', String(payload.retries));
  (payload.excludePatterns || []).forEach((p: string) => args.push('-x', p));
  (payload.includePatterns || []).forEach((p: string) => args.push('-i', p));

  if (payload.continueOnError === false) args.push('--continue-on-error', 'false');
  if (payload.failFast) args.push('--fail-fast');
  if (payload.waitUntil) args.push('--wait-until', payload.waitUntil);
  if (payload.delay != null) args.push('--delay', String(payload.delay));
  if (payload.fullPage === false) args.push('--no-full-page');
  if (payload.headless === false) args.push('--no-headless');
  if (payload.format) args.push('--format', String(payload.format));
  if (payload.quality != null) args.push('--quality', String(payload.quality));
  if (payload.selector) args.push('--selector', String(payload.selector));
  if (payload.clip) args.push('--clip', String(payload.clip));
  if (payload.waitForSelector) args.push('--wait-for-selector', String(payload.waitForSelector));
  if (payload.disableAnimations) args.push('--disable-animations');
  if (payload.scale != null) args.push('--scale', String(payload.scale));
  if (payload.colorScheme) args.push('--color-scheme', String(payload.colorScheme));
  if (payload.userAgent) args.push('--user-agent', String(payload.userAgent));
  if (payload.device) args.push('--device', String(payload.device));
  (payload.headers || []).forEach((h: string) => args.push('--header', h));
  if (payload.basicAuth) args.push('--basic-auth', String(payload.basicAuth));
  if (payload.storageState) args.push('--storage-state', String(payload.storageState));
  if (payload.depth != null) args.push('--depth', String(payload.depth));
  return args;
}

function startRun(body: any): RunRecord {
  const id = newId();
  const url = String(body.url || '');
  const args = optionsToArgs(body);

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', url, ...args], {
    env: process.env,
    stdio: 'pipe',
  });

  const rec: RunRecord = {
    id,
    child,
    logs: [],
    status: 'running',
    startedAt: Date.now(),
    exitCode: undefined,
    subscribers: new Set(),
    metrics: {pageCurrent: 0, pageTotal: 0, resCurrent: 0, resTotal: 0},
    url,
    payload: body,
  };
  runs.set(id, rec);

  const append = (buf: Buffer) => {
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    rec.logs.push(...lines);
    // parse metrics
    for (const line of lines) {
      if (!line) continue;
      let m = line.match(/^\[(\d+)\/(\d+)\] Processing URL:/);
      if (m) {
        rec.metrics.pageCurrent = parseInt(m[1], 10);
        rec.metrics.pageTotal = parseInt(m[2], 10);
        rec.metrics.resCurrent = 0;
        rec.metrics.resTotal = 0;
        broadcast(rec, 'metrics', rec.metrics);
        continue;
      }
      m = line.match(/Processing (\d+) resolutions/);
      if (m) {
        rec.metrics.resTotal = parseInt(m[1], 10);
        rec.metrics.resCurrent = 0;
        broadcast(rec, 'metrics', rec.metrics);
        continue;
      }
      if (/^✓ .* screenshot saved:/.test(line) || /^✗ .* failed/.test(line)) {
        rec.metrics.resCurrent = Math.min(
          rec.metrics.resCurrent + 1,
          rec.metrics.resTotal || rec.metrics.resCurrent + 1
        );
        broadcast(rec, 'metrics', rec.metrics);
      }
    }
    // broadcast new logs
    const nonEmpty = lines.filter(Boolean);
    if (nonEmpty.length) {
      broadcast(rec, 'logs', {lines: nonEmpty, next: rec.logs.length});
    }
    // capture manifest path if logged
    const match = text.match(/Run manifest written: (.*)$/m);
    if (match) rec.manifestPath = match[1].trim();
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('exit', (code) => {
    rec.exitCode = code;
    rec.finishedAt = Date.now();
    rec.status = code === 0 ? 'completed' : 'failed';
    broadcast(rec, 'status', {
      status: rec.status,
      exitCode: rec.exitCode ?? null,
      manifestPath: rec.manifestPath || null,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt || null,
    });
    evictOldFinishedRuns();
  });

  return rec;
}

// Keep memory bounded: drop the oldest finished runs once we exceed the cap.
// Running runs are never evicted.
function evictOldFinishedRuns() {
  const finished = Array.from(runs.values())
    .filter((r) => r.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
  for (let i = 0; i < finished.length - MAX_FINISHED_RUNS; i++) {
    runs.delete(finished[i].id);
  }
}

function activeRunCount(): number {
  let n = 0;
  for (const r of runs.values()) if (r.status === 'running') n++;
  return n;
}

const server = http.createServer(async (req, res) => {
  // No wildcard CORS: the dev UI reaches this server through the Vite proxy
  // (same-origin), so cross-origin browser access is intentionally not allowed.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = parse(req.url || '', true);
  const pathname = url.pathname || '';

  // Reject state-changing requests that a malicious cross-site page might make.
  const isMutating = req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT';
  if (isMutating && !isLocalRequest(req)) {
    return json(res, 403, {error: 'cross-site request blocked'});
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {ok: true});
  }

  if (req.method === 'GET' && pathname === '/api/runs') {
    const list = Array.from(runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({
        id: r.id,
        url: r.url,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        exitCode: r.exitCode ?? null,
        manifestPath: r.manifestPath || null,
      }));
    return json(res, 200, list);
  }

  if (req.method === 'GET' && pathname.startsWith('/api/run/') && !pathname.endsWith('/manifest')) {
    const id = pathname.split('/').pop()!;
    const rec = runs.get(id);
    if (!rec) return json(res, 404, {error: 'not found'});
    return json(res, 200, {
      id: rec.id,
      url: rec.url,
      status: rec.status,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt ?? null,
      exitCode: rec.exitCode ?? null,
      manifestPath: rec.manifestPath || null,
      payload: rec.payload,
    });
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    let body: any;
    try {
      body = await parseBody(req);
    } catch {
      return json(res, 413, {error: 'request body too large'});
    }
    if (!body.url) return json(res, 400, {error: 'url required'});
    // Only spawn the CLI for real web targets.
    try {
      const scheme = new URL(String(body.url)).protocol;
      if (scheme !== 'http:' && scheme !== 'https:') {
        return json(res, 400, {error: 'url must be http(s)'});
      }
    } catch {
      return json(res, 400, {error: 'invalid url'});
    }
    if (activeRunCount() >= MAX_ACTIVE_RUNS) {
      return json(res, 429, {error: `too many active runs (max ${MAX_ACTIVE_RUNS})`});
    }
    const rec = startRun(body);
    return json(res, 200, {runId: rec.id});
  }

  if (req.method === 'GET' && pathname.startsWith('/api/logs/')) {
    const id = pathname.split('/').pop()!;
    const rec = runs.get(id);
    if (!rec) return json(res, 404, {error: 'not found'});
    const since = Number(url.query.since || 0);
    const logs = rec.logs.slice(since);
    return json(res, 200, {
      status: rec.status,
      logs,
      next: since + logs.length,
      exitCode: rec.exitCode ?? null,
      manifestPath: rec.manifestPath || null,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt || null,
    });
  }

  // Serve screenshot images, constrained to within the serve root and to image
  // file types only.
  if (req.method === 'GET' && pathname === '/api/file') {
    const q = parse(req.url || '', true).query;
    const p = (q.path as string) || '';
    if (!p) return json(res, 400, {error: 'path required'});
    const abs = path.resolve(p);
    if (!isWithinRoot(SERVE_ROOT, abs)) {
      return json(res, 403, {error: 'forbidden'});
    }
    const ext = path.extname(abs).toLowerCase();
    if (!ALLOWED_IMAGE_EXTS.has(ext)) {
      return json(res, 403, {error: 'only image files may be served'});
    }
    if (!fs.existsSync(abs)) return json(res, 404, {error: 'not found'});
    const type =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'image/webp';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
    });
    const stream = fs.createReadStream(abs);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/run/') && pathname.endsWith('/manifest')) {
    const parts = pathname.split('/');
    const id = parts[parts.length - 2];
    const rec = runs.get(id);
    if (!rec) return json(res, 404, {error: 'not found'});
    if (!rec.manifestPath) return json(res, 404, {error: 'manifest not available'});
    if (!isWithinRoot(SERVE_ROOT, path.resolve(rec.manifestPath))) {
      return json(res, 403, {error: 'forbidden'});
    }
    try {
      const content = fs.readFileSync(rec.manifestPath, 'utf8');
      const dl = (parse(req.url || '', true).query.download ?? '').toString();
      if (dl === '1' || dl === 'true') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="run-${id}.json"`,
        });
        return res.end(content);
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(content);
    } catch (e: any) {
      return json(res, 500, {error: String(e?.message || e)});
    }
  }

  if (req.method === 'POST' && pathname === '/api/open') {
    let body: any;
    try {
      body = await parseBody(req);
    } catch {
      return json(res, 413, {error: 'request body too large'});
    }
    const p = String(body.path || '');
    const mode = (body.mode as 'file' | 'dir' | 'reveal') || 'file';
    if (!p) return json(res, 400, {error: 'path required'});

    const abs = path.resolve(p);
    // Only open paths inside the serve root — never arbitrary files/apps on the
    // machine.
    if (!isWithinRoot(SERVE_ROOT, abs)) {
      return json(res, 403, {error: 'forbidden'});
    }
    // ensure path exists
    if (!fs.existsSync(abs)) return json(res, 404, {error: 'path not found'});

    const isDir = fs.statSync(abs).isDirectory();
    try {
      const platform = process.platform;
      let cmd: string;
      let args: string[] = [];
      if (platform === 'darwin') {
        if (mode === 'reveal' && !isDir) {
          cmd = 'open';
          args = ['-R', abs];
        } else {
          cmd = 'open';
          args = [mode === 'dir' && !isDir ? path.dirname(abs) : abs];
        }
      } else if (platform === 'win32') {
        if (mode === 'reveal' && !isDir) {
          cmd = 'explorer';
          args = ['/select,', abs];
        } else {
          cmd = 'explorer';
          args = [mode === 'dir' && !isDir ? path.dirname(abs) : abs];
        }
      } else {
        // linux and others
        cmd = 'xdg-open';
        args = [mode === 'dir' && !isDir ? path.dirname(abs) : abs];
      }

      const child = spawn(cmd, args, {stdio: 'ignore', detached: true});
      child.unref();
      return json(res, 200, {ok: true});
    } catch (e: any) {
      return json(res, 500, {error: String(e?.message || e)});
    }
  }

  // SSE for live events
  if (req.method === 'GET' && pathname.startsWith('/api/events/')) {
    const id = pathname.split('/').pop()!;
    const rec = runs.get(id);
    if (!rec) {
      res.writeHead(404, {'Content-Type': 'text/plain'});
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // initial dump
    send('status', {
      status: rec.status,
      exitCode: rec.exitCode ?? null,
      manifestPath: rec.manifestPath || null,
      startedAt: rec.startedAt,
      finishedAt: rec.finishedAt || null,
    });
    if (rec.logs.length) {
      send('logs', {lines: rec.logs.filter(Boolean), next: rec.logs.length});
    }
    send('metrics', rec.metrics);

    rec.subscribers.add(res);

    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    res.on('close', () => {
      clearInterval(ping);
      rec.subscribers.delete(res);
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/run/')) {
    const id = pathname.split('/').pop()!;
    const rec = runs.get(id);
    if (!rec) return json(res, 404, {error: 'not found'});
    if (rec.child && rec.status === 'running') {
      rec.child.kill('SIGTERM');
      rec.status = 'aborted';
      rec.finishedAt = Date.now();
    }
    return json(res, 200, {ok: true});
  }

  res.writeHead(404, {'Content-Type': 'text/plain'});
  res.end('Not found');
});

const PORT = Number(process.env.DEV_API_PORT || 3001);

// Bind to loopback only so the dev server is never exposed on the LAN, and
// only start listening when run directly (so importing this module in tests
// does not bind a port).
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Dev API server listening on http://127.0.0.1:${PORT}`);
  });
}

export {isWithinRoot, server};

function broadcast(rec: RunRecord, event: string, data: any) {
  for (const sub of rec.subscribers) {
    try {
      sub.write(`event: ${event}\n`);
      sub.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // ignore write errors
    }
  }
}
