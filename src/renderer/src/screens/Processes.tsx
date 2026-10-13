import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { timeAgo } from '../lib/status'
import { errText } from '../lib/errors'
import { plural } from '../lib/summary'
import { Button, Segmented, confirm } from '../components/ui'
import { EmptyState } from '../components/EmptyState'
import { formatMem, headline, sessionKind, shortCmd, type Kind } from '../lib/processView'
import type { ProcessEntry, ProcessGroup, ProcessSnapshot, Project, Task } from '@shared/types'

type Filter = 'all' | 'ports' | 'left'

const KIND_TONE: Record<Kind, string> = {
  agent: 'var(--c-blue)',
  'dev server': 'var(--c-green)',
  tests: 'var(--c-amber)',
  setup: 'var(--c-amber)',
  shell: 'var(--t3)',
  terminal: 'var(--t3)'
}

/** Every process the app's terminals started - agents, shells, dev servers, tests - with ports and memory, and the ones left running. */
export function Processes(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [snap, setSnap] = useState<ProcessSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const busy = useRef(false)

  const load = useCallback(() => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    window.api.pty
      .processes()
      .then(setSnap)
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Couldn't list the processes: ${errText(err)}` }))
      .finally(() => {
        busy.current = false
        setLoading(false)
      })
  }, [dispatch])
  // Now, and every few seconds while it's open.
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const toast = (text: string): void => dispatch({ type: 'TOAST', text })
  const stopSession = async (g: ProcessGroup): Promise<void> => {
    const { kind, task, label } = sessionKind(g.sessionId, state.tasks)
    if (kind === 'agent') {
      const ok = await confirm({
        title: `Stop ${task?.key ?? 'this'} agent?`,
        body: 'It ends where it is - anything it was doing stops. You can start it again from the task.',
        confirmLabel: 'Stop agent',
        danger: true
      })
      if (!ok) return
    }
    await window.api.pty.stopSession(g.sessionId).catch((err: unknown) => toast(errText(err)))
    dispatch({ type: 'TOAST', text: `Stopped ${task ? `${task.key}'s ` : ''}${label}.`, tone: 'done' })
    load()
  }
  const stopPid = async (p: ProcessEntry): Promise<void> => {
    await window.api.pty.stopProcess(p.pid).catch((err: unknown) => toast(errText(err)))
    load()
  }
  const stopLeft = async (): Promise<void> => {
    const left = snap?.orphans ?? []
    for (const o of left) if (o.procs[0]) await window.api.pty.stopProcess(o.procs[0].pid).catch(() => {})
    dispatch({ type: 'TOAST', text: `Stopped ${plural(left.length, 'process tree')} left running.`, tone: 'done' })
    load()
  }
  const toggle = (id: string): void =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const groups = snap?.groups ?? []
  const orphans = snap?.orphans ?? []
  const allPorts = [...new Set([...groups, ...orphans].flatMap((g) => g.ports))].sort((a, b) => a - b)
  const procCount = groups.reduce((n, g) => n + g.procs.length, 0) + orphans.reduce((n, o) => n + o.procs.length, 0)
  const mem = groups.reduce((n, g) => n + g.mem, 0) + orphans.reduce((n, o) => n + o.mem, 0)

  // By task (then the terminals that aren't a task's), newest task activity first.
  const shown = groups.filter((g) => (filter === 'ports' ? g.ports.length > 0 : filter === 'left' ? false : true))
  const byTask = new Map<string, { task: Task | null; project: Project | null; groups: ProcessGroup[] }>()
  for (const g of shown) {
    const { task } = sessionKind(g.sessionId, state.tasks)
    const key = task?.id ?? ''
    const entry = byTask.get(key) ?? { task, project: state.projects.find((p) => p.id === task?.projectId) ?? null, groups: [] }
    entry.groups.push(g)
    byTask.set(key, entry)
  }
  const order: Record<Kind, number> = { agent: 0, 'dev server': 1, tests: 2, setup: 3, shell: 4, terminal: 5 }
  for (const e of byTask.values()) e.groups.sort((a, b) => order[sessionKind(a.sessionId, state.tasks).kind] - order[sessionKind(b.sessionId, state.tasks).kind] || a.startedAt - b.startedAt)
  const sections = [...byTask.values()].sort((a, b) => (a.task ? 0 : 1) - (b.task ? 0 : 1) || (a.task?.key ?? '').localeCompare(b.task?.key ?? '', undefined, { numeric: true }))
  const showOrphans = filter !== 'ports' && orphans.length > 0
  const shownOrphans = filter === 'ports' ? [] : orphans

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '28px 32px 40px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: '600 20px var(--font-ui)', color: 'var(--t1)' }}>Processes</span>
          <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t3)' }}>
            {!snap
              ? 'Reading them…'
              : `${plural(groups.length, 'terminal')} · ${plural(procCount, 'process', 'processes')} · ${formatMem(mem)}${allPorts.length ? ` · listening on ${allPorts.join(', ')}` : ''}`}
          </span>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'All'],
            ['ports', <span key="p">Listening{allPorts.length ? ` ${allPorts.length}` : ''}</span>],
            ['left', <span key="l">Left running{orphans.length ? ` ${orphans.length}` : ''}</span>]
          ]}
        />
        <Button size="sm" disabled={loading} onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {snap?.error ? <Note tone="var(--c-amber)">Couldn&apos;t read the system&apos;s process list ({snap.error}) - only the terminals are shown.</Note> : null}

      {showOrphans || filter === 'left' ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SectionHead
            title="Left running"
            sub={orphans.length ? 'still running after their terminal closed' : ''}
            right={
              orphans.length > 1 ? (
                <Button size="xs" tone="danger" onClick={stopLeft}>
                  Stop all {orphans.length}
                </Button>
              ) : null
            }
          />
          {!shownOrphans.length ? <Empty text="Nothing was left running." /> : null}
          {shownOrphans.map((o) => {
            const { task, label } = sessionKind(o.sessionId, state.tasks)
            const root = o.procs[0]
            if (!root) return null
            const id = `orphan:${root.pid}`
            return (
              <Row
                key={id}
                tone="var(--c-amber)"
                kind="left running"
                title={`${task ? `${task.key} · ` : ''}from its ${label}`}
                cmd={headline(o.procs) || root.name}
                ports={o.ports}
                mem={o.mem}
                since={null}
                procs={o.procs}
                expanded={open.has(id)}
                onToggle={() => toggle(id)}
                onOpen={task ? () => dispatch({ type: 'OPEN_TASK', taskId: task.id }) : undefined}
                onStop={() => stopPid(root)}
                onStopPid={stopPid}
                stopAll
              />
            )
          })}
        </section>
      ) : null}

      {filter !== 'left' ? (
        <>
          {snap && !sections.length && filter === 'ports' ? <Empty text="Nothing is listening on a port." /> : null}
          {snap && !sections.length && filter === 'all' ? (
            <EmptyState title="Nothing running">
              Agents, shells, dev servers and test runs you start in tasks show up here, with the ports they listen on and the memory they use - and anything still running after its terminal closed, to stop.
            </EmptyState>
          ) : null}
          {sections.map((s) => (
            <section key={s.task?.id ?? 'other'} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <SectionHead
                title={s.task ? `${s.task.key} · ${s.task.title}` : 'Other terminals'}
                sub={s.project?.name ?? ''}
                onTitle={s.task ? () => dispatch({ type: 'OPEN_TASK', taskId: s.task!.id }) : undefined}
              />
              {s.groups.map((g) => {
                const { kind, label } = sessionKind(g.sessionId, state.tasks)
                return (
                  <Row
                    key={g.sessionId}
                    tone={KIND_TONE[kind]}
                    kind={label}
                    title={null}
                    cmd={headline(g.procs) || g.cwd}
                    ports={g.ports}
                    mem={g.mem}
                    since={g.startedAt}
                    procs={g.procs}
                    expanded={open.has(g.sessionId)}
                    onToggle={() => toggle(g.sessionId)}
                    onOpen={s.task ? () => dispatch({ type: 'OPEN_TASK', taskId: s.task!.id }) : undefined}
                    onStop={() => stopSession(g)}
                    onStopPid={stopPid}
                  />
                )
              })}
            </section>
          ))}
        </>
      ) : null}
    </div>
  )
}

function Note({ tone, children }: { tone: string; children: React.ReactNode }): React.JSX.Element {
  return <div style={{ padding: '8px 12px', borderRadius: 6, font: '12.5px var(--font-ui)', color: 'var(--t1)', background: `color-mix(in srgb, ${tone} 10%, transparent)` }}>{children}</div>
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return <div style={{ padding: '8px 4px', font: '12.5px var(--font-ui)', color: 'var(--t4)' }}>{text}</div>
}

function SectionHead({ title, sub, right, onTitle }: { title: string; sub: string; right?: React.ReactNode; onTitle?: () => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 4px 4px', borderBottom: '1px solid var(--bd-1)', minWidth: 0 }}>
      <span
        onClick={onTitle}
        title={onTitle ? 'Open the task' : undefined}
        style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)', cursor: onTitle ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
      >
        {title}
      </span>
      <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', flex: 1 }}>{sub}</span>
      {right}
    </div>
  )
}

function PortLink({ port }: { port: number }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      {...hoverProps}
      onClick={(e) => {
        e.stopPropagation()
        window.api.sys.openExternal(`http://localhost:${port}`)
      }}
      title={`Open http://localhost:${port} in the browser`}
      style={{
        padding: '1px 7px',
        borderRadius: 4,
        font: '11px var(--font-mono)',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        color: 'var(--c-green)',
        background: `color-mix(in srgb, var(--c-green) ${hover ? 22 : 13}%, transparent)`
      }}
    >
      :{port} ↗
    </span>
  )
}

function Row({
  tone,
  kind,
  title,
  cmd,
  ports,
  mem,
  since,
  procs,
  expanded,
  onToggle,
  onOpen,
  onStop,
  onStopPid,
  stopAll
}: {
  tone: string
  kind: string
  title: string | null
  cmd: string
  ports: number[]
  mem: number
  since: number | null
  procs: ProcessEntry[]
  expanded: boolean
  onToggle: () => void
  onOpen?: () => void
  onStop: () => void
  onStopPid: (p: ProcessEntry) => void
  /** Stop ends the whole tree (a left-running one) - no per-process stops needed below. */
  stopAll?: boolean
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        {...hoverProps}
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '14px 104px minmax(0,1fr) auto',
          alignItems: 'center',
          columnGap: 10,
          padding: '7px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          background: hover ? 'var(--bg-menu)' : 'transparent'
        }}
      >
        <span style={{ color: 'var(--t4)', font: '10px var(--font-mono)', transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms', textAlign: 'center' }}>▶</span>
        <span style={{ justifySelf: 'start', padding: '1px 7px', borderRadius: 4, font: '11px var(--font-mono)', whiteSpace: 'nowrap', color: tone, background: `color-mix(in srgb, ${tone} 13%, transparent)` }}>{kind}</span>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {title ? <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span> : null}
          <span title={cmd} style={{ font: '12px var(--font-mono)', color: title ? 'var(--t3)' : 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cmd}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {ports.map((p) => (
            <PortLink key={p} port={p} />
          ))}
          <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap' }} title={`${plural(procs.length, 'process', 'processes')}, ${formatMem(mem)} in memory`}>
            {procs.length > 1 ? `${procs.length} procs · ` : ''}
            {formatMem(mem)}
            {since ? ` · ${timeAgo(since)}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 6, opacity: hover ? 1 : 0.6 }} onClick={(e) => e.stopPropagation()}>
            {onOpen ? (
              <Button size="xs" onClick={onOpen}>
                Open task
              </Button>
            ) : null}
            <Button size="xs" tone="danger" onClick={onStop} title="End it and everything it started">
              Stop
            </Button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div style={{ margin: '0 8px 6px 32px', padding: '4px 0', borderLeft: '1px solid var(--bd-2)' }}>
          {procs.length ? null : <div style={{ padding: '4px 12px', font: '12px var(--font-ui)', color: 'var(--t4)' }}>Its processes couldn&apos;t be read.</div>}
          {procs.map((p) => (
            <ProcRow key={p.pid} p={p} onStop={!stopAll && p.depth > 0 ? () => onStopPid(p) : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ProcRow({ p, onStop }: { p: ProcessEntry; onStop?: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      {...hoverProps}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', columnGap: 10, padding: '3px 8px 3px 12px', borderRadius: 4, background: hover ? 'var(--bg-menu)' : 'transparent' }}
    >
      <span title={p.cmd} style={{ paddingLeft: Math.min(p.depth, 8) * 14, font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span style={{ color: 'var(--t1)' }}>{p.name}</span> <span style={{ color: 'var(--t5)' }}>{p.pid}</span> {p.cmd && p.cmd !== p.name ? shortCmd(p.cmd) : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {p.ports.map((port) => (
          <PortLink key={port} port={port} />
        ))}
        <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>{formatMem(p.mem)}</span>
        {onStop ? (
          <Button size="xs" variant="ghost" tone="danger" onClick={onStop} title="End this process and what it started" style={{ visibility: hover ? 'visible' : 'hidden' }}>
            Stop
          </Button>
        ) : null}
      </span>
    </div>
  )
}
