import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The one dropdown of the app: title bar menus, right-click menus, ⋯ menus
 * and Select pickers all open this panel, so they look and behave the same.
 */

export interface MenuItem {
  label: string
  onClick: () => void
  /** A keyboard shortcut shown on the right, already formatted (keyLabel). */
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** A choice in a list (Select): true shows the check. */
  checked?: boolean
  separatorBefore?: boolean
  /** Keep the menu open after this item is clicked (used for click-to-confirm actions). */
  stayOpen?: boolean
  /** A group's title, not an item (a project over its tasks). */
  heading?: boolean
  /** A colored dot before the label (a status). */
  dot?: string
  /** Quiet text on the right (a task key), in place of a shortcut. */
  sub?: string
  /** A glyph before the label (what kind of thing it opens), in its color. */
  glyph?: string
  glyphColor?: string
}

/** Where the menu opens: at a point (a right-click), or under an element (a button). */
export type MenuAnchor = { x: number; y: number } | { el: HTMLElement; align?: 'start' | 'end' }

const C = {
  panel: 'var(--bg-menu)',
  border: 'var(--bd-4)',
  separator: 'var(--bd-2)',
  text: 'var(--t1)',
  disabled: 'var(--t5)',
  shortcut: 'var(--t4)',
  hover: 'color-mix(in srgb, var(--c-blue) 14%, transparent)',
  check: 'var(--c-blue)',
  danger: 'var(--c-red)',
  dangerHover: 'color-mix(in srgb, var(--c-red) 14%, transparent)'
}
const EDGE = 8 // keep this far from the window's edges
const GAP = 5 // between a button and its menu

export function Menu({
  anchor,
  items,
  onClose,
  width,
  minWidth = 180,
  initialActive = -1,
  onNavigate,
  intro
}: {
  anchor: MenuAnchor
  items: MenuItem[]
  onClose: () => void
  /** A fixed width; otherwise as wide as the longest item. */
  width?: number
  minWidth?: number
  /** The item highlighted on open (-1: none, as when opened with the mouse). */
  initialActive?: number
  /** ← / → pressed: the title bar moves to the neighbouring menu. */
  onNavigate?: (dir: -1 | 1) => void
  /** A line of explanation above the items. */
  intro?: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(initialActive)
  const live = useRef({ items, active, anchor, onClose, onNavigate })
  live.current = { items, active, anchor, onClose, onNavigate }

  const pick = (i: number): void => {
    const item = live.current.items[i]
    if (!item || item.disabled || item.heading) return
    if (!item.stayOpen) live.current.onClose()
    item.onClick()
  }

  // Place it before it's painted: flip or shift to stay inside the window.
  const anchorEl = 'el' in anchor ? anchor.el : null
  const anchorX = 'x' in anchor ? anchor.x : 0
  const anchorY = 'y' in anchor ? anchor.y : 0
  const align = 'el' in anchor ? (anchor.align ?? 'start') : 'start'
  useLayoutEffect(() => {
    const panel = ref.current
    if (!panel) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = panel.offsetWidth
    const h = Math.min(panel.offsetHeight, vh - 2 * EDGE)
    const clampX = (x: number): number => Math.max(EDGE, Math.min(x, vw - w - EDGE))
    const clampY = (y: number): number => Math.max(EDGE, Math.min(y, vh - h - EDGE))
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect()
      const below = r.bottom + GAP
      const above = r.top - GAP - h
      const top = below + h <= vh - EDGE || above < EDGE ? clampY(below) : above
      setPos({ left: clampX(align === 'end' ? r.right - w : r.left), top })
    } else {
      const left = anchorX + w <= vw - EDGE ? anchorX : anchorX - w >= EDGE ? anchorX - w : clampX(anchorX)
      const top = anchorY + h <= vh - EDGE ? anchorY : anchorY - h >= EDGE ? anchorY - h : clampY(anchorY)
      setPos({ left, top })
    }
  }, [anchorEl, anchorX, anchorY, align, items.length])

  // Keyboard: it's driven from the window, so focus stays where it was
  // (Cut/Copy/Paste act on the editor's selection) and nothing else sees these keys.
  useEffect(() => {
    const enabled = (i: number): boolean => !!live.current.items[i] && !live.current.items[i].disabled && !live.current.items[i].heading
    const step = (from: number, dir: 1 | -1): number => {
      const n = live.current.items.length
      const start = from < 0 ? (dir > 0 ? -1 : n) : from
      for (let k = 1; k <= n; k++) {
        const i = (((start + dir * k) % n) + n) % n
        if (enabled(i)) return i
      }
      return -1
    }
    const onKey = (e: KeyboardEvent): void => {
      const { active: cur, items: list } = live.current
      let handled = true
      if (e.key === 'Escape') live.current.onClose()
      else if (e.key === 'ArrowDown') setActive(step(cur, 1))
      else if (e.key === 'ArrowUp') setActive(step(cur, -1))
      else if (e.key === 'Home') setActive(step(-1, 1))
      else if (e.key === 'End') setActive(step(-1, -1))
      else if (e.key === 'Enter' || e.key === ' ') {
        if (cur >= 0) pick(cur)
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && live.current.onNavigate) {
        live.current.onNavigate(e.key === 'ArrowLeft' ? -1 : 1)
      } else if (e.key === 'Tab') {
        live.current.onClose()
        handled = false
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Type-ahead: the next item starting with that letter.
        const ch = e.key.toLowerCase()
        const n = list.length
        for (let k = 1; k <= n; k++) {
          const i = (cur + k + n) % n
          if (enabled(i) && list[i].label.toLowerCase().startsWith(ch)) {
            setActive(i)
            break
          }
        }
      } else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // A press anywhere else closes it; on its own button, the button decides.
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      const { anchor: a } = live.current
      if (ref.current?.contains(t)) return
      if ('el' in a && a.el.contains(t)) return
      live.current.onClose()
    }
    const onWheel = (e: WheelEvent): void => {
      if (!ref.current?.contains(e.target as Node)) live.current.onClose()
    }
    const close = (): void => live.current.onClose()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('wheel', onWheel, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [])

  // Keep the highlighted item in view in a long list.
  useEffect(() => {
    if (active >= 0) ref.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const checks = items.some((it) => it.checked !== undefined)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Keeps focus (and the selection) where it was. And the menu's events
      // stay its own: React passes a portal's events up to the element that
      // rendered it (a row whose click would navigate).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={
        {
          position: 'fixed',
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          width,
          minWidth: width ? undefined : minWidth,
          maxWidth: width ? undefined : 420,
          maxHeight: `calc(100vh - ${2 * EDGE}px)`,
          overflowY: 'auto',
          boxSizing: 'border-box',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: '0 16px 40px color-mix(in srgb, var(--sh) 55%, transparent)',
          padding: 5,
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1000,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties
      }
    >
      {intro ? <div style={{ padding: '6px 9px 8px', font: '12px/1.45 var(--font-ui)', color: 'var(--t3)', textWrap: 'pretty' } as React.CSSProperties}>{intro}</div> : null}
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.separatorBefore && i > 0 ? <div style={{ height: 1, flex: 'none', background: C.separator, margin: '4px 8px' }} /> : null}
          {item.heading ? (
            <div style={{ padding: '9px 9px 4px', font: "500 10.5px var(--font-mono)", letterSpacing: '.08em', textTransform: 'uppercase', color: C.shortcut, flex: 'none' }}>
              {item.label}
            </div>
          ) : (
          <div
            data-i={i}
            role={checks ? 'menuitemradio' : 'menuitem'}
            aria-disabled={item.disabled || undefined}
            aria-checked={checks ? !!item.checked : undefined}
            onMouseEnter={() => setActive(item.disabled ? -1 : i)}
            onMouseLeave={() => setActive((a) => (a === i ? -1 : a))}
            onClick={() => pick(i)}
            style={{
              height: 28,
              flex: 'none',
              padding: '0 10px',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              font: '13px var(--font-ui)',
              color: item.disabled ? C.disabled : item.danger ? C.danger : C.text,
              background: active === i && !item.disabled ? (item.danger ? C.dangerHover : C.hover) : 'transparent',
              cursor: 'default',
              userSelect: 'none'
            }}
          >
            {checks ? (
              <span style={{ width: 12, marginRight: -8, flex: 'none', font: '12px var(--font-ui)', color: C.check }}>{item.checked ? '✓' : ''}</span>
            ) : null}
            {item.dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.dot, flex: 'none', marginRight: -8 }} /> : null}
            {item.glyph ? <span style={{ width: 12, flex: 'none', textAlign: 'center', font: '11px var(--font-mono)', color: item.glyphColor ?? C.shortcut, marginRight: -2 }}>{item.glyph}</span> : null}
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
            {item.sub ? <span style={{ font: "11px var(--font-mono)", color: C.shortcut, whiteSpace: 'nowrap' }}>{item.sub}</span> : null}
            {item.shortcut ? <span style={{ font: "11.5px var(--font-mono)", color: C.shortcut, whiteSpace: 'nowrap' }}>{item.shortcut}</span> : null}
          </div>
          )}
        </React.Fragment>
      ))}
    </div>,
    document.body
  )
}

/**
 * A right-click menu for an element:
 *   const ctx = useContextMenu(() => items)
 *   <div onContextMenu={ctx.onContextMenu}>…{ctx.menu}</div>
 * The items are built when it opens, so they reflect the state then.
 */
export function useContextMenu(items: () => MenuItem[]): { onContextMenu: (e: React.MouseEvent) => void; menu: React.ReactNode } {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  return {
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setAt({ x: e.clientX, y: e.clientY })
    },
    menu: at ? <Menu anchor={at} items={items()} onClose={() => setAt(null)} /> : null
  }
}

/**
 * A text field with a list to pick from (in place of a native <datalist>,
 * whose popup the OS draws): type anything, or open the list with the
 * chevron (or ↓) and pick. `items` is built when the list opens.
 */
export function Combo({
  value,
  onChange,
  items,
  placeholder,
  disabled,
  style,
  inputStyle,
  title,
  menuWidth
}: {
  value: string
  onChange: (v: string) => void
  items: () => MenuItem[]
  placeholder?: string
  disabled?: boolean
  style?: React.CSSProperties
  inputStyle?: React.CSSProperties
  title?: string
  /** The list's width (default: the field's). */
  menuWidth?: number
}): React.JSX.Element {
  const wrap = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const list = open ? items() : []
  return (
    <span ref={wrap} title={title} style={{ display: 'flex', alignItems: 'center', minWidth: 0, ...style }}>
      <input
        ref={input}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', font: 'inherit', padding: 0, ...inputStyle }}
      />
      {disabled ? null : (
        <span
          role="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            input.current?.focus()
            setOpen((o) => !o)
          }}
          style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, cursor: 'pointer', color: 'var(--t3)' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2.5 3.8 5 6.3l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {open && wrap.current && list.length ? (
        <Menu anchor={{ el: wrap.current }} width={menuWidth ?? Math.max(wrap.current.offsetWidth, 220)} initialActive={list.findIndex((it) => it.checked)} items={list} onClose={() => setOpen(false)} />
      ) : null}
    </span>
  )
}

/**
 * A dropdown picker (in place of a native <select>, whose popup the OS
 * draws). The trigger takes the look of where it sits through `style`.
 */
export function Select({
  value,
  options,
  onChange,
  style,
  title
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
  style?: React.CSSProperties
  title?: string
}): React.JSX.Element {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find(([v]) => v === value)
  return (
    <>
      <button
        ref={btn}
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          btn.current?.focus()
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          if (open || !['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          boxSizing: 'border-box',
          textAlign: 'left',
          cursor: 'pointer',
          outline: 'none',
          ...style
        }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current?.[1] ?? value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flex: 'none', opacity: 0.6 }}>
          <path d="M2.5 3.8 5 6.3l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && btn.current ? (
        <Menu
          anchor={{ el: btn.current }}
          minWidth={btn.current.offsetWidth}
          initialActive={options.findIndex(([v]) => v === value)}
          items={options.map(([v, label]) => ({ label, checked: v === value, onClick: () => v !== value && onChange(v) }))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
