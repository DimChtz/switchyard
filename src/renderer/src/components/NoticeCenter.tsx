import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { clearNotices, markRead, useNotices } from '../lib/notices'
import { actOnUpdate, useUpdate } from '../lib/updates'
import { shortcut } from '../lib/shortcuts'
import type { Notice } from '@shared/types'

const COLOR: Record<Notice['kind'], string> = {
  waiting: 'var(--c-amber)',
  permission: 'var(--c-amber)',
  failed: 'var(--c-red)',
  done: 'var(--c-green)',
  'tests-passed': 'var(--c-green)',
  'tests-failed': 'var(--c-red)',
  finished: 'var(--c-blue)',
  'pr-merged': 'var(--c-blue)',
  spend: 'var(--c-amber)',
  'review-reply': 'var(--c-blue)',
  'agent-question': 'var(--c-amber)',
  team: 'var(--c-amber)',
  limit: 'var(--c-blue)',
  pr: 'var(--c-amber)',
  update: 'var(--c-green)'
}

function ago(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h`
  return `${Math.round(d / 86_400_000)}d`
}

/**
 * The bell in the status bar and its panel: what agents and tasks did -
 * needs you, failed, finished, tests, merges - newest first. Opening it
 * marks them read; a click opens the task.
 */
export function NoticeBell(): React.JSX.Element {
  const notices = useNotices()
  const [open, setOpen] = useState(false)
  const [hover, hoverProps] = useHover()
  const close = useCallback(() => setOpen(false), [])
  const unread = notices.filter((n) => !n.read).length
  const needsYou = notices.some((n) => !n.read && (n.kind === 'failed' || n.kind === 'permission' || n.kind === 'waiting' || n.kind === 'tests-failed' || n.kind === 'agent-question'))

  useEffect(() => {
    const on = (): void => setOpen((o) => !o)
    window.addEventListener('switchyard:notices', on)
    return () => window.removeEventListener('switchyard:notices', on)
  }, [])

  return (
    <>
      <span
        onClick={() => setOpen((o) => !o)}
        {...hoverProps}
        title={`Notifications${shortcut('notifications') ? ` (${shortcut('notifications')})` : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: open || hover ? 'var(--t1)' : unread ? 'var(--t2)' : 'var(--t4)' }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 10.2V6.3a3.5 3.5 0 0 1 7 0v3.9l1 1.1h-9z" />
          <path d="M5.8 12.4a1.3 1.3 0 0 0 2.4 0" />
        </svg>
        {unread ? (
          <span style={{ font: '600 10.5px/15px var(--font-mono)', padding: '0 5px', borderRadius: 3, color: 'var(--bg-chrome)', background: needsYou ? 'var(--c-amber)' : 'var(--c-blue)' }}>{unread}</span>
        ) : null}
      </span>
      {open ? <NoticePanel onClose={close} /> : null}
    </>
  )
}

function NoticePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const notices = useNotices()
  const ref = useRef<HTMLDivElement>(null)
  // What was unread when it opened stays marked as new while it's open.
  const [fresh] = useState(() => new Set(notices.filter((n) => !n.read).map((n) => n.id)))
  const update = useUpdate()

  // Seen once it's open.
  useEffect(() => markRead(), [])
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[title^="Notifications"]')) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  const openTask = (n: Notice): void => {
    // A new version: install it (or get it), while it's the one waiting.
    if (n.kind === 'update') {
      onClose()
      if (update && n.text.includes(update.version)) actOnUpdate(update)
      else dispatch({ type: 'TOAST', text: 'That update is installed, or a newer one replaced it.' })
      return
    }
    if (n.kind === 'spend' || n.kind === 'team') {
      dispatch({ type: 'NAV', view: n.kind === 'spend' ? 'usage' : 'team' })
      return onClose()
    }
    const t = state.tasks.find((x) => x.id === n.taskId)
    if (!t) return dispatch({ type: 'TOAST', text: `${n.taskKey} isn't around any more.` })
    if (t.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: t.id, tab: n.kind === 'review-reply' ? 'changes' : undefined })
    else {
      dispatch({ type: 'NAV', view: 'board', projectId: t.projectId })
      dispatch({ type: 'SET_BOARD_FOCUS', id: t.id })
    }
    onClose()
  }

  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const groups: [string, Notice[]][] = [
    ['Today', notices.filter((n) => n.at >= startOfToday)],
    ['Earlier', notices.filter((n) => n.at < startOfToday)]
  ]

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        right: 12,
        bottom: 32,
        width: 400,
        maxHeight: '62vh',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-menu)',
        border: '1px solid var(--bd-4)',
        borderRadius: 8,
        boxShadow: '0 12px 32px color-mix(in srgb, var(--sh) 45%, transparent)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--bd-2)' }}>
        <span style={{ font: '600 13px var(--font-ui)', color: 'var(--t1)', flex: 1 }}>Notifications</span>
        {notices.length ? (
          <span onClick={clearNotices} style={{ font: '12px var(--font-ui)', color: 'var(--t3)', cursor: 'pointer' }}>
            Clear all
          </span>
        ) : null}
      </div>
      <div style={{ overflow: 'auto', padding: '4px 0 6px' }}>
        {!notices.length ? (
          <div style={{ padding: '22px 16px', font: '12.5px/1.5 var(--font-ui)', color: 'var(--t3)', textAlign: 'center' }}>
            Nothing yet. When an agent needs you, fails or finishes - or tests run and branches merge - it shows up here.
          </div>
        ) : (
          groups
            .filter(([, list]) => list.length)
            .map(([label, list]) => (
              <div key={label}>
                <div style={{ padding: '8px 14px 4px', font: '500 10.5px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }}>{label}</div>
                {list.map((n) => (
                  <NoticeRow key={n.id} n={n} fresh={fresh.has(n.id)} onClick={() => openTask(n)} />
                ))}
              </div>
            ))
        )}
      </div>
    </div>
  )
}

function NoticeRow({ n, fresh, onClick }: { n: Notice; fresh: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div onClick={onClick} {...hoverProps} style={{ display: 'flex', gap: 10, padding: '7px 14px', cursor: 'pointer', background: hover ? 'var(--bg-hover)' : 'transparent' }}>
      <span style={{ width: 7, height: 7, marginTop: 5, borderRadius: '50%', flex: 'none', background: COLOR[n.kind] }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ font: `${fresh ? 600 : 400} 12.5px var(--font-ui)`, color: 'var(--t1)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</span>
          <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', flex: 'none' }}>{ago(n.at)}</span>
        </div>
        {n.taskKey ? (
          <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {n.taskKey} · {n.taskTitle}
          </span>
        ) : null}
        {n.detail ? <span style={{ font: '12px/1.4 var(--font-ui)', color: 'var(--t2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{n.detail}</span> : null}
      </div>
    </div>
  )
}
