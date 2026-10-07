import React, { useState } from 'react'
import { useHover } from '../../../lib/useHover'
import { moveView, toggleView, type Side, type SideBars, type ViewId } from '../../../lib/wsLayout'
import { getBars, setBars, setDrag, useDrag } from '../../../lib/wsStore'
import { shortcut } from '../../../lib/shortcuts'
import { dragWith } from './EditorArea'
import type { PanelChrome } from './PanelHeader'

export const VIEW_LABEL: Record<ViewId, string> = { task: 'Task', explorer: 'Explorer', search: 'Search', changes: 'Changes', notes: 'Notes', sessions: 'Sessions', activity: 'Activity' }
const VIEW_KEY: Partial<Record<ViewId, string>> = { explorer: 'ws-files', search: 'search-files', changes: 'ws-changes', notes: 'ws-notes' }

/** The icons down one side (VS Code's activity bar): click to show a view, drag to reorder or to the other side. */
export function ActivityStrip({ side, bars, badges }: { side: Side; bars: SideBars; badges: Partial<Record<ViewId, number>> }): React.JSX.Element | null {
  const drag = useDrag()
  const [over, setOver] = useState<{ before: ViewId | null } | null>(null)
  const viewDrag = drag?.type === 'view' ? drag : null
  // A side with no views has no strip, except while a view is dragged (so it can be dropped back there).
  if (!viewDrag && !bars.views.some((v) => v[1] === side)) return null
  const drop = (before: ViewId | null, e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setOver(null)
    if (viewDrag) setBars((b) => moveView(b, viewDrag.id, side, before))
    setDrag(null)
  }
  return (
    <div
      onDragOver={(e) => {
        if (!viewDrag) return
        e.preventDefault()
        if (over?.before !== null) setOver({ before: null })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null)
      }}
      onDrop={(e) => drop(null, e)}
      style={{
        order: side === 'L' ? 0 : 4,
        width: 42,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 4,
        background: 'var(--bg-chrome)',
        borderRight: side === 'L' ? '1px solid var(--bd-1)' : 'none',
        borderLeft: side === 'R' ? '1px solid var(--bd-1)' : 'none',
        boxShadow: over ? 'inset 0 0 0 1px color-mix(in srgb, var(--c-blue) 45%, transparent)' : 'none'
      }}
    >
      {bars.views
        .filter((v) => v[1] === side)
        .map(([id]) => (
          <StripIcon
            key={id}
            id={id}
            side={side}
            open={bars.open[side] === id}
            badge={badges[id]}
            dropBefore={over?.before === id}
            onOver={(e) => {
              if (!viewDrag) return
              e.preventDefault()
              e.stopPropagation()
              if (over?.before !== id) setOver({ before: id })
            }}
            onDrop={(e) => drop(id, e)}
          />
        ))}
    </div>
  )
}

function StripIcon({ id, side, open, badge, dropBefore, onOver, onDrop }: { id: ViewId; side: Side; open: boolean; badge?: number; dropBefore: boolean; onOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const key = VIEW_KEY[id] ? shortcut(VIEW_KEY[id]!) : ''
  const shadows = [open ? (side === 'L' ? 'inset 2px 0 0 var(--t1)' : 'inset -2px 0 0 var(--t1)') : '', dropBefore ? 'inset 0 2px 0 var(--c-blue)' : ''].filter(Boolean).join(',')
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        setTimeout(() => setDrag({ type: 'view', id }), 0)
      }}
      onDragEnd={() => setDrag(null)}
      onDragOver={onOver}
      onDrop={onDrop}
      onClick={() => setBars((b) => toggleView(b, id))}
      title={`${VIEW_LABEL[id]}${key ? ` (${key})` : ''} - drag to reorder or move to the other side bar`}
      {...hoverProps}
      style={{ width: 42, height: 42, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', color: open || hover ? 'var(--t1)' : 'var(--t3)', cursor: 'pointer', boxShadow: shadows || 'none' }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[id]}
      </svg>
      {badge ? (
        <span style={{ position: 'absolute', right: 5, bottom: 6, minWidth: 15, height: 15, padding: '0 4px', boxSizing: 'border-box', borderRadius: 8, background: 'var(--c-blue)', color: 'var(--bg-app)', font: '600 9.5px/15px var(--font-mono)', textAlign: 'center' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </div>
  )
}

const ICONS: Record<ViewId, React.ReactNode> = {
  task: (
    <>
      <rect x="3.5" y="3" width="11" height="13" rx="1.5" />
      <path d="M6.5 3V1.8h5V3" />
      <path d="M6.5 8h5M6.5 11h3.5" />
    </>
  ),
  explorer: (
    <>
      <path d="M10 2H5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 5 16h8a1.5 1.5 0 0 0 1.5-1.5V6.5z" />
      <path d="M10 2v4.5h4.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7.8" cy="7.8" r="4.6" />
      <path d="m11.3 11.3 4 4" />
    </>
  ),
  changes: (
    <>
      <circle cx="5" cy="4" r="1.8" />
      <circle cx="5" cy="14" r="1.8" />
      <circle cx="13" cy="5.5" r="1.8" />
      <path d="M5 5.8v6.4" />
      <path d="M13 7.3c0 3.2-3.5 3.4-7 5" />
    </>
  ),
  notes: (
    <>
      <path d="M4.5 2h7l3 3v10.5a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z" />
      <path d="M7 8h5M7 11h5M7 14h3" />
    </>
  ),
  sessions: (
    <>
      <rect x="2" y="3" width="14" height="12" rx="1.5" />
      <path d="M5.5 7.3 8 9.3l-2.5 2" />
      <path d="M9.5 11.5h3" />
    </>
  ),
  activity: <path d="M1.8 9h3l2-5 4 10 2-5h3.4" />
}

/** A side bar: the view showing on that side, at its width (drag the inner edge; narrow enough and it closes). */
export function SidePanel({ side, bars, children }: { side: Side; bars: SideBars; children: (chrome: PanelChrome) => React.ReactNode }): React.JSX.Element | null {
  const [hover, hoverProps] = useHover()
  const id = bars.open[side]
  if (!id) return null
  const chrome: PanelChrome = {
    swapTip: side === 'L' ? 'Move to right side bar' : 'Move to left side bar',
    onSwap: () => setBars((b) => moveView(b, id, side === 'L' ? 'R' : 'L')),
    onClose: () => setBars((b) => ({ ...b, open: { ...b.open, [side]: null } }))
  }
  const onResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const w0 = getBars().width[side]
    const x0 = e.clientX
    dragWith('col-resize', (ev) => {
      const raw = side === 'L' ? w0 + ev.clientX - x0 : w0 - (ev.clientX - x0)
      // Dragged narrow: it closes (as VS Code's).
      if (raw < 120) return setBars((b) => (b.open[side] ? { ...b, open: { ...b.open, [side]: null } } : b))
      setBars((b) => ({ ...b, open: { ...b.open, [side]: b.open[side] ?? id }, width: { ...b.width, [side]: Math.max(180, Math.min(640, raw)) } }))
    })
  }
  return (
    <div
      style={{
        order: side === 'L' ? 1 : 3,
        width: bars.width[side],
        flex: 'none',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--bg-sunken)',
        borderRight: side === 'L' ? '1px solid var(--bd-1)' : 'none',
        borderLeft: side === 'R' ? '1px solid var(--bd-1)' : 'none'
      }}
    >
      {children(chrome)}
      <div
        onMouseDown={onResize}
        title="Drag to resize"
        {...hoverProps}
        style={{ position: 'absolute', top: 0, bottom: 0, left: side === 'L' ? 'calc(100% - 3px)' : -3, width: 6, cursor: 'col-resize', zIndex: 9, background: hover ? 'color-mix(in srgb, var(--c-blue) 35%, transparent)' : 'transparent' }}
      />
    </div>
  )
}
