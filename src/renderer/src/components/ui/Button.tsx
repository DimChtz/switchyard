import React from 'react'
import { useHover } from '../../lib/useHover'
import { keyLabel } from '../../lib/keys'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
/** Heights: xs 24 · sm 26 · md 28 · lg 30 (modal footers). */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'
export type Tone = 'danger' | 'warn' | 'success'

const HEIGHT: Record<ButtonSize, number> = { xs: 24, sm: 26, md: 28, lg: 30 }
const TONE: Record<Tone, string> = { danger: 'var(--c-red)', warn: 'var(--c-amber)', success: 'var(--c-green)' }

/**
 * The app's button. Primary is the filled light one (one per area, the
 * thing to do next); secondary the outlined one; ghost is text only.
 * `hint` shows a shortcut after the label ("⌘↵" is written per platform).
 * It doesn't take focus on click, so a terminal or editor keeps it.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  tone,
  hint,
  disabled,
  title,
  onClick,
  children,
  style
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  tone?: Tone
  hint?: string
  disabled?: boolean
  title?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const h = HEIGHT[size]
  const small = size === 'xs' || size === 'sm'
  const on = hover && !disabled
  const toneColor = tone ? TONE[tone] : null

  let look: React.CSSProperties
  if (variant === 'primary') {
    const bg = disabled ? 'var(--bd-3)' : tone === 'danger' ? (on ? 'var(--c-red-soft)' : 'var(--c-red)') : on ? 'var(--t-max)' : 'var(--t1)'
    look = { background: bg, color: disabled ? 'var(--t3)' : 'var(--bg-app)', border: '1px solid transparent', fontWeight: 500 }
  } else if (variant === 'secondary') {
    const border = tone === 'warn' ? toneColor! : on ? (tone === 'danger' ? 'var(--c-red)' : 'var(--bd-5)') : 'var(--bd-3)'
    look = { background: 'transparent', color: toneColor ?? (on ? 'var(--t1)' : 'var(--t2)'), border: `1px solid ${border}`, opacity: disabled ? 0.45 : 1 }
  } else {
    look = { background: 'transparent', color: toneColor ?? (on ? 'var(--t1)' : 'var(--t3)'), border: '1px solid transparent', opacity: disabled ? 0.45 : 1 }
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => !disabled && onClick?.(e)}
      {...hoverProps}
      style={{
        height: h,
        padding: variant === 'ghost' ? '0 6px' : small ? '0 10px' : variant === 'primary' && size === 'lg' ? '0 14px' : '0 12px',
        borderRadius: size === 'xs' ? 4 : 5,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: small ? 8 : 10,
        flex: 'none',
        font: `${variant === 'primary' ? 500 : 400} ${small ? 12 : 12.5}px var(--font-ui)`,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer',
        ...look,
        ...style
      }}
    >
      {children}
      {hint ? <span style={{ font: `${small ? 10.5 : 11}px var(--font-mono)`, opacity: 0.55 }}>{keyLabel(hint)}</span> : null}
    </button>
  )
}

/** A square button holding an icon or glyph: toolbars, row actions, ⋯ menus. */
export function IconButton({
  title,
  onClick,
  children,
  size = 26,
  active,
  activeColor = 'var(--t1)',
  disabled,
  style
}: {
  title: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
  /** 18 (inside rows) · 22 (panel toolbars) · 24 (side panel headers) · 26 (headers). */
  size?: 18 | 22 | 24 | 26
  active?: boolean
  activeColor?: string
  disabled?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const on = hover && !disabled
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => !disabled && onClick?.(e)}
      {...hoverProps}
      style={{
        width: size,
        height: size,
        borderRadius: size === 18 ? 3 : size === 26 ? 5 : 4,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        fontSize: size === 26 ? 14 : 12,
        lineHeight: 1,
        color: disabled ? 'var(--t5)' : active ? activeColor : on ? 'var(--t1)' : size === 18 ? 'var(--t4)' : 'var(--t3)',
        background: on ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        ...style
      }}
    >
      {children}
    </button>
  )
}
