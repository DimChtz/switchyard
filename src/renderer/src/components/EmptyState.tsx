import React from 'react'

/**
 * A screen (or list) with nothing in it yet: what it's for, and the one
 * thing to do to get something there.
 */
export function EmptyState({
  title,
  children,
  actions,
  hint,
  center,
  style
}: {
  title: string
  /** What shows up here, and how it gets here. */
  children: React.ReactNode
  /** The way to start (a button or two). */
  actions?: React.ReactNode
  /** A quiet line under it: a shortcut, or where else to look. */
  hint?: React.ReactNode
  /** In the middle of the free space (a whole screen), not at the top of a list. */
  center?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: center ? 'center' : 'flex-start',
        textAlign: center ? 'center' : 'left',
        gap: 8,
        padding: center ? '32px 24px' : '18px 20px',
        margin: center ? 'auto' : undefined,
        maxWidth: center ? 520 : undefined,
        border: center ? 'none' : '1px dashed var(--bd-3)',
        borderRadius: 8,
        ...style
      }}
    >
      <div style={{ font: '500 14.5px var(--font-ui)', color: 'var(--t1)' }}>{title}</div>
      <div style={{ font: '13px/1.6 var(--font-ui)', color: 'var(--t3)', maxWidth: 520, textWrap: 'pretty' } as React.CSSProperties}>{children}</div>
      {actions ? <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: center ? 'center' : 'flex-start' }}>{actions}</div> : null}
      {hint ? <div style={{ font: '11.5px var(--font-mono)', color: 'var(--t5)', marginTop: 2 }}>{hint}</div> : null}
    </div>
  )
}
