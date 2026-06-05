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

function json(res: http.ServerResponse, status: number, body: any) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
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
  });

  return rec;
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = parse(req.url || '', true);
  const pathname = url.pathname || '';

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
    const body = await parseBody(req);
    if (!body.url) return json(res, 400, {error: 'url required'});
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

  // Serve static file (screenshots/manifests). Limited to within cwd for dev safety.
  if (req.method === 'GET' && pathname === '/api/file') {
    const q = parse(req.url || '', true).query;
    const p = (q.path as string) || '';
    if (!p) return json(res, 400, {error: 'path required'});
    const root = process.cwd();
    const abs = path.resolve(p);
    if (!abs.startsWith(root)) {
      return json(res, 403, {error: 'forbidden'});
    }
    if (!fs.existsSync(abs)) return json(res, 404, {error: 'not found'});
    const ext = path.extname(abs).toLowerCase();
    const type =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
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
    try {
      const content = fs.readFileSync(rec.manifestPath, 'utf8');
      const dl = (parse(req.url || '', true).query.download ?? '').toString();
      if (dl === '1' || dl === 'true') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="run-${id}.json"`,
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(content);
      }
      res.writeHead(200, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
      return res.end(content);
    } catch (e: any) {
      return json(res, 500, {error: String(e?.message || e)});
    }
  }

  if (req.method === 'POST' && pathname === '/api/open') {
    const body = await parseBody(req);
    const p = String(body.path || '');
    const mode = (body.mode as 'file' | 'dir' | 'reveal') || 'file';
    if (!p) return json(res, 400, {error: 'path required'});

    const abs = path.resolve(p);
    // basic safety: ensure path exists
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
      'Access-Control-Allow-Origin': '*',
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
server.listen(PORT, () => {
  console.log(`Dev API server listening on http://localhost:${PORT}`);
});

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
