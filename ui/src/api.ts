export type RunPayload = {
  url: string;
  resolutions: string[];
  desktop?: boolean;
  mobile?: boolean;
  output?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  crawl?: boolean;
  maxPages?: number;
  timeout?: number;
  concurrency?: number;
  retries?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  continueOnError?: boolean;
  failFast?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  delay?: number;
  fullPage?: boolean;
  headless?: boolean;
};

export async function startRun(body: RunPayload): Promise<{runId: string}> {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to start run');
  return res.json();
}

export type LogsResponse = {
  status: 'running' | 'completed' | 'failed' | 'aborted';
  logs: string[];
  next: number;
  exitCode: number | null;
  manifestPath: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export async function fetchLogs(runId: string, since = 0): Promise<LogsResponse> {
  const res = await fetch(`/api/logs/${runId}?since=${since}`);
  if (!res.ok) throw new Error('Failed to fetch logs');
  return res.json();
}

export async function abortRun(runId: string): Promise<void> {
  const res = await fetch(`/api/run/${runId}`, {method: 'DELETE'});
  if (!res.ok) throw new Error('Failed to abort run');
}

export function openEvents(runId: string): EventSource {
  return new EventSource(`/api/events/${runId}`);
}

export async function openPath(
  path: string,
  mode: 'file' | 'dir' | 'reveal' = 'file'
): Promise<void> {
  const res = await fetch('/api/open', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({path, mode}),
  });
  if (!res.ok) throw new Error('Failed to open path');
}

export type RunSummary = {
  id: string;
  url: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  manifestPath: string | null;
};

export async function listRuns(): Promise<RunSummary[]> {
  const res = await fetch('/api/runs');
  if (!res.ok) throw new Error('Failed to list runs');
  return res.json();
}

export async function fetchManifest(runId: string): Promise<any> {
  const res = await fetch(`/api/run/${runId}/manifest`);
  if (!res.ok) throw new Error('Failed to fetch manifest');
  return res.json();
}

export async function downloadManifest(runId: string): Promise<void> {
  const res = await fetch(`/api/run/${runId}/manifest?download=1`);
  if (!res.ok) throw new Error('Failed to download manifest');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `run-${runId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function fileUrl(p: string): string {
  return `/api/file?path=${encodeURIComponent(p)}`;
}
