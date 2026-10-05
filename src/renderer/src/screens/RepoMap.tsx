import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useConflicts } from '../lib/conflicts'
import { useHover } from '../lib/useHover'
import { agentShort } from '../lib/derive'
import { statusColor, statusLabel } from '../lib/status'
import { buildTree, commonFolder, find, layout, placeOf, type Placed } from '../lib/treemap'
import { Button, Select } from '../components/ui'
import type { MapActivity, MapTree, Project, Task } from '@shared/types'

const MONO = 'var(--font-mono)'
// Each task's colour on the map (amber and red mean overlap and clash).
const PALETTE = ['c-blue', 'syn-keyword', 'c-green', 'syn-tag', 'syn-function', 'syn-type', 'c-pin', 'syn-string']

/**
 * The repository map: the project's files as rectangles sized by how much
 * they hold, the files each task changed in its colour - amber where two
 * tasks change the same file, red where they won't merge - and each agent
 * as a dot on the file it's on now.
 */
export function RepoMap(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const project = state.projects.find((p) => p.id === state.projectId) ?? state.projects[0]
  if (!project) return <div style={{ padding: 32, color: 'var(--t3)', font: '13px var(--font-ui)' }}>Add a project to see its map.</div>
  return <MapBody key={project.id} project={project} onProject={(id) => dispatch({ type: 'NAV', view: 'map', projectId: id })} />
}

interface FileState {
  tasks: string[]
  clash: boolean
}

function MapBody({ project, onProject }: { project: Project; onProject: (id: string) => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [tree, setTree] = useState<MapTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<MapActivity[]>([])
  const [zoom, setZoom] = useState('')
  const [focus, setFocus] = useState<string | null>(null)
  const [hover, setHover] = useState<{ p: Placed; x: number; y: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const conflicts = useConflicts()

  useEffect(() => {
    window.api.map
      .tree(project.id)
      .then(setTree)
      .catch((err: unknown) => setError(String(err)))
  }, [project.id])
  // Where the agents are: every few seconds while the map shows.
  useEffect(() => {
    let live = true
    const poll = (): void => {
      if (document.hidden) return
      window.api.map
        .activity(project.id)
        .then((a) => live && setActivity(a))
        .catch(() => {})
    }
    poll()
    const t = setInterval(poll, 3000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [project.id])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // The tasks on the map, each with its colour.
  const tasks = useMemo(() => {
    const byId = new Map(state.tasks.map((t) => [t.id, t]))
    return activity
      .map((a) => ({ a, task: byId.get(a.taskId) }))
      .filter((x): x is { a: MapActivity; task: Task } => !!x.task)
      .sort((x, y) => x.task.key.localeCompare(y.task.key, undefined, { numeric: true }))
      .map((x, i) => ({ ...x, color: `var(--${PALETTE[i % PALETTE.length]})`, token: PALETTE[i % PALETTE.length] }))
  }, [activity, state.tasks])

  // Each changed file: who changes it, and whether two of them clash there.
  const files = useMemo(() => {
    const m = new Map<string, FileState>()
    for (const { a } of tasks) for (const f of a.files) m.set(f, { tasks: [...(m.get(f)?.tasks ?? []), a.taskId], clash: false })
    for (const p of conflicts?.pairs ?? []) if (p.repoId === project.id) for (const f of p.conflicts) if (m.has(f)) m.get(f)!.clash = true
    return m
  }, [tasks, conflicts, project.id])
  // And each folder with changed files inside.
  const folders = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const [f, s] of files) {
      for (let cut = f.lastIndexOf('/'); cut > 0; cut = f.lastIndexOf('/', cut - 1)) {
        const dir = f.slice(0, cut)
        const set = m.get(dir) ?? new Set<string>()
        for (const t of s.tasks) set.add(t)
        m.set(dir, set)
      }
    }
    return m
  }, [files])

  const root = useMemo(() => (tree ? buildTree(tree.files, [...files.keys()]) : null), [tree, files])
  const view = root ? (find(root, zoom) ?? root) : null
  const placed = useMemo(() => (view && size.w > 0 && size.h > 0 ? layout(view, { x: 0, y: 0, w: size.w, h: size.h }) : []), [view, size.w, size.h])
  const byPath = useMemo(() => new Map(placed.map((p) => [p.node.path, p])), [placed])
  const colorOf = useMemo(() => new Map(tasks.map((t) => [t.a.taskId, t.token])), [tasks])

  // Drawing.
  useEffect(() => {
    const c = canvas.current
    if (!c || !size.w) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const css = getComputedStyle(document.documentElement)
    const v = (name: string): string => css.getPropertyValue(`--${name}`).trim() || css.getPropertyValue('--t3').trim()
    const shades = [v('bg-panel'), v('bg-panel-2'), v('bg-panel-3')]
    ctx.fillStyle = v('bg-app')
    ctx.fillRect(0, 0, size.w, size.h)
    ctx.textBaseline = 'middle'
    const ext = (name: string): number => {
      const e = name.slice(name.lastIndexOf('.') + 1)
      let h = 0
      for (const ch of e) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      return h % shades.length
    }
    const label = (text: string, x: number, y: number, w: number, color: string, font: string): void => {
      ctx.font = font
      ctx.fillStyle = color
      let t = text
      while (t.length > 1 && ctx.measureText(t).width > w) t = t.slice(0, -2) + '…'
      if (ctx.measureText(t).width <= w) ctx.fillText(t, x, y)
    }
    for (const p of placed) {
      const { x, y, w, h } = p.rect
      if (w < 1 || h < 1) continue
      const isFile = !p.node.children
      const state = isFile ? files.get(p.node.path) : undefined
      const inside = !isFile ? folders.get(p.node.path) : undefined
      const mine = focus ? (isFile ? !!state?.tasks.includes(focus) : !!inside?.has(focus)) : true
      ctx.globalAlpha = focus && !mine ? 0.35 : 1
      if (isFile || p.folded) {
        const tint = isFile ? state : inside ? { tasks: [...inside], clash: false } : undefined
        ctx.fillStyle = shades[isFile ? ext(p.node.name) : 1]
        ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
        if (tint?.tasks.length) {
          const col = tint.clash ? v('c-red') : tint.tasks.length > 1 ? v('c-amber') : v(colorOf.get(tint.tasks[0]) ?? 'c-blue')
          ctx.globalAlpha = (focus && !mine ? 0.35 : 1) * (isFile ? 0.62 : 0.4)
          ctx.fillStyle = col
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
          ctx.globalAlpha = focus && !mine ? 0.35 : 1
        }
        if (p.node.isNew) {
          ctx.setLineDash([3, 2])
          ctx.strokeStyle = v(colorOf.get(state?.tasks[0] ?? '') ?? 't2')
          ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3))
          ctx.setLineDash([])
        }
        if (w > 44 && h > 15) label(p.folded ? `${p.node.name}/` : p.node.name, x + 5, y + Math.min(h / 2, 10), w - 9, tint?.tasks.length ? v('t1') : v('t3'), `11px ${css.getPropertyValue('--font-mono') || 'monospace'}`)
      } else {
        ctx.strokeStyle = v('bd-2')
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))
        if (p.header) label(`${p.node.name}/`, x + 5, y + p.header / 2 + 1, w - 10, inside?.size ? v('t1') : v('t3'), `${p.depth === 1 ? 600 : 500} 11px ${css.getPropertyValue('--font-mono') || 'monospace'}`)
      }
    }
    ctx.globalAlpha = 1
    if (hover) {
      const { x, y, w, h } = hover.p.rect
      ctx.strokeStyle = v('t1')
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
    }
    // Repaint when the theme changes (data-theme on <html>).
  }, [placed, files, folders, colorOf, focus, hover, size, state.prefs.theme])

  const at = (e: React.MouseEvent): Placed | undefined => {
    const r = canvas.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i].rect
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
        // A folder's insides are drawn over it; its label strip is its own.
        const hit = placed[i]
        if (hit.header && y > p.y + hit.header) continue
        return hit
      }
    }
    return undefined
  }
  const zoomTo = (path: string): void => {
    setZoom(path)
    setHover(null)
  }

  const crumbs = zoom ? zoom.split('/') : []
  const changed = files.size
  const overlaps = [...files.values()].filter((s) => s.tasks.length > 1).length
  const clashes = [...files.values()].filter((s) => s.clash).length
  const everything = commonFolder([...files.keys()])

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes sy-map-pulse { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(2.6); opacity: 0 } }`}</style>
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Map</span>
        <Select value={project.id} options={state.projects.map((p): [string, string] => [p.id, p.name])} onChange={onProject} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, font: `12px ${MONO}`, color: 'var(--t3)', minWidth: 0, overflow: 'hidden' }}>
          {zoom ? (
            <Crumb onClick={() => zoomTo('')} active={false}>
              ⌂
            </Crumb>
          ) : null}
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              <span style={{ color: 'var(--t5)' }}>/</span>
              <Crumb onClick={() => zoomTo(crumbs.slice(0, i + 1).join('/'))} active={i === crumbs.length - 1}>
                {c}
              </Crumb>
            </React.Fragment>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ font: `12px ${MONO}`, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} · {changed} {changed === 1 ? 'file' : 'files'} changed
          {overlaps ? <span style={{ color: 'var(--c-amber)' }}> · {overlaps} shared</span> : null}
          {clashes ? <span style={{ color: 'var(--c-red)' }}> · {clashes} clash</span> : null}
        </span>
        {zoom ? (
          <Button size="sm" onClick={() => zoomTo('')}>
            Whole repo
          </Button>
        ) : changed && everything ? (
          <Button size="sm" onClick={() => zoomTo(everything)} title="Zoom to the smallest folder holding every change">
            Zoom to changes
          </Button>
        ) : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
        <div ref={box} style={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', margin: 12, borderRadius: 6 }}>
          {error ? (
            <div style={{ padding: 20, font: '13px var(--font-ui)', color: 'var(--c-red)' }}>{error}</div>
          ) : !tree ? (
            <div style={{ padding: 20, font: '13px var(--font-ui)', color: 'var(--t3)' }}>Reading {project.name}…</div>
          ) : !tree.files.length ? (
            <div style={{ padding: 20, font: '13px var(--font-ui)', color: 'var(--t3)' }}>No files on {tree.ref || 'its default branch'} yet.</div>
          ) : null}
          <canvas
            ref={canvas}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }}
            onMouseMove={(e) => {
              const p = at(e)
              const r = box.current!.getBoundingClientRect()
              setHover(p ? { p, x: e.clientX - r.left, y: e.clientY - r.top } : null)
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              const p = at(e)
              if (!p) return
              const dir = p.node.children ? p.node.path : p.node.path.slice(0, Math.max(0, p.node.path.lastIndexOf('/')))
              if (dir !== zoom) zoomTo(dir)
            }}
            onDoubleClick={(e) => {
              const p = at(e)
              const who = p && files.get(p.node.path)?.tasks[0]
              if (who) dispatch({ type: 'OPEN_TASK', taskId: who, tab: 'changes' })
            }}
          />
          {tasks.map(({ a, task, color }, i) => (
            <AgentDot key={a.taskId} a={a} task={task} color={color} placed={byPath} zoom={zoom} files={files} width={size.w} stack={tasks.slice(0, i).filter((o) => o.a.now && o.a.now === a.now).length} dim={!!focus && focus !== a.taskId} onOpen={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })} />
          ))}
          {hover ? <Tip hover={hover} files={files} folders={folders} tasks={tasks} width={size.w} /> : null}
        </div>
        <Legend tasks={tasks} focus={focus} onFocus={setFocus} onZoom={(id) => zoomTo(commonFolder(tasks.find((t) => t.a.taskId === id)?.a.files ?? []))} onOpen={(id) => dispatch({ type: 'OPEN_TASK', taskId: id })} truncated={!!tree?.truncated} />
      </div>
    </div>
  )
}

function Crumb({ onClick, active, children }: { onClick: () => void; active: boolean; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span onClick={onClick} {...hoverProps} style={{ cursor: 'pointer', color: active ? 'var(--t1)' : hover ? 'var(--t1)' : 'var(--t3)', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

/** An agent on the map: a dot on the file it's on now (it moves when the agent does). */
function AgentDot({
  a,
  task,
  color,
  placed,
  zoom,
  files,
  width,
  stack,
  dim,
  onOpen
}: {
  a: MapActivity
  task: Task
  color: string
  placed: Map<string, Placed>
  zoom: string
  files: Map<string, FileState>
  width: number
  stack: number
  dim: boolean
  onOpen: () => void
}): React.JSX.Element | null {
  const target = a.now ?? a.files[0]
  if (!target || (zoom && !target.startsWith(`${zoom}/`))) return null
  const p = placeOf(placed, target)
  if (!p) return null
  const cx = p.rect.x + p.rect.w / 2
  const cy = p.rect.y + Math.min(p.rect.h / 2, (p.header ?? 0) + 18) + stack * 22
  const working = task.st === 'working'
  const what = a.tool ? `${a.tool} ${a.now?.split('/').pop() ?? ''}` : a.now ? a.now.split('/').pop() : 'changed files'
  const clash = files.get(target)?.clash
  // Near the right edge, the label goes on the dot's left.
  const flip = cx > width - 190
  return (
    <div
      onClick={onOpen}
      title={`${task.key} · ${task.title}\n${agentShort(task.agentKind)} ${statusLabel(task.st)} · on ${target}\nClick to open its terminal`}
      style={{ position: 'absolute', left: cx, top: cy, transform: flip ? 'translate(calc(-100% + 6px), -50%)' : 'translate(-6px, -50%)', flexDirection: flip ? 'row-reverse' : 'row', transition: 'left .7s ease, top .7s ease, opacity .3s', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', opacity: dim ? 0.3 : 1, zIndex: 2, pointerEvents: 'auto' }}
    >
      <span style={{ position: 'relative', width: 12, height: 12, flex: 'none' }}>
        {working ? <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, animation: 'sy-map-pulse 1.6s ease-out infinite' }} /> : null}
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color, border: `2px solid ${task.st === 'waiting' || task.st === 'failed' ? statusColor(task.st) : 'var(--bg-app)'}`, boxSizing: 'border-box' }} />
      </span>
      <span style={{ font: `500 11px ${MONO}`, color: 'var(--t1)', background: 'var(--bg-menu)', border: `1px solid ${clash ? 'var(--c-red)' : 'var(--bd-4)'}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', boxShadow: '0 2px 8px color-mix(in srgb, var(--sh) 40%, transparent)' }}>
        {task.key}
        <span style={{ color: 'var(--t3)' }}> · {what}</span>
      </span>
    </div>
  )
}

function Tip({
  hover,
  files,
  folders,
  tasks,
  width
}: {
  hover: { p: Placed; x: number; y: number }
  files: Map<string, FileState>
  folders: Map<string, Set<string>>
  tasks: { a: MapActivity; task: Task; color: string }[]
  width: number
}): React.JSX.Element {
  const { p, x, y } = hover
  const isFile = !p.node.children
  const who = isFile ? (files.get(p.node.path)?.tasks ?? []) : [...(folders.get(p.node.path) ?? [])]
  const clash = isFile && files.get(p.node.path)?.clash
  const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
  const count = (n: typeof p.node): number => (n.children ? n.children.reduce((s, c) => s + count(c), 0) : 1)
  const left = x + 16 + 300 > width ? x - 316 : x + 16
  return (
    <div style={{ position: 'absolute', left, top: y + 14, width: 300, zIndex: 3, pointerEvents: 'none', background: 'var(--bg-menu)', border: '1px solid var(--bd-4)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 8px 24px color-mix(in srgb, var(--sh) 50%, transparent)' }}>
      <div style={{ font: `12px ${MONO}`, color: 'var(--t1)', overflowWrap: 'anywhere' }}>{p.node.path || '/'}{isFile ? '' : '/'}</div>
      <div style={{ font: '11.5px var(--font-ui)', color: 'var(--t3)' }}>
        {isFile ? (p.node.isNew ? 'New file - not on the default branch yet' : `about ${kb(Math.max(0, p.node.size - 800))}`) : `${count(p.node)} files`}
      </div>
      {who.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {who.map((id) => {
            const t = tasks.find((x) => x.a.taskId === id)
            if (!t) return null
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, font: '12px var(--font-ui)', color: 'var(--t2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flex: 'none' }} />
                <span style={{ font: `11.5px ${MONO}`, color: 'var(--t1)' }}>{t.task.key}</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.task.title}</span>
              </div>
            )
          })}
        </div>
      ) : null}
      {clash ? <div style={{ font: '11.5px var(--font-ui)', color: 'var(--c-red)' }}>Their changes here won’t merge cleanly.</div> : who.length > 1 && isFile ? <div style={{ font: '11.5px var(--font-ui)', color: 'var(--c-amber)' }}>Changed by {who.length} tasks - the edits still merge.</div> : null}
      {isFile && who.length ? <div style={{ font: '11px var(--font-ui)', color: 'var(--t4)' }}>Double-click to see the changes</div> : !isFile ? <div style={{ font: '11px var(--font-ui)', color: 'var(--t4)' }}>Click to zoom in</div> : null}
    </div>
  )
}

function Legend({
  tasks,
  focus,
  onFocus,
  onZoom,
  onOpen,
  truncated
}: {
  tasks: { a: MapActivity; task: Task; color: string }[]
  focus: string | null
  onFocus: (id: string | null) => void
  onZoom: (id: string) => void
  onOpen: (id: string) => void
  truncated: boolean
}): React.JSX.Element {
  return (
    <div style={{ borderLeft: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', padding: '0 6px 6px' }}>Agents</div>
        {tasks.length ? (
          tasks.map(({ a, task, color }) => <LegendRow key={a.taskId} a={a} task={task} color={color} active={focus === a.taskId} dim={!!focus && focus !== a.taskId} onEnter={() => onFocus(a.taskId)} onLeave={() => onFocus(null)} onZoom={() => onZoom(a.taskId)} onOpen={() => onOpen(a.taskId)} />)
        ) : (
          <div style={{ font: '12.5px/1.5 var(--font-ui)', color: 'var(--t3)', padding: '0 6px' }}>No task is working in this project right now. Their files light up here as their agents change them.</div>
        )}
      </div>
      <div style={{ flex: 'none', borderTop: '1px solid var(--bd-1)', padding: '10px 20px 12px', display: 'flex', flexDirection: 'column', gap: 5, font: '11.5px var(--font-ui)', color: 'var(--t3)' }}>
        <Key swatch={<span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--c-blue)', opacity: 0.7 }} />}>Changed by one task (its colour)</Key>
        <Key swatch={<span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--c-amber)', opacity: 0.7 }} />}>Changed by several - still merges</Key>
        <Key swatch={<span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--c-red)', opacity: 0.8 }} />}>Changes that won’t merge</Key>
        <Key swatch={<span style={{ width: 10, height: 10, borderRadius: 2, border: '1px dashed var(--t2)', boxSizing: 'border-box' }} />}>New file</Key>
        <div style={{ color: 'var(--t4)', marginTop: 2 }}>Size is how much a file holds. Click to zoom in.{truncated ? ' Only the first 30,000 files are shown.' : ''}</div>
      </div>
    </div>
  )
}

function Key({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'flex', width: 10, justifyContent: 'center' }}>{swatch}</span>
      {children}
    </div>
  )
}

function LegendRow({ a, task, color, active, dim, onEnter, onLeave, onZoom, onOpen }: { a: MapActivity; task: Task; color: string; active: boolean; dim: boolean; onEnter: () => void; onLeave: () => void; onZoom: () => void; onOpen: () => void }): React.JSX.Element {
  const now = a.now ? a.now.split('/').pop() : null
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onZoom}
      onDoubleClick={onOpen}
      title="Hover to light up its files · click to zoom to them · double-click to open it"
      style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr)', columnGap: 9, rowGap: 2, padding: '7px 6px', borderRadius: 5, cursor: 'pointer', background: active ? 'var(--bg-panel)' : 'transparent', opacity: dim ? 0.5 : 1 }}
    >
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 3 }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
        <span style={{ font: `500 12px ${MONO}`, color: 'var(--t1)' }}>{task.key}</span>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</span>
      </div>
      <span />
      <div style={{ font: '11.5px var(--font-ui)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ color: statusColor(task.st) }}>{agentShort(task.agentKind)} {statusLabel(task.st)}</span> · {a.files.length} {a.files.length === 1 ? 'file' : 'files'}
        {now ? ` · ${a.tool ? `${a.tool} ` : 'on '}${now}` : ''}
      </div>
    </div>
  )
}
