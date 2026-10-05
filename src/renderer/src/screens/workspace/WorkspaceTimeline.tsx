import React, { useEffect, useMemo, useState } from 'react'
import { plural } from '../../lib/summary'
import { useAppStore } from '../../store/AppStore'
import { useHover } from '../../lib/useHover'
import { agentShort } from '../../lib/derive'
import { timeAgo } from '../../lib/status'
import { errText } from '../../lib/errors'
import { Button, confirm } from '../../components/ui'
import { costOf, formatCost } from '@shared/usage'
import type { Checkpoint, FileDiff, Task } from '@shared/types'

/** The checkpoint's name: "Turn 3", "Session started", "Before rewinding to turn 2". */
function nameOf(c: Checkpoint, all: Checkpoint[]): string {
  if (c.kind === 'turn') return `Turn ${c.turn}`
  if (c.kind === 'start') return 'Session started'
  const to = all.find((x) => x.id === c.rewoundTo)
  if (to?.kind === 'rewind') return 'Undid a rewind'
  return `Rewound to ${to ? nameOf(to, all).replace(/^Turn/, 'turn').replace(/^Session started/, 'the start') : 'a checkpoint'}`
}

/**
 * The task's timeline: a checkpoint of its files when the agent's session
 * started and after each turn - what it was asked, what it said, what it
 * changed and cost. Rewind puts the files back as they were at one; what's
 * there is saved first, so a rewind can be undone.
 */
export function WorkspaceTimeline({ task, active }: { task: Task; active: boolean }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [list, setList] = useState<Checkpoint[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ id: string; files: FileDiff[] } | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // After a rewind: a message for the agent, to say so.
  const [tell, setTell] = useState<string | null>(null)
  const agent = agentShort(task.agentKind) || 'the agent'

  useEffect(() => {
    if (!active) return
    const load = (): void => {
      window.api.checkpoints
        .list(task.id)
        .then(setList)
        .catch(() => setList([]))
    }
    load()
    return window.api.checkpoints.onChanged((id) => id === task.id && load())
  }, [task.id, active])

  const newest = useMemo(() => [...(list ?? [])].reverse(), [list])
  const current = (list ?? []).find((c) => c.id === selected) ?? newest[0] ?? null

  // The selected checkpoint's changes.
  useEffect(() => {
    if (!current) return setDiff(null)
    let cancelled = false
    window.api.checkpoints
      .diff(task.id, current.id)
      .then((files) => {
        if (cancelled) return
        setDiff({ id: current.id, files })
        setFile((f) => (f && files.some((x) => x.path === f) ? f : (files[0]?.path ?? null)))
      })
      .catch(() => !cancelled && setDiff({ id: current.id, files: [] }))
    return () => {
      cancelled = true
    }
  }, [task.id, current?.id, current])

  const costOfCp = (c: Checkpoint): number | null => {
    if (!c.tokens) return null
    let sum = 0
    for (const [model, t] of Object.entries(c.tokens)) sum += costOf(t, model, state.prefs.modelPrices) ?? 0
    return sum
  }

  const rewind = async (c: Checkpoint): Promise<void> => {
    if (busy || !list) return
    const name = nameOf(c, list)
    const later = list.slice(list.indexOf(c) + 1).filter((x) => x.kind === 'turn')
    const ok = await confirm({
      title: c.kind === 'rewind' ? 'Undo the rewind?' : `Rewind the files to ${c.kind === 'start' ? 'the session’s start' : `after ${name.toLowerCase()}`}?`,
      body:
        c.kind === 'rewind'
          ? 'The files go back to how they were just before it.'
          : `${later.length ? `What ${agent} changed in ${later.length === 1 ? `turn ${later[0].turn}` : `turns ${later[0].turn}-${later[later.length - 1].turn}`} is undone` : 'The files go back'}. What’s there now is saved first, so you can undo this. Commits stay on the branch.`,
      confirmLabel: 'Rewind'
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await window.api.checkpoints.rewind(task.id, c.id)
      dispatch({
        type: 'TOAST',
        text: `${c.kind === 'rewind' ? 'Undid the rewind' : `Rewound to ${name.toLowerCase()}`} · ${r.restored} file${r.restored === 1 ? '' : 's'} restored${r.removed ? `, ${r.removed} removed` : ''}${r.headMoved.length ? ` · commits since stay on ${task.branch}` : ''}`,
        tone: 'done'
      })
      setSelected(r.checkpoint.id)
      if (task.agentKind && c.kind !== 'rewind')
        setTell(`I rewound the files to how they were ${c.kind === 'start' ? 'when this session started' : `after ${name.toLowerCase()}`} - your changes since are gone. `)
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not rewind: ${errText(err)}` })
    } finally {
      setBusy(false)
    }
  }

  // Undo last turn: when the newest checkpoint is a turn (after a rewind, undo that instead).
  const lastTurn = newest[0]?.kind === 'turn' ? newest[0] : undefined
  const beforeLast = lastTurn && list ? list[list.indexOf(lastTurn) - 1] : undefined
  const activeFile = diff?.id === current?.id ? (diff?.files.find((f) => f.path === file) ?? null) : null

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '380px 1fr' }}>
      <div style={{ borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--bd-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: '12.5px var(--font-mono)', color: 'var(--t2)', flex: 1 }}>
              {list === null ? 'Loading…' : `${plural(list.filter((c) => c.kind === 'turn').length, 'turn')} · ${plural(list.length, 'checkpoint')}`}
            </span>
            <Button
              size="sm"
              disabled={!beforeLast || busy}
              onClick={() => beforeLast && rewind(beforeLast)}
              title={lastTurn ? `Put the files back as they were before turn ${lastTurn.turn}` : 'No turn to undo yet'}
            >
              Undo last turn
            </Button>
          </div>
          {tell != null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px solid color-mix(in srgb, var(--c-blue) 40%, transparent)', borderRadius: 6, background: 'color-mix(in srgb, var(--c-blue) 5%, transparent)' }}>
              <span style={{ font: '11.5px var(--font-mono)', color: 'var(--c-blue)' }}>Tell {agent} - it still thinks its changes are there</span>
              <textarea
                autoFocus
                value={tell}
                onChange={(e) => setTell(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && tell.trim()) {
                    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: tell, toast: `Sent to ${agent}.` })
                    setTell(null)
                  }
                  if (e.key === 'Escape') setTell(null)
                }}
                rows={3}
                style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 5, padding: '6px 8px', font: '12.5px/1.45 var(--font-ui)', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button size="sm" onClick={() => setTell(null)}>
                  Don’t
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!tell.trim()}
                  onClick={() => {
                    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: tell, toast: `Sent to ${agent}.` })
                    setTell(null)
                  }}
                >
                  Send to {agent}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 8px 16px' }}>
          {list && !list.length ? (
            <div style={{ padding: '24px 10px', font: '12.5px/1.55 var(--font-ui)', color: 'var(--t4)' }}>
              No checkpoints yet. The files are saved when {agent} starts and after each of its turns - then you can see what every turn changed, and rewind to any of them.
            </div>
          ) : null}
          {newest.map((c, i) => (
            <TimelineRow
              key={c.id}
              c={c}
              name={list ? nameOf(c, list) : ''}
              agent={agent}
              latest={i === 0}
              last={i === newest.length - 1}
              selected={current?.id === c.id}
              cost={costOfCp(c)}
              busy={busy}
              onSelect={() => setSelected(c.id)}
              onRewind={() => rewind(c)}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {current ? (
          <>
            <div style={{ flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--bd-1)', minHeight: 44, boxSizing: 'border-box' }}>
              <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)', marginRight: 6 }}>{list ? nameOf(current, list) : ''}</span>
              {diff?.id !== current.id ? (
                <span style={{ font: '12px var(--font-mono)', color: 'var(--t4)' }}>Loading…</span>
              ) : !diff.files.length ? (
                <span style={{ font: '12px var(--font-mono)', color: 'var(--t4)' }}>{current.kind === 'start' ? 'The files when the session started' : current.kind === 'rewind' ? 'The files were already like that' : 'No file changed'}</span>
              ) : (
                diff.files.map((f) => (
                  <span
                    key={f.path}
                    onClick={() => setFile(f.path)}
                    title={f.path}
                    style={{
                      height: 22,
                      padding: '0 8px',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      font: '11.5px var(--font-mono)',
                      cursor: 'pointer',
                      color: f.path === file ? 'var(--t1)' : 'var(--t2)',
                      background: f.path === file ? 'var(--bg-panel-3)' : 'transparent',
                      border: `1px solid ${f.path === file ? 'var(--bd-5)' : 'var(--bd-2)'}`,
                      textDecoration: f.status === 'deleted' ? 'line-through' : 'none'
                    }}
                  >
                    {f.path.split('/').pop()}
                    <span style={{ color: 'var(--c-green)' }}>+{f.added}</span>
                    <span style={{ color: 'var(--c-red)' }}>-{f.deleted}</span>
                  </span>
                ))
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-console)', padding: '8px 0' }}>
              {activeFile ? (
                <>
                  <div style={{ padding: '0 16px 6px', font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>
                    {activeFile.path}
                    {activeFile.status !== 'modified' ? ` · ${activeFile.status}` : ''}
                  </div>
                  {activeFile.lines.length ? (
                    activeFile.lines.map((l, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 12,
                          padding: '0 16px',
                          font: '12px/20px var(--font-mono)',
                          background: l.kind === '+' ? 'color-mix(in srgb, var(--c-green) 8%, transparent)' : l.kind === '-' ? 'color-mix(in srgb, var(--c-red) 8%, transparent)' : 'transparent',
                          color: l.kind === '@' ? 'var(--c-blue)' : l.kind === '+' ? 'var(--c-green)' : l.kind === '-' ? 'var(--c-red)' : 'var(--t2)'
                        }}
                      >
                        <span style={{ width: 34, flex: 'none', textAlign: 'right', color: 'var(--t5)' }}>{l.kind === '-' ? l.oldLine : (l.newLine ?? '')}</span>
                        <span style={{ width: 10, flex: 'none', opacity: 0.7 }}>{l.kind === ' ' || l.kind === '@' ? '' : l.kind}</span>
                        <span style={{ whiteSpace: 'pre-wrap' }}>{l.text}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '6px 16px', color: 'var(--t4)', fontSize: 12.5 }}>Binary file or no textual change.</div>
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t4)', fontSize: 13 }}>{list === null ? 'Loading…' : 'Nothing to show yet'}</div>
        )}
      </div>
    </div>
  )
}

function TimelineRow({
  c,
  name,
  agent,
  latest,
  last,
  selected,
  cost,
  busy,
  onSelect,
  onRewind
}: {
  c: Checkpoint
  name: string
  agent: string
  latest: boolean
  last: boolean
  selected: boolean
  cost: number | null
  busy: boolean
  onSelect: () => void
  onRewind: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const added = c.files.reduce((n, f) => n + f.added, 0)
  const deleted = c.files.reduce((n, f) => n + f.deleted, 0)
  const color = c.kind === 'turn' ? 'var(--c-blue)' : c.kind === 'rewind' ? 'var(--c-amber)' : 'var(--t4)'
  return (
    <div onClick={onSelect} {...hoverProps} style={{ display: 'flex', gap: 10, cursor: 'pointer' }}>
      {/* The line down the timeline, and this checkpoint's dot on it. */}
      <div style={{ width: 14, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: 1, height: 14, background: latest ? 'transparent' : 'var(--bd-3)' }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', background: selected ? color : 'var(--bg-app)', border: `2px solid ${color}`, boxSizing: 'border-box' }} />
        <span style={{ width: 1, flex: 1, background: last ? 'transparent' : 'var(--bd-3)' }} />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          margin: '4px 0',
          padding: '7px 10px',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          background: selected ? 'var(--bg-panel-3)' : hover ? 'var(--bg-hover)' : 'transparent'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)' }}>{name}</span>
          <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>{timeAgo(c.at)} ago</span>
          <span style={{ flex: 1 }} />
          {cost != null ? (
            <span title="What the turn cost, at API prices" style={{ font: '11px var(--font-mono)', color: 'var(--t3)' }}>
              {formatCost(cost)}
            </span>
          ) : null}
          {c.files.length ? (
            <span style={{ font: '11px var(--font-mono)', color: 'var(--t3)' }}>
              {c.files.length}f <span style={{ color: 'var(--c-green)' }}>+{added}</span> <span style={{ color: 'var(--c-red)' }}>-{deleted}</span>
            </span>
          ) : null}
        </div>
        {c.prompt ? <Quote who="you" text={c.prompt} lines={2} /> : null}
        {c.said ? <Quote who={agent} text={c.said} lines={3} accent /> : null}
        {(hover || selected) && !(latest && c.kind !== 'rewind') ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <Button
              size="xs"
              title={c.kind === 'rewind' ? 'Put the files back as they were before this rewind' : 'Put the files back as they were here'}
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                onRewind()
              }}
            >
              {c.kind === 'rewind' ? '↶ Undo this rewind' : '↶ Rewind here'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Quote({ who, text, lines, accent }: { who: string; text: string; lines: number; accent?: boolean }): React.JSX.Element {
  return (
    <div
      title={text}
      style={{
        font: '12px/1.45 var(--font-ui)',
        color: accent ? 'var(--t2)' : 'var(--t3)',
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        overflowWrap: 'anywhere'
      }}
    >
      <span style={{ font: '11px var(--font-mono)', color: accent ? 'var(--c-blue)' : 'var(--t4)' }}>{who} </span>
      {text}
    </div>
  )
}
