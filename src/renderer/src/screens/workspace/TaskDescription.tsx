import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { useHover } from '../../lib/useHover'
import { MarkdownView, useLiveLinks } from '../../components/MarkdownField'
import type { Task } from '@shared/types'

// About five lines of it; the rest behind "Show all".
const CLAMP = 110

/** The task's description, rendered: its start, all of it on request; written in the task sheet. */
export function TaskDescription({ task }: { task: Task }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const links = useLiveLinks()
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const [hover, hoverProps] = useHover()
  const edit = (): void => dispatch({ type: 'OPEN_TASK_SHEET', taskId: task.id })
  const desc = task.desc ?? ''

  // Whether there's more than the clamp shows (it changes with the text and the panel's width).
  useEffect(() => {
    const el = box.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const measure = (): void => setLong(el.scrollHeight > CLAMP + 8)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [desc])

  if (!desc.trim()) {
    return (
      <div
        onClick={edit}
        {...hoverProps}
        style={{ font: '13px/1.5 var(--font-ui)', color: 'var(--t4)', margin: '0 -8px', padding: '4px 8px', borderRadius: 5, cursor: 'pointer', background: hover ? 'var(--bg-panel)' : 'transparent' }}
      >
        Add a description…
      </div>
    )
  }

  const clamped = long && !open
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        ref={box}
        style={{
          maxHeight: clamped ? CLAMP : undefined,
          overflow: 'hidden',
          // Fades out where it's cut.
          maskImage: clamped ? 'linear-gradient(to bottom, var(--t1) 55%, transparent)' : undefined
        }}
      >
        <div>
          <MarkdownView value={desc} compact links={links} onChange={(v) => dispatch({ type: 'SET_TASK_DESC', id: task.id, desc: v })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, font: '12px var(--font-ui)' }}>
        {long ? <Link onClick={() => setOpen((o) => !o)}>{open ? 'Show less' : 'Show all'}</Link> : null}
        <Link onClick={edit}>Edit</Link>
      </div>
    </div>
  )
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span onClick={onClick} {...hoverProps} style={{ color: hover ? 'var(--t1)' : 'var(--t3)', cursor: 'pointer' }}>
      {children}
    </span>
  )
}
