import React from 'react'
import { useHover } from '../../../lib/useHover'

/** What every side bar view's header has: move it to the other side bar, hide the side bar. */
export interface PanelChrome {
  title?: string
  swapTip: string
  onSwap: () => void
  onClose: () => void
}

/** A side bar view's header: its title, its own buttons, then move and hide. */
export function PanelHeader({ title, chrome, children }: { title: string; chrome: PanelChrome; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ height: 35, flex: 'none', padding: '0 6px 0 14px', display: 'flex', alignItems: 'center', gap: 1 }}>
      <span style={{ font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ flex: 1 }} />
      {children ? <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>{children}</div> : null}
      <PanelIcon title={chrome.swapTip} onClick={chrome.onSwap}>
        <path d="M2 4.5h9.5L9.3 2.3" />
        <path d="M12 9.5H2.5l2.2 2.2" />
      </PanelIcon>
      <PanelIcon title="Hide side bar" onClick={chrome.onClose}>
        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
      </PanelIcon>
    </div>
  )
}

/** A 24px header button with a 14px line icon (the paths as children). */
export function PanelIcon({
  title,
  onClick,
  active,
  size = 24,
  svgStyle,
  children
}: {
  title: string
  onClick: (e: React.MouseEvent) => void
  active?: boolean
  size?: number
  svgStyle?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      onClick={onClick}
      title={title}
      {...hoverProps}
      style={{
        width: size,
        height: size,
        flex: 'none',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: hover || active ? 'var(--t1)' : 'var(--t-dim)',
        background: hover ? 'var(--bg-hover)' : active ? 'var(--bd-1)' : 'transparent'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={svgStyle}>
        {children}
      </svg>
    </span>
  )
}
