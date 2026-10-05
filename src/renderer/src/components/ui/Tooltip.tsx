import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/**
 * The app's tooltips (as VS Code's hovers): a short wait before the first,
 * then instant while moving between things that have one.
 *
 * - Every `title` attribute in the app shows here instead of the native
 *   tooltip - nothing to do at the call site (TooltipHost picks them up).
 * - `<Tooltip content={…}>` for content with markup: a list, a table, links
 *   (`interactive` keeps it open while the mouse moves onto it).
 */

const DELAY = 500
/** Moving to another tooltip this soon after one closed shows it at once. */
const WARM = 400
const EDGE = 8
const GAP = 6

interface Tip {
  anchor: HTMLElement
  content: React.ReactNode
  interactive: boolean
  /** Where the mouse was: a tall anchor (a card, a row) puts the tip by it. */
  x: number
  y: number
  maxWidth: number
}

let current: Tip | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hiddenAt = 0
/** After a click, the anchor shows nothing more until the mouse leaves it. */
let quietAnchor: HTMLElement | null = null
let mouse = { x: 0, y: 0 }

function set(tip: Tip | null): void {
  if (!tip && current) hiddenAt = Date.now()
  current = tip
  listeners.forEach((l) => l())
}

function clearTimers(): void {
  if (timer) clearTimeout(timer)
  if (hideTimer) clearTimeout(hideTimer)
  timer = hideTimer = null
}

interface TipOptions {
  interactive?: boolean
  maxWidth?: number
}

/** Shows `content` for `anchor` (after the wait, unless one was just showing). */
export function showTip(anchor: HTMLElement, content: React.ReactNode, opts: TipOptions = {}): void {
  if (quietAnchor === anchor) return
  clearTimers()
  const tip = (): Tip => ({ anchor, content, interactive: !!opts.interactive, x: mouse.x, y: mouse.y, maxWidth: opts.maxWidth ?? 360 })
  if (current?.anchor === anchor) return set({ ...current, content })
  if (current || Date.now() - hiddenAt < WARM) return set(tip())
  timer = setTimeout(() => set(tip()), DELAY)
}

/** The mouse left `anchor`: its tooltip goes (an interactive one after a moment, in case it's moving onto it). */
export function leaveTip(anchor: HTMLElement): void {
  if (quietAnchor === anchor) quietAnchor = null
  if (timer) clearTimeout(timer)
  timer = null
  if (current?.anchor !== anchor) return
  if (current.interactive) {
    hideTimer = setTimeout(() => set(null), 150)
  } else set(null)
}

export function hideTip(): void {
  clearTimers()
  if (current) set(null)
}

function useTip(): Tip | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

/** A tooltip with markup. The child must be a DOM element (or pass mouse handlers through to one). */
export function Tooltip({
  content,
  interactive,
  maxWidth,
  children
}: {
  content: React.ReactNode
  interactive?: boolean
  maxWidth?: number
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>
}): React.JSX.Element {
  const props = children.props
  return React.cloneElement(children, {
    'data-sy-tip': '',
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(e)
      if (content) showTip(e.currentTarget, content, { interactive, maxWidth })
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(e)
      leaveTip(e.currentTarget)
    }
  } as React.HTMLAttributes<HTMLElement>)
}

/** Building blocks for a rich tooltip: a heading line… */
export function TipTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ fontWeight: 500, color: 'var(--t1)', marginBottom: 4 }}>{children}</div>
}

/** …label / value rows… */
export function TipRows({ rows }: { rows: [React.ReactNode, React.ReactNode][] }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 3 }}>
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <span style={{ color: 'var(--t3)' }}>{k}</span>
          <span style={{ color: 'var(--t1)', font: '11.5px var(--font-mono)', textAlign: 'right' }}>{v}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

/** …and a quieter note under them. */
export function TipNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ color: 'var(--t4)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bd-2)' }}>{children}</div>
}

/** "Go back (Alt+←)": the key in parentheses at the end, shown apart. */
const KEY_AT_END = /^([\s\S]*\S)\s+\(((?:Ctrl|Alt|Shift|Cmd|Win|Meta|F\d{1,2}|[⌘⇧⌥⌃])[^()]*)\)$/

function PlainTitle({ text }: { text: string }): React.JSX.Element {
  const m = KEY_AT_END.exec(text)
  if (!m) return <>{text}</>
  return (
    <>
      {m[1]}
      <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', marginLeft: 8, whiteSpace: 'nowrap' }}>{m[2]}</span>
    </>
  )
}

/**
 * Shows the tooltips; mounted once. Also takes over every `title` in the
 * page: while the mouse is on an element, its title moves aside (so the
 * native tooltip doesn't show too) and comes back when it leaves.
 */
export function TooltipHost(): React.JSX.Element | null {
  const tip = useTip()

  useEffect(() => {
    let titled: HTMLElement | null = null
    const restore = (): void => {
      const el = titled
      titled = null
      if (!el) return
      // Unless the page set a new title meanwhile.
      if (!el.hasAttribute('title') && el.dataset.syTitle !== undefined) el.setAttribute('title', el.dataset.syTitle)
      delete el.dataset.syTitle
    }
    const onOver = (e: MouseEvent): void => {
      mouse = { x: e.clientX, y: e.clientY }
      const target = e.target as Element | null
      if (!target?.closest || target.closest('[data-sy-tooltip]')) return
      const el = target.closest<HTMLElement>('[title], [data-sy-title], [data-sy-tip]')
      if (el === titled) return
      restore()
      // A <Tooltip> handles its own (and one inside it wins over an outer title).
      if (!el || el.hasAttribute('data-sy-tip')) return
      const text = el.getAttribute('title')
      if (!text?.trim()) return
      titled = el
      el.dataset.syTitle = text
      el.removeAttribute('title')
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-description')) el.setAttribute('aria-description', text)
      showTip(el, <PlainTitle text={text} />)
    }
    const onOut = (e: MouseEvent): void => {
      const el = titled
      if (!el) return
      const to = e.relatedTarget as Node | null
      if (to && el.contains(to)) return
      restore()
      leaveTip(el)
    }
    const onMove = (e: MouseEvent): void => {
      mouse = { x: e.clientX, y: e.clientY }
    }
    // Clicking, typing or scrolling puts it away.
    const onDown = (): void => {
      if (current) quietAnchor = current.anchor
      else if (titled) quietAnchor = titled
      hideTip()
    }
    const onScroll = (e: Event): void => {
      if (current && (e.target as Element | null)?.closest?.('[data-sy-tooltip]')) return
      hideTip()
    }
    document.addEventListener('mouseover', onOver, true)
    document.addEventListener('mouseout', onOut, true)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', hideTip, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', hideTip)
    return () => {
      restore()
      document.removeEventListener('mouseover', onOver, true)
      document.removeEventListener('mouseout', onOut, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', hideTip, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', hideTip)
    }
  }, [])

  // Its anchor went away (the screen changed under it).
  useEffect(() => {
    if (!tip) return
    const t = setInterval(() => {
      if (!tip.anchor.isConnected) hideTip()
    }, 300)
    return () => clearInterval(t)
  }, [tip])

  if (!tip) return null
  return createPortal(<TipBox tip={tip} />, document.body)
}

function TipBox({ tip }: { tip: Tip }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const r = tip.anchor.getBoundingClientRect()
    const w = box.offsetWidth
    const h = box.offsetHeight
    // A tall anchor (a card, a list row): by the mouse rather than under all of it.
    const tall = r.height > 48
    const below = tall ? tip.y + 18 : r.bottom + GAP
    const above = tall ? tip.y - 12 - h : r.top - GAP - h
    const top = below + h <= window.innerHeight - EDGE || above < EDGE ? below : above
    const centre = tall ? tip.x : r.left + r.width / 2
    const left = Math.max(EDGE, Math.min(centre - w / 2, window.innerWidth - w - EDGE))
    setPos({ left, top: Math.max(EDGE, Math.min(top, window.innerHeight - h - EDGE)) })
  }, [tip])

  return (
    <div
      ref={ref}
      data-sy-tooltip=""
      role="tooltip"
      onMouseEnter={() => {
        if (tip.interactive && hideTimer) clearTimeout(hideTimer)
      }}
      onMouseLeave={() => tip.interactive && leaveTip(tip.anchor)}
      style={
        {
          position: 'fixed',
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          zIndex: 1100,
          maxWidth: tip.maxWidth,
          boxSizing: 'border-box',
          padding: '5px 9px',
          background: 'var(--bg-menu)',
          border: '1px solid var(--bd-4)',
          borderRadius: 6,
          boxShadow: '0 8px 24px color-mix(in srgb, var(--sh) 45%, transparent)',
          font: '12px/1.45 var(--font-ui)',
          color: 'var(--t1)',
          whiteSpace: 'pre-line',
          overflowWrap: 'anywhere',
          pointerEvents: tip.interactive ? 'auto' : 'none',
          userSelect: tip.interactive ? 'text' : 'none',
          animation: 'sy-tip-in 90ms ease-out',
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties
      }
    >
      {tip.content}
    </div>
  )
}
