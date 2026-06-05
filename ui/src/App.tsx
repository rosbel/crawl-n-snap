import React, { useEffect, useMemo, useRef, useState } from 'react'
import { abortRun, openEvents, RunPayload, startRun, openPath, listRuns, downloadManifest, fetchManifest, fileUrl } from './api'
import './theme.css'
import { parseResolutions } from './utils'

const section: React.CSSProperties = { marginBlock: 20, padding: 20, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--card-bg)' }
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8 }
const input: React.CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--fg)', outline: 'none' }
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }
const button: React.CSSProperties = { padding: '12px 16px', borderRadius: 10, border: '1px solid transparent', background: 'var(--accent-grad)', color: '#fff', cursor: 'pointer' }
const buttonGhost: React.CSSProperties = { padding: '12px 16px', borderRadius: 10, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--fg)', cursor: 'pointer' }

export default function App() {
  const [url, setUrl] = useState('https://example.com')
  const [resolutions, setResolutions] = useState('1920x1080, 390x844')
  const [browser, setBrowser] = useState<'chromium'|'firefox'|'webkit'>('chromium')
  const [output, setOutput] = useState('./generated-screenshots')
  const [crawl, setCrawl] = useState(false)
  const [maxPages, setMaxPages] = useState(50)
  const [timeout, setTimeoutMs] = useState(5000)
  const [concurrency, setConcurrency] = useState(3)
  const [retries, setRetries] = useState(2)
  const [includePatterns, setInclude] = useState('')
  const [excludePatterns, setExclude] = useState('')
  const [waitUntil, setWaitUntil] = useState<'load'|'domcontentloaded'|'networkidle'|'commit'>('networkidle')
  const [delay, setDelay] = useState(0)
  const [fullPage, setFullPage] = useState(true)
  const [continueOnError, setContinue] = useState(true)
  const [failFast, setFailFast] = useState(false)
  const [desktop, setDesktop] = useState(true)
  const [mobile, setMobile] = useState(false)
  const [profiles, setProfiles] = useState<Record<string, any>>(() => {
    try { return JSON.parse(localStorage.getItem('cns:profiles') || '{}') } catch { return {} }
  })
  const [profileName, setProfileName] = useState<string>('')
  const DEVICE_PRESETS: Array<{name: string, res: string}> = [
    { name: 'Desktop 1920x1080', res: '1920x1080' },
    { name: 'Desktop 1366x768', res: '1366x768' },
    { name: 'MacBook Pro 14" (1512x982)', res: '1512x982' },
    { name: 'iPhone 12/13 (390x844)', res: '390x844' },
    { name: 'iPhone SE (375x667)', res: '375x667' },
    { name: 'Pixel 7 (412x915)', res: '412x915' },
    { name: 'Galaxy S22 (360x780)', res: '360x780' },
    { name: 'iPad (768x1024)', res: '768x1024' },
    { name: 'iPad Pro (1024x1366)', res: '1024x1366' },
  ]
  const [devicePreset, setDevicePreset] = useState<string>('')

  const [runId, setRunId] = useState<string | null>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<'idle'|'running'|'completed'|'failed'|'aborted'>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [manifestPath, setManifestPath] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light'|'dark'>(() => (localStorage.getItem('cns:theme') as any) || 'light')
  const [pageProgress, setPageProgress] = useState({current: 0, total: 0})
  const [resProgress, setResProgress] = useState({current: 0, total: 0})
  const [headful, setHeadful] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [wrapLogs, setWrapLogs] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('cns:wrapLogs') || 'true') } catch { return true }
  })
  const logsRef = useRef<HTMLPreElement | null>(null)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  const payload: RunPayload = useMemo(() => ({
    url,
    resolutions: parseResolutions(resolutions),
    desktop,
    mobile,
    browser,
    output,
    crawl,
    maxPages,
    timeout,
    concurrency,
    retries,
    includePatterns: includePatterns ? includePatterns.split(',').map(s => s.trim()).filter(Boolean) : [],
    excludePatterns: excludePatterns ? excludePatterns.split(',').map(s => s.trim()).filter(Boolean) : [],
    waitUntil,
    delay,
    fullPage,
    continueOnError,
    failFast,
    headless: !headful,
  }), [url, resolutions, desktop, mobile, browser, output, crawl, maxPages, timeout, concurrency, retries, includePatterns, excludePatterns, waitUntil, delay, fullPage, continueOnError, failFast, headful])

  useEffect(() => {
    if (!runId) return
    const es = openEvents(runId)
    es.addEventListener('status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse((ev as any).data)
        setStatus(data.status)
        setExitCode(data.exitCode)
        setManifestPath(data.manifestPath)
      } catch { /* ignore parse errors */ }
    })
    es.addEventListener('logs', (ev: MessageEvent) => {
      try {
        const data = JSON.parse((ev as any).data)
        if (data.lines?.length) {
          setLogs(prev => [...prev, ...data.lines])
        }
      } catch { /* ignore parse errors */ }
    })
    es.addEventListener('metrics', (ev: MessageEvent) => {
      try {
        const m = JSON.parse((ev as any).data)
        setPageProgress({current: m.pageCurrent || 0, total: m.pageTotal || 0})
        setResProgress({current: m.resCurrent || 0, total: m.resTotal || 0})
      } catch { /* ignore parse errors */ }
    })
    return () => es.close()
  }, [runId])

  useEffect(() => {
    if (status === 'running' && autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [logs, status, autoScroll])

  // Load runs periodically
  useEffect(() => {
    const load = async () => {
      try { setRuns(await listRuns()) } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [])

  async function onRun(e: React.FormEvent) {
    e.preventDefault()
    setLogs([])
    setExitCode(null)
    setManifestPath(null)
    setStatus('running')
    const { runId } = await startRun(payload)
    setRunId(runId)
    setSelectedRunId(runId)
  }

  async function onAbort() {
    if (!runId) return
    await abortRun(runId)
    setStatus('aborted')
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cns:theme', theme)
  }, [theme])

  useEffect(() => {
    try { localStorage.setItem('cns:wrapLogs', JSON.stringify(wrapLogs)) } catch { /* ignore */ }
  }, [wrapLogs])

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system', background: 'var(--bg)', color: 'var(--fg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Crawl‑n‑Snap</h1>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>Interactive UI for the CLI. Fill in options and run.</p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label><input type="checkbox" checked={headful} onChange={e=>setHeadful(e.target.checked)} /> Headful (show browser)</label>
            <button type="button" style={buttonGhost} onClick={()=>setTheme(prev => prev==='light'?'dark':'light')}>
              {theme==='light' ? 'Dark mode' : 'Light mode'}
            </button>
          </div>
        </div>

        <form onSubmit={onRun}>
          <div style={section}>
            <label style={label}>URL</label>
            <input style={input} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com" />
          </div>

          <div style={{ ...section, display: 'grid', gap: 12 }}>
            <div>
              <label style={label}>Resolutions (comma separated)</label>
              <input style={input} value={resolutions} onChange={e=>setResolutions(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select style={{ ...input, height: 40, maxWidth: 280 }} value={devicePreset} onChange={e=>setDevicePreset(e.target.value)}>
                <option value="">— Device catalog —</option>
                {DEVICE_PRESETS.map(d => <option key={d.res} value={d.res}>{d.name}</option>)}
              </select>
              <button type="button" style={buttonGhost} disabled={!devicePreset} onClick={()=>{
                if (!devicePreset) return; setResolutions(devicePreset)
              }}>Apply device</button>
              <button type="button" style={buttonGhost} disabled={!devicePreset} onClick={()=>{
                if (!devicePreset) return;
                const list = new Set(resolutions.split(',').map(s=>s.trim()).filter(Boolean));
                list.add(devicePreset);
                setResolutions(Array.from(list).join(', '))
              }}>Add device</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={buttonGhost} onClick={()=>setResolutions('1920x1080, 1366x768, 1440x900')}>Apply Desktop</button>
              <button type="button" style={buttonGhost} onClick={()=>setResolutions('390x844, 375x667, 360x640')}>Apply Mobile</button>
              <button type="button" style={buttonGhost} onClick={()=>setResolutions('1920x1080, 1366x768, 1440x900, 390x844, 375x667, 360x640')}>Apply All</button>
            </div>
            <div style={row}>
              <label><input type="checkbox" checked={desktop} onChange={e=>setDesktop(e.target.checked)} /> Desktop preset</label>
              <label><input type="checkbox" checked={mobile} onChange={e=>setMobile(e.target.checked)} /> Mobile preset</label>
            </div>
            <div style={row}>
              <div>
                <label style={label}>Browser</label>
                <select style={{ ...input, height: 40 }} value={browser} onChange={e=>setBrowser(e.target.value as any)}>
                  <option value="chromium">chromium</option>
                  <option value="firefox">firefox</option>
                  <option value="webkit">webkit</option>
                </select>
              </div>
              <div>
                <label style={label}>Output directory</label>
                <input style={input} value={output} onChange={e=>setOutput(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ ...section, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--muted)' }}>Profiles</span>
              <select style={{ ...input, height: 40, maxWidth: 280 }} value={profileName} onChange={(e)=>{
                const name = e.target.value; setProfileName(name);
                const p = profiles[name]; if (!p) return;
                setUrl(p.url || url);
                setResolutions((p.resolutions || []).join(', '));
                setDesktop(!!p.desktop); setMobile(!!p.mobile);
                setBrowser(p.browser || 'chromium'); setOutput(p.output || './generated-screenshots');
                setCrawl(!!p.crawl); setMaxPages(p.maxPages ?? 50);
                setTimeoutMs(p.timeout ?? 5000); setConcurrency(p.concurrency ?? 3); setRetries(p.retries ?? 2);
                setInclude((p.includePatterns || []).join(', ')); setExclude((p.excludePatterns || []).join(', '));
                setWaitUntil(p.waitUntil || 'networkidle'); setDelay(p.delay ?? 0); setFullPage(p.fullPage ?? true);
                setContinue(p.continueOnError ?? true); setFailFast(!!p.failFast); setHeadful(p.headless === false);
              }}>
                <option value="">— Select profile —</option>
                {Object.keys(profiles).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <button type="button" style={buttonGhost} onClick={()=>{
                const name = prompt('Profile name:');
                if (!name) return;
                const next = { ...profiles, [name]: payload };
                setProfiles(next);
                setProfileName(name);
                localStorage.setItem('cns:profiles', JSON.stringify(next));
              }}>Save</button>
              <button type="button" style={buttonGhost} onClick={()=>{
                if (!profileName) return;
                const rest = { ...profiles } as Record<string, any>;
                delete (rest as any)[profileName];
                setProfiles(rest);
                setProfileName('');
                localStorage.setItem('cns:profiles', JSON.stringify(rest));
              }} disabled={!profileName}>Delete</button>
            </div>
          </div>

          <div style={{ ...section, display: 'grid', gap: 12 }}>
            <div style={row}>
              <label><input type="checkbox" checked={crawl} onChange={e=>setCrawl(e.target.checked)} /> Crawl site</label>
              <div>
                <label style={label}>Max pages</label>
                <input style={input} type="number" value={maxPages} onChange={e=>setMaxPages(parseInt(e.target.value))} />
              </div>
            </div>
            <div style={row}>
              <div>
                <label style={label}>Timeout (ms)</label>
                <input style={input} type="number" value={timeout} onChange={e=>setTimeoutMs(parseInt(e.target.value))} />
              </div>
              <div>
                <label style={label}>Concurrency</label>
                <input style={input} type="number" value={concurrency} onChange={e=>setConcurrency(parseInt(e.target.value))} />
              </div>
            </div>
            <div style={row}>
              <div>
                <label style={label}>Retries</label>
                <input style={input} type="number" value={retries} onChange={e=>setRetries(parseInt(e.target.value))} />
              </div>
              <div>
                <label style={label}>waitUntil</label>
                <select style={{ ...input, height: 40 }} value={waitUntil} onChange={e=>setWaitUntil(e.target.value as any)}>
                  <option value="load">load</option>
                  <option value="domcontentloaded">domcontentloaded</option>
                  <option value="networkidle">networkidle</option>
                  <option value="commit">commit</option>
                </select>
              </div>
            </div>
            <div style={row}>
              <div>
                <label style={label}>Delay (ms)</label>
                <input style={input} type="number" value={delay} onChange={e=>setDelay(parseInt(e.target.value))} />
              </div>
              <label><input type="checkbox" checked={fullPage} onChange={e=>setFullPage(e.target.checked)} /> Full page</label>
            </div>
            <div style={row}>
              <div>
                <label style={label}>Include patterns (comma)</label>
                <input style={input} value={includePatterns} onChange={e=>setInclude(e.target.value)} />
              </div>
              <div>
                <label style={label}>Exclude patterns (comma)</label>
                <input style={input} value={excludePatterns} onChange={e=>setExclude(e.target.value)} />
              </div>
            </div>
            <div style={row}>
              <label><input type="checkbox" checked={continueOnError} onChange={e=>setContinue(e.target.checked)} /> Continue on error</label>
              <label><input type="checkbox" checked={failFast} onChange={e=>setFailFast(e.target.checked)} /> Fail fast</label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" style={button} disabled={status==='running'}>Run</button>
            <button type="button" style={buttonGhost} onClick={onAbort} disabled={!runId || status!=='running'}>Abort</button>
          </div>
        </form>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="two-col">
            <div style={{ borderRight: '1px solid var(--border)', paddingRight: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Run History</h3>
                <button type="button" style={buttonGhost} onClick={async ()=> setRuns(await listRuns())}>Refresh</button>
              </div>
              <div style={{ marginTop: 12, display: 'grid', gap: 8, maxHeight: 300, overflow: 'auto' }}>
                {runs.map(r => (
                  <div key={r.id} onClick={()=>setSelectedRunId(r.id)} style={{ padding: 8, borderRadius: 8, cursor: 'pointer', background: selectedRunId===r.id ? 'var(--bar-bg)' : 'transparent' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.status.toUpperCase()} {r.exitCode!==null?`(${r.exitCode})`:''}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(r.startedAt).toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</div>
                  </div>
                ))}
                {!runs.length && <div style={{ color: 'var(--muted)' }}>No runs yet.</div>}
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              {/* Progress + status + logs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                <span>Pages</span>
                <span>{pageProgress.current}/{pageProgress.total || '?'}</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--bar-bg)' }}>
                <div style={{ height: '100%', borderRadius: 999, width: `${pageProgress.total? Math.min(100, Math.round(pageProgress.current / pageProgress.total * 100)) : 0}%`, backgroundImage: 'var(--accent-grad)' }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                <span>Resolutions (current page)</span>
                <span>{resProgress.current}/{resProgress.total || '?'}</span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--bar-bg)' }}>
                <div style={{ height: '100%', borderRadius: 999, width: `${resProgress.total? Math.min(100, Math.round(resProgress.current / resProgress.total * 100)) : 0}%`, backgroundImage: 'var(--accent-grad)' }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>Status: <strong>{status}</strong>{exitCode!==null ? ` (exit ${exitCode})` : ''}</span>
            {manifestPath && <>
              <a href="#" onClick={(e)=>{ e.preventDefault(); navigator.clipboard.writeText(manifestPath!) }} style={{ color: 'var(--accent)' }}>Copy manifest path</a>
              <a href="#" onClick={async (e)=>{ e.preventDefault(); if(manifestPath) await openPath(manifestPath, 'reveal') }} style={{ color: 'var(--accent)' }}>Reveal</a>
              <a href="#" onClick={async (e)=>{ e.preventDefault(); if(manifestPath) await openPath(manifestPath, 'dir') }} style={{ color: 'var(--accent)' }}>Open folder</a>
              <a href="#" onClick={async (e)=>{ e.preventDefault(); if(selectedRunId) await downloadManifest(selectedRunId) }} style={{ color: 'var(--accent)' }}>Download manifest</a>
            </>}
            <label style={{ marginLeft: 'auto' }}><input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)} /> Auto-scroll</label>
            <label><input type="checkbox" checked={wrapLogs} onChange={e=>setWrapLogs(e.target.checked)} /> Wrap lines</label>
          </div>
          <pre ref={logsRef} className="terminal" style={{ marginTop: 12, maxHeight: 400, whiteSpace: wrapLogs ? 'pre-wrap' as const : 'pre' as const, wordBreak: wrapLogs ? 'break-word' : 'normal' }}>
{logs.join('\n')}
          </pre>
          <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* Structured Results */}
        <RunResults selectedRunId={selectedRunId} runs={runs} />
      </div>
    </div>
  )
}

function RunResults({ selectedRunId, runs }: { selectedRunId: string | null, runs: any[] }) {
  const [manifest, setManifest] = useState<any | null>(null)
  const selected = useMemo(() => runs.find(r => r.id === selectedRunId) || null, [runs, selectedRunId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!selectedRunId) { setManifest(null); return }
      // Only fetch when manifest path is available
      if (!selected?.manifestPath) { setManifest(null); return }
      try {
        const data = await fetchManifest(selectedRunId)
        if (!cancelled) setManifest(data)
      } catch {
        if (!cancelled) setManifest(null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedRunId, selected?.manifestPath])

  if (!selectedRunId) return null

  return (
    <div style={{ ...section }}>
      <h3 style={{ marginTop: 0 }}>Results</h3>
      {!selected?.manifestPath ? (
        <div style={{ color: 'var(--muted)' }}>Waiting for manifest...</div>
      ) : !manifest ? (
        <div style={{ color: 'var(--muted)' }}>Loading manifest…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <strong>Target:</strong> {manifest.target}
          </div>
          <div style={{ display: 'flex', gap: 24, color: 'var(--muted)' }}>
            <div>Pages: {manifest.summary?.pagesProcessed ?? '?'}</div>
            <div>Errors: {manifest.summary?.totalErrors ?? 0}</div>
            <div>Any failures: {String(manifest.summary?.anyFailures ?? false)}</div>
          </div>
          <div>
            <strong>Options:</strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{JSON.stringify(manifest.options)}</div>
          </div>
          <div>
            <strong>Pages:</strong>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {(manifest.pages || []).slice(0, 50).map((p: any, i: number) => (
                <div key={i} style={{ padding: 8, border: '1px solid #e6e6e6', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>{p.url}</div>
                  <div className="preview-grid" style={{ marginTop: 6 }}>
                    {p.results.map((r: any, j: number) => (
                      <div key={j} className="preview" title={r.outputPath || r.error}>
                        {r.outputPath && r.success ? (
                          <>
                            <span className="chip">{r.resolution}</span>
                            <img src={fileUrl(r.outputPath)} alt={r.resolution} />
                          </>
                        ) : (
                          <div style={{ padding: 8, fontSize: 12, color: 'var(--muted)' }}>
                            <strong>{r.resolution}</strong> ✗ {r.error || 'Failed'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
