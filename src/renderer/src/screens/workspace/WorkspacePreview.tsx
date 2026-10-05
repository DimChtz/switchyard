import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { TerminalView } from '../../components/TerminalView'
import { projectEnv } from '../../lib/agentControl'
import type { Project, Task } from '@shared/types'
import { Button } from '../../components/ui'
import { inParens } from '../../lib/shortcuts'
import { checkoutsOf, taskRoot } from '../../lib/multiRepo'
import { PointAndFix, usePointAndFix } from './PointAndFix'

// Servers print their address in many shapes: http://localhost:3000,
// http://127.0.0.1:5173/, tcp://0.0.0.0:8000, http://[::1]:3000 ...
const URL_RE = /(?:https?|tcp):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i

// Survives this tab unmounting (switching tasks) while the server keeps
// running in the background. By the server's session.
const portByTask = new Map<string, number>()
// The repository whose dev server the tab shows, per task.
const repoByTask = new Map<string, string>()

/** The port the task's dev server (its home repository's) was started on, if it was started here. */
export function previewPortOf(taskId: string): number | null {
  return portByTask.get(`preview-${taskId}`) ?? null
}

/** A repository's dev server session: the home one keeps the task's plain id. */
function previewSession(task: Task, repoId: string): string {
  return repoId === task.projectId ? `preview-${task.id}` : `preview-${task.id}~${repoId}`
}

/**
 * The Preview tab: a dev server and the page it serves. A task in several
 * repositories picks which repository's server (each can run at once).
 */
export function WorkspacePreview({ task, project }: { task: Task; project: Project }): React.JSX.Element {
  const { state } = useAppStore()
  const repos = checkoutsOf(task, state.projects).filter((c) => c.path)
  const [repoId, setRepoId] = useState(() => repoByTask.get(task.id) ?? project.id)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const reposKey = repos.map((r) => r.project.id).join(',')
  useEffect(() => {
    if (repos.length < 2) return
    let cancelled = false
    const check = (): void => {
      Promise.all(repos.map((r) => window.api.pty.info(previewSession(task, r.project.id)).then((i) => [r.project.id, !!i?.running] as const))).then(
        (pairs) => !cancelled && setRunning(Object.fromEntries(pairs))
      )
    }
    check()
    const t = setInterval(check, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reposKey, task.id])

  if (repos.length < 2) return <PreviewPane task={task} project={project} cwd={task.worktreePath} sessionId={previewSession(task, project.id)} />
  const cur = repos.find((r) => r.project.id === repoId) ?? repos[0]
  const pick = (id: string): void => {
    repoByTask.set(task.id, id)
    setRepoId(id)
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: '1px solid var(--bd-1)', font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>
        <span style={{ marginRight: 4 }}>Dev server in</span>
        {repos.map((r) => {
          const on = r.project.id === cur.project.id
          return (
            <span
              key={r.project.id}
              onClick={() => pick(r.project.id)}
              title={r.project.devCmd ? `${r.project.devCmd} in ${r.path}` : `No dev command set for ${r.project.name}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 22,
                padding: '0 9px',
                borderRadius: 11,
                cursor: 'pointer',
                color: on ? 'var(--t1)' : 'var(--t3)',
                background: on ? 'var(--bg-hover)' : 'transparent',
                border: `1px solid ${on ? 'var(--bd-4)' : 'var(--bd-2)'}`
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: running[r.project.id] ? 'var(--c-green)' : 'var(--bd-5)' }} />
              {r.project.name}
            </span>
          )
        })}
      </div>
      <PreviewPane key={cur.project.id} task={task} project={cur.project} cwd={cur.path} sessionId={previewSession(task, cur.project.id)} />
    </div>
  )
}

function PreviewPane({ task, project, cwd, sessionId }: { task: Task; project: Project; cwd: string | null; sessionId: string }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [state, setState] = useState<'loading' | 'idle' | 'running' | 'exited'>('loading')
  const [url, setUrl] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const webview = useRef<Electron.WebviewTag | null>(null)
  const [address, setAddress] = useState('')
  const [nav, setNav] = useState({ back: false, forward: false })
  // Point and fix: pick an element, tell the agent what to change about it.
  const point = usePointAndFix(webview, taskRoot(task))

  // The address bar and back/forward follow what the page does.
  useEffect(() => {
    if (!url) return
    setAddress(url)
    const wv = webview.current
    if (!wv) return
    const sync = (): void => {
      try {
        setAddress(wv.getURL())
        setNav({ back: wv.canGoBack(), forward: wv.canGoForward() })
      } catch {
        // not attached yet
      }
    }
    const events = ['did-navigate', 'did-navigate-in-page', 'did-stop-loading'] as const
    for (const ev of events) wv.addEventListener(ev, sync)
    return () => {
      for (const ev of events) wv.removeEventListener(ev, sync)
    }
  }, [url, state])

  useEffect(() => {
    window.api.pty.info(sessionId).then((info) => {
      if (!info) return setState('idle')
      setState(info.running ? 'running' : 'exited')
      setExitCode(info.exitCode)
    })
  }, [sessionId])

  // While nothing runs: an agent may start the server (its start_dev_server tool).
  useEffect(() => {
    if (state !== 'idle') return
    const t = setInterval(() => {
      window.api.pty.info(sessionId).then((info) => info?.running && setState('running'))
    }, 2000)
    return () => clearInterval(t)
  }, [state, sessionId])

  // A project added before its stack was recognised has no dev command yet -
  // offer what detection finds now instead of changing settings silently.
  useEffect(() => {
    if (project.devCmd || !project.repoPath) return
    window.api.git.detectProjectMeta(project.repoPath).then((m) => setSuggested(m.devCmd ?? null))
  }, [project.devCmd, project.repoPath])

  // Find the URL: from what the server prints, or by the port we gave it
  // accepting connections (for servers that print nothing recognisable).
  useEffect(() => {
    if (state !== 'running' || url) return
    const port = portByTask.get(sessionId)
    // Started elsewhere (an agent's start_dev_server): it may have said where already.
    window.api.pty.getBuffer(sessionId).then((buf) => {
      const m = buf.match(URL_RE)
      if (m) setUrl(`http://localhost:${m[1]}`)
    })
    const offData = window.api.pty.onData((id, data) => {
      if (id !== sessionId) return
      const m = data.match(URL_RE)
      if (m) setUrl(`http://localhost:${m[1]}`)
    })
    const offExit = window.api.pty.onExit((id, code) => {
      if (id !== sessionId) return
      setExitCode(code)
      setState('exited')
    })
    const poll = setInterval(async () => {
      if (port && (await window.api.net.portOpen(port))) setUrl(`http://localhost:${port}`)
    }, 1000)
    return () => {
      offData()
      offExit()
      clearInterval(poll)
    }
  }, [state, url, sessionId])

  const start = async (): Promise<void> => {
    if (!project.devCmd || !cwd) return
    const port = await window.api.net.freePort()
    portByTask.set(sessionId, port)
    setUrl(null)
    setExitCode(null)
    await window.api.pty.spawn({
      id: sessionId,
      cwd,
      execCommand: project.devCmd,
      env: { ...projectEnv(project), PORT: String(port) },
      cols: 120,
      rows: 12
    })
    setState('running')
  }

  const stop = (): void => {
    window.api.pty.kill(sessionId)
    portByTask.delete(sessionId)
    setUrl(null)
    setState('idle')
    dispatch({ type: 'TOAST', text: 'Dev server stopped.' })
  }

  const useSuggested = (): void => {
    if (!suggested) return
    dispatch({ type: 'UPDATE_PROJECT', id: project.id, patch: { devCmd: suggested } })
    // Saved where the project keeps its dev command (the repo's settings file, if it's there).
    window.api.projects
      .setSettings(project.id, project.sources?.devCmd ?? 'machine', { devCmd: suggested })
      .then((p) => p && dispatch({ type: 'UPDATE_PROJECT', id: project.id, patch: p }))
      .catch(() => {})
  }

  if (!cwd) return <Centered text="This task has no worktree yet." />

  if (!project.devCmd) {
    return (
      <Centered text={`No dev command set for ${project.name}.`}>
        {suggested ? (
          <>
            <Button variant="primary" size="lg" onClick={useSuggested}>
              Use {suggested}
            </Button>
            <Hint>Detected from the project. You can change it later in Project settings.</Hint>
          </>
        ) : (
          <Hint>Set one in Project settings{inParens('project-settings')}.</Hint>
        )}
      </Centered>
    )
  }

  if (state === 'loading') return <div style={{ flex: 1 }} />

  if (state === 'idle') {
    return (
      <Centered text="No dev server running for this worktree.">
        <Button variant="primary" size="lg" onClick={start}>
          Start dev server
        </Button>
        <Hint>{project.devCmd} · on a free port (PORT is set for it)</Hint>
      </Centered>
    )
  }

  const port = portByTask.get(sessionId)
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0,1fr) 180px' }}>
      <div style={{ minHeight: 0, background: 'var(--bg-app)', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            height: 32,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 10px',
            borderBottom: '1px solid var(--bd-1)',
            font: "11.5px var(--font-mono)",
            color: 'var(--t3)'
          }}
        >
          {url && state === 'running' ? (
            <>
              <NavArrow label="←" title="Back" enabled={nav.back} onClick={() => webview.current?.canGoBack() && webview.current.goBack()} />
              <NavArrow label="→" title="Forward" enabled={nav.forward} onClick={() => webview.current?.canGoForward() && webview.current.goForward()} />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key !== 'Enter') return
                  const target = toUrl(address, url)
                  if (target) webview.current?.loadURL(target)
                }}
                onFocus={(e) => e.currentTarget.select()}
                spellCheck={false}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 22,
                  background: 'var(--bg-panel-3)',
                  border: '1px solid var(--bd-2)',
                  borderRadius: 4,
                  padding: '0 8px',
                  color: 'var(--t2)',
                  font: "11.5px var(--font-mono)",
                  outline: 'none'
                }}
              />
            </>
          ) : (
            <>
              <span style={{ color: 'var(--t3)' }}>
                {state === 'exited' ? `server exited with code ${exitCode ?? '?'}` : `waiting for the server${port ? ` on :${port}` : ''}…`}
              </span>
              <div style={{ flex: 1 }} />
            </>
          )}
          {state === 'exited' ? (
            <span onClick={start} style={{ cursor: 'pointer', color: 'var(--c-blue)' }}>
              start again
            </span>
          ) : (
            <>
              {url ? (
                <>
                  <span
                    onClick={point.toggle}
                    title={`Point at something on the page and tell ${task.agentKind ? 'the agent' : 'an agent'} what to change about it`}
                    style={{ cursor: 'pointer', color: point.picking ? 'var(--c-blue)' : 'var(--t2)', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                      <circle cx="7" cy="7" r="4.2" />
                      <path d="M7 1v2.3M7 10.7V13M1 7h2.3M10.7 7H13" />
                    </svg>
                    {point.picking ? 'click an element · esc' : 'point & fix'}
                  </span>
                  <span onClick={() => webview.current?.reload()} style={{ cursor: 'pointer', color: 'var(--t2)' }}>
                    reload
                  </span>
                  <span
                    onClick={() => window.api.sys.openExternal(webview.current?.getURL() || url)}
                    title="Open this page in your browser"
                    style={{ cursor: 'pointer', color: 'var(--t2)' }}
                  >
                    open ↗
                  </span>
                  <span
                    onClick={() => (webview.current?.isDevToolsOpened() ? webview.current.closeDevTools() : webview.current?.openDevTools())}
                    title="Open developer tools for this page"
                    style={{ cursor: 'pointer', color: 'var(--t2)' }}
                  >
                    inspect
                  </span>
                </>
              ) : null}
              <span onClick={stop} style={{ cursor: 'pointer', color: 'var(--c-red)' }}>
                stop
              </span>
            </>
          )}
        </div>
        {url && state === 'running' ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
            <PreviewWebview url={url} webviewRef={webview} />
            {point.picked ? <PointAndFix task={task} root={taskRoot(task)} point={point} /> : null}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t4)', fontSize: 13 }}>
            {state === 'exited' ? 'The dev server stopped - see its output below.' : 'Starting…'}
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--bd-1)', minHeight: 0, display: 'flex' }}>
        <TerminalView key={`${sessionId}:${port ?? 0}`} sessionId={sessionId} cwd={cwd} attachOnly />
      </div>
    </div>
  )
}

/** What was typed in the address bar as a URL: "/users" is a path on the dev server. */
function toUrl(input: string, server: string): string | null {
  const t = input.trim()
  if (!t) return null
  if (t.startsWith('/')) return server.replace(/\/+$/, '') + t
  if (/^https?:\/\//i.test(t)) return t
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(t)) return `http://${t}`
  return null
}

function NavArrow({ label, title, enabled, onClick }: { label: string; title: string; enabled: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <span
      onClick={onClick}
      title={title}
      style={{ cursor: enabled ? 'pointer' : 'default', color: enabled ? 'var(--t2)' : 'var(--t5)', padding: '0 2px' }}
    >
      {label}
    </span>
  )
}

function Centered({ text, children }: { text: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ font: '13px var(--font-ui)', color: 'var(--t3)' }}>{text}</div>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ font: "12px var(--font-mono)", color: 'var(--t4)' }}>{children}</div>
}

function PreviewWebview({
  url,
  webviewRef
}: {
  url: string
  webviewRef: React.MutableRefObject<Electron.WebviewTag | null>
}): React.JSX.Element {
  return (
    <webview ref={webviewRef as never} src={url} style={{ flex: 1, border: 'none' }} />
  )
}
