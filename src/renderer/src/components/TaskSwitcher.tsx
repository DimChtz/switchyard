import React, { useEffect, useRef } from 'react'
import { useAppStore } from '../store/AppStore'
import { closeSwitcher, moveSwitcher, useSwitcher } from '../lib/taskSwitcher'
import { statusColor, statusLabel, timeAgo } from '../lib/status'
import { agentShort } from '../lib/derive'
import { columnName } from '../lib/boardPrefs'
import { prefsFor } from '../lib/projectPrefs'
import type { Task } from '@shared/types'

/**
 * Ctrl+Tab's list of recent tasks. While Ctrl is held, Tab and Shift+Tab move
 * through it and letting go opens the highlighted task; Enter or a click
 * opens one too, Escape closes it.
 */
export function TaskSwitcher(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const sw = useSwitcher()
  const listRef = useRef<HTMLDivElement>(null)

  const open = (id: string | null): void => {
    const task = id ? state.tasks.find((t) => t.id === id) : null
    if (!task) return
    if (task.scratch) dispatch({ type: 'OPEN_SCRATCH', projectId: task.projectId })
    else dispatch({ type: 'OPEN_TASK', taskId: task.id })
  }
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    if (!sw.open) return
    const onDown = (e: KeyboardEvent): void => {
      const move = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Tab' && !e.ctrlKey ? (e.shiftKey ? -1 : 1) : 0
      if (e.key === 'Enter') openRef.current(closeSwitcher(true))
      else if (e.key === 'Escape') closeSwitcher(false)
      else if (move) moveSwitcher((sw.index + move + sw.ids.length) % sw.ids.length)
      // (Ctrl+Tab goes on to the shortcut, which steps.)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // Letting go of Ctrl opens the highlighted task.
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'Control') openRef.current(closeSwitcher(true))
    }
    const onBlur = (): void => void closeSwitcher(false)
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [sw.open, sw.index, sw.ids.length])

  // The highlighted row stays in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sw.index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sw.index, sw.open])

  if (!sw.open) return null
  const tasks = sw.ids.map((id) => state.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)

  return (
    <div
      onMouseDown={() => closeSwitcher(false)}
      style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', paddingTop: 96, zIndex: 100 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 560,
          alignSelf: 'flex-start',
          background: 'var(--bg-panel)',
          border: '1px solid var(--bd-3)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px color-mix(in srgb, var(--sh) 50%, transparent)'
        }}
      >
        <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--bd-2)', font: '500 11px var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t4)' }}>
          Recent tasks
        </div>
        <div ref={listRef} style={{ maxHeight: 380, overflow: 'auto', padding: 4 }}>
          {tasks.map((t, i) => {
            const project = state.projects.find((p) => p.id === t.projectId)
            const on = i === sw.index
            const current = state.view === 'workspace' && state.taskId === t.id
            const status = t.agentKind && t.st ? statusLabel(t) : ''
            return (
              <div
                key={t.id}
                data-i={i}
                // A real move only: the list appearing under a still pointer doesn't pick a row.
                onMouseMove={(e) => (e.movementX || e.movementY) && i !== sw.index && moveSwitcher(i)}
                onClick={() => open(closeSwitcher(true))}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '8px minmax(0, 1fr) auto',
                  alignItems: 'center',
                  columnGap: 10,
                  padding: '7px 10px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  background: on ? 'color-mix(in srgb, var(--c-blue) 16%, transparent)' : 'transparent'
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: t.scratch ? 1.5 : '50%', background: t.st ? statusColor(t.st) : 'var(--bd-5)' }} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)', flex: 'none' }}>{t.key}</span>
                    <span style={{ font: '13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                    {t.pinnedAt ? <span title="Pinned" style={{ font: '11px var(--font-ui)', color: 'var(--t4)', flex: 'none' }}>pinned</span> : null}
                  </span>
                  <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {project?.name ?? ''}
                    {t.scratch ? '' : ` · ${t.col === 'done' ? 'Done' : columnName(prefsFor(state, t.projectId), t.col)}`}
                    {current ? ' · open now' : ''}
                  </span>
                </div>
                <span style={{ font: '11px var(--font-mono)', color: t.st ? statusColor(t.st) : 'var(--t4)', whiteSpace: 'nowrap' }}>
                  {status ? `${agentShort(t.agentKind)} · ${status}` : t.lastActivityAt ? `${timeAgo(t.lastActivityAt)} ago` : ''}
                </span>
              </div>
            )
          })}
        </div>
        <div style={{ padding: '7px 14px', borderTop: '1px solid var(--bd-2)', font: '11px var(--font-mono)', color: 'var(--t4)', display: 'flex', gap: 14 }}>
          <span>Tab / ⇧Tab move</span>
          <span>release Ctrl or ↵ open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
