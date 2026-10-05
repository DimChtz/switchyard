import React from 'react'
import { useAppStore } from '../../../store/AppStore'
import { useHover } from '../../../lib/useHover'
import { splitGroup, toggleSide } from '../../../lib/wsLayout'
import { addShell, getLayout, resetLayout, setBars, setLayout, useBars } from '../../../lib/wsStore'
import { taskRoot } from '../../../lib/multiRepo'
import { shortcut } from '../../../lib/shortcuts'
import type { Task } from '@shared/types'

/** The header's layout buttons: the left side bar, split right, the right side bar, and back to the first layout. */
export function LayoutButtons({ task }: { task: Task }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const bars = useBars()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '0 6px', margin: '0 2px', borderLeft: '1px solid var(--bd-2)', borderRight: '1px solid var(--bd-2)', flex: 'none' }}>
      <HeadIcon title="Toggle left side bar" onClick={() => setBars((b) => toggleSide(b, 'L'))}>
        <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
        <path d="M5 2v10" />
        <rect x="2" y="2.5" width="2.6" height="9" fill="currentColor" stroke="none" opacity={bars.open.L ? 1 : 0} />
      </HeadIcon>
      <HeadIcon title={`Split editor right${shortcut('ws-split-right') ? ` (${shortcut('ws-split-right')})` : ''}`} onClick={() => splitFocused(task, 'right')}>
        <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
        <path d="M7 2v10" />
      </HeadIcon>
      <HeadIcon title="Toggle right side bar" onClick={() => setBars((b) => toggleSide(b, 'R'))}>
        <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
        <path d="M9 2v10" />
        <rect x="9.4" y="2.5" width="2.6" height="9" fill="currentColor" stroke="none" opacity={bars.open.R ? 1 : 0} />
      </HeadIcon>
      <HeadIcon
        title="Reset workspace layout"
        dim
        onClick={() => {
          resetLayout(task.id)
          dispatch({ type: 'TOAST', text: 'Workspace layout reset.' })
        }}
      >
        <path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" />
        <path d="M3.6 1.6v2.3h2.3" />
      </HeadIcon>
    </div>
  )
}

/** Splits the focused group (⌘\, ⇧⌘\): its tab beside it - or a new terminal when there's nothing to split off. */
export function splitFocused(task: Task, zone: 'right' | 'bottom'): void {
  const L = getLayout(task.id)
  const next = splitGroup(L, L.focus, zone)
  if (next) setLayout(task.id, () => next)
  else addShell(task.id, { taskRoot: taskRoot(task) ?? undefined, beside: { gid: L.focus, zone } })
}

function HeadIcon({ title, onClick, dim, children }: { title: string; onClick: () => void; dim?: boolean; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      onClick={onClick}
      title={title}
      {...hoverProps}
      style={{ width: 26, height: 26, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none', color: hover ? 'var(--t1)' : dim ? 'var(--t-dim)' : 'var(--t2)', background: hover ? 'var(--bg-hover)' : 'transparent' }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  )
}
