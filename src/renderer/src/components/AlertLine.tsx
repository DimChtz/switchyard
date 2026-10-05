import React from 'react'
import { useHover } from '../lib/useHover'

/** One line of the strip under a task's header: what needs attention, in its color, then what to do about it. */
export function AlertLine({ color, icon, title, children }: { color: string; icon: string; title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div title={title} style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', font: '12px var(--font-ui)', color, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ width: 14, textAlign: 'center', flex: 'none' }}>{icon}</span>
      {children}
    </div>
  )
}

/** An action on an alert line: a link after a dot. */
export const AlertAction = React.forwardRef<HTMLSpanElement, { onClick: (e: React.MouseEvent<HTMLSpanElement>) => void; children: React.ReactNode }>(function AlertAction({ onClick, children }, ref) {
  const [hover, hoverProps] = useHover()
  return (
    <>
      <span style={{ color: 'var(--t5)' }}>·</span>
      <span ref={ref} onClick={onClick} {...hoverProps} style={{ color: 'var(--t2)', cursor: 'pointer', textDecoration: hover ? 'underline' : 'none', textUnderlineOffset: 3 }}>
        {children}
      </span>
    </>
  )
})
