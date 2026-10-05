import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { agentShort } from '../lib/derive'
import { timeAgo } from '../lib/status'
import { errText } from '../lib/errors'
import { conflictLabel, conflictMessage, conflictsOf, useConflicts, type TaskConflict } from '../lib/conflicts'
import { Button, Modal } from './ui'
import { AlertAction, AlertLine } from './AlertLine'
import { isMulti, repoDir } from '../lib/multiRepo'
import type { Task } from '@shared/types'
import { baseOf } from '../lib/stack'

/**
 * The task's line in the strip under its header: whom it clashes with
 * (or that only the same files are changed), the files, and the details.
 */
export function ConflictsLine({ task }: { task: Task }): React.JSX.Element | null {
  const { state } = useAppStore()
  const report = useConflicts()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const list = conflictsOf(report, task.id)
  const project = state.projects.find((p) => p.id === task.projectId)
  const label = conflictLabel(list, state.tasks, project ? baseOf(task, project) : 'main')
  if (!label) return null
  const files = [...new Set(list.flatMap((c) => (label.hard ? c.conflicts : c.files)))]
  return (
    <AlertLine color={label.hard ? 'var(--c-red)' : 'var(--c-amber)'} icon={label.hard ? '⚠' : '⇄'} title={label.hard ? 'Its changes won’t merge cleanly' : 'Another running task changes the same files - the edits still merge'}>
      {label.text.charAt(0).toUpperCase() + label.text.slice(1)}
      <span style={{ color: 'var(--t3)', font: '11.5px var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {files.slice(0, 3).join(', ')}
        {files.length > 3 ? ` +${files.length - 3}` : ''}
      </span>
      <AlertAction ref={ref} onClick={() => setOpen((o) => !o)}>
        details
      </AlertAction>
      {open && ref.current ? <ConflictsPanel task={task} list={list} anchor={ref.current} onClose={() => setOpen(false)} /> : null}
    </AlertLine>
  )
}

function ConflictsPanel({ task, list, anchor, onClose }: { task: Task; list: TaskConflict[]; anchor: HTMLElement; onClose: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const report = useConflicts()
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [preview, setPreview] = useState<{ c: TaskConflict; file: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const project = state.projects.find((p) => p.id === task.projectId)
  const base = project ? baseOf(task, project) : 'main'
  const agent = agentShort(task.agentKind) || 'the agent'

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 20, window.innerWidth - 468)) })
  }, [anchor])
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.contains(t) && !document.querySelector('[role=dialog]')?.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])

  const tell = (c: TaskConflict): void => {
    const other = c.other ? state.tasks.find((t) => t.id === c.other) : undefined
    const repo = state.projects.find((p) => p.id === c.repoId)
    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: conflictMessage(c, other, base, isMulti(task) && repo ? repoDir(repo) : ''), toast: `Told ${agent} about it.` })
  }

  return createPortal(
    <div
      ref={panel}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: 460,
        maxHeight: '60vh',
        overflow: 'auto',
        zIndex: 60,
        background: 'var(--bg-menu)',
        border: '1px solid var(--bd-4)',
        borderRadius: 8,
        boxShadow: '0 12px 32px color-mix(in srgb, var(--sh) 45%, transparent)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ font: '12px/1.5 var(--font-ui)', color: 'var(--t3)' }}>
        Other tasks running in parallel change the same files. Uncommitted changes count; merges are tried without touching any worktree.
      </div>
      {list.map((c, i) => {
        const other = c.other ? state.tasks.find((t) => t.id === c.other) : undefined
        const repo = state.projects.find((p) => p.id === c.repoId)
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: i ? 12 : 0, borderTop: i ? '1px solid var(--bd-2)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {c.other ? (
                <span
                  onClick={() => {
                    if (other?.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: other.id })
                    onClose()
                  }}
                  title="Open that task"
                  style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                >
                  <span style={{ font: '12px var(--font-mono)', color: 'var(--t3)' }}>{other?.key ?? c.other}</span> {other?.title ?? ''}
                </span>
              ) : (
                <span style={{ font: '500 12.5px var(--font-ui)', color: 'var(--t1)' }}>The base branch, {base}</span>
              )}
              <span style={{ flex: 1 }} />
              {state.projects.length > 1 && repo ? <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>{repo.name}</span> : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {c.files.map((f) => {
                const hard = c.conflicts.includes(f)
                return (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, font: '12px var(--font-mono)', color: 'var(--t2)', minWidth: 0 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: hard ? 'var(--c-red)' : 'var(--c-amber)' }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>
                      {f}
                    </span>
                    <span style={{ color: hard ? 'var(--c-red)' : 'var(--t4)' }}>{hard ? 'conflict' : 'merges'}</span>
                    {hard ? <TextLink onClick={() => setPreview({ c, file: f })}>preview</TextLink> : null}
                  </div>
                )
              })}
            </div>
            {task.agentKind ? (
              <div>
                <Button size="xs" onClick={() => tell(c)} title={`Send ${agent} what collides and how to see the other side`}>
                  {c.other ? `Tell ${agent}` : `Ask ${agent} to bring in ${base}`}
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '11px var(--font-mono)', color: 'var(--t4)', borderTop: '1px solid var(--bd-2)', paddingTop: 8 }}>
        <span style={{ flex: 1 }}>{report.at ? `checked ${timeAgo(report.at)} ago` : 'not checked yet'}</span>
        <TextLink
          onClick={() => {
            setChecking(true)
            window.api.conflicts
              .scan()
              .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not check: ${errText(err)}` }))
              .finally(() => setChecking(false))
          }}
        >
          {checking ? 'checking…' : 'check now'}
        </TextLink>
      </div>
      {preview ? <ConflictPreview task={task} c={preview.c} file={preview.file} base={base} onClose={() => setPreview(null)} /> : null}
    </div>,
    document.body
  )
}

function TextLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span onClick={onClick} {...hoverProps} style={{ font: '11.5px var(--font-mono)', color: 'var(--c-blue)', cursor: 'pointer', textDecoration: hover ? 'underline' : 'none' }}>
      {children}
    </span>
  )
}

/** The file as the merge would leave it: the clashing parts between conflict markers. */
function ConflictPreview({ task, c, file, base, onClose }: { task: Task; c: TaskConflict; file: string; base: string; onClose: () => void }): React.JSX.Element {
  const { state } = useAppStore()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLDivElement>(null)
  const other = c.other ? state.tasks.find((t) => t.id === c.other) : undefined
  useEffect(() => {
    window.api.conflicts
      .preview(c.repoId, task.id, c.other, file)
      .then(setText)
      .catch((err: unknown) => setError(errText(err)))
  }, [c.repoId, task.id, c.other, file])
  useEffect(() => {
    first.current?.scrollIntoView({ block: 'center' })
  }, [text])
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  const lines = text?.replace(/\r\n/g, '\n').split('\n') ?? []
  let inside: 'ours' | 'theirs' | null = null
  let marked = false
  return (
    <Modal width={860} top={60} kicker={`${task.key} + ${other?.key ?? base} · merged, with conflict markers`} title={file} onClose={onClose}>
      <div style={{ overflow: 'auto', background: 'var(--bg-console)', padding: '8px 0', minHeight: 200 }}>
        {error ? <div style={{ padding: '12px 16px', color: 'var(--c-red)', fontSize: 12.5 }}>{error}</div> : null}
        {text === null && !error ? <div style={{ padding: '12px 16px', color: 'var(--t4)', fontSize: 12.5 }}>Merging…</div> : null}
        {lines.map((l, i) => {
          const marker = /^(<{7}|={7}|>{7})( |$)/.test(l)
          if (l.startsWith('<<<<<<<')) inside = 'ours'
          else if (l.startsWith('=======') && inside) inside = 'theirs'
          const kind = marker ? 'marker' : inside
          if (l.startsWith('>>>>>>>')) inside = null
          const ref = marker && !marked ? ((marked = true), first) : undefined
          return (
            <div
              key={i}
              ref={ref}
              style={{
                display: 'flex',
                gap: 12,
                padding: '0 16px',
                font: '12px/20px var(--font-mono)',
                whiteSpace: 'pre',
                color: kind === 'marker' ? 'var(--c-red)' : kind ? 'var(--t1)' : 'var(--t3)',
                background: kind === 'marker' ? 'color-mix(in srgb, var(--c-red) 12%, transparent)' : kind === 'ours' ? 'color-mix(in srgb, var(--c-blue) 9%, transparent)' : kind === 'theirs' ? 'color-mix(in srgb, var(--c-amber) 9%, transparent)' : 'transparent'
              }}
            >
              <span style={{ width: 34, flex: 'none', textAlign: 'right', color: 'var(--t5)' }}>{i + 1}</span>
              <span>{marker ? (l.startsWith('<') ? `<<<<<<< ${task.key} (this task)` : l.startsWith('>') ? `>>>>>>> ${other?.key ?? base}` : l) : l}</span>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
