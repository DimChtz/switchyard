import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

/**
 * The dialog shell: dimmed backdrop between the title and status bars, a
 * panel with a kicker line ("New project · …" and "esc") over the title.
 * The content decides its own keys; `onClose` runs on a backdrop press.
 */
export function Modal({
  width = 600,
  top = 88,
  kicker,
  title,
  hint = 'esc',
  onClose,
  children,
  footer
}: {
  width?: number
  top?: number
  kicker?: React.ReactNode
  title?: React.ReactNode
  hint?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}): React.JSX.Element {
  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', top: 36, bottom: 26, left: 0, right: 0, background: 'var(--backdrop)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: top, zIndex: 100 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: `calc(100% - ${top + 32}px)`,
          background: 'var(--bg-panel)',
          border: '1px solid var(--bd-4)',
          borderRadius: 10,
          boxShadow: '0 24px 64px color-mix(in srgb, var(--sh) 55%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {kicker || title ? <ModalHeader kicker={kicker} hint={hint} title={title} /> : null}
        {children}
        {footer ? <ModalFooter>{footer}</ModalFooter> : null}
      </div>
    </div>,
    document.body
  )
}

/** A dialog's top: the kicker line (with "esc" or a live value on the right) over the title. */
export function ModalHeader({
  kicker,
  hint = 'esc',
  title,
  children
}: {
  kicker?: React.ReactNode
  hint?: React.ReactNode
  title?: React.ReactNode
  /** Under the title, inside the header (a filter field). */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ padding: '18px 20px 14px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--bd-2)', flex: 'none' }}>
      {kicker || hint ? (
        <div style={{ display: 'flex', gap: 12, font: "12px var(--font-mono)", color: 'var(--t3)' }}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kicker}</span>
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
      {title ? <div style={{ font: '600 18px var(--font-ui)', letterSpacing: '-0.01em', color: 'var(--t1)' }}>{title}</div> : null}
      {children ? <div style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  )
}

/**
 * The bar along a dialog's bottom edge: buttons on the right; a <FooterNote>
 * first takes the rest of the row.
 */
export function ModalFooter({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--bd-2)', background: 'var(--bg-panel-3)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flex: 'none', ...style }}>
      {children}
    </div>
  )
}

/** The explanation at the start of a footer ("Creates the worktree…"), red for a failure. */
export function FooterNote({ children, tone }: { children: React.ReactNode; tone?: 'danger' | 'info' }): React.JSX.Element {
  return (
    <span style={{ flex: 1, minWidth: 0, font: '12px var(--font-ui)', color: tone === 'danger' ? 'var(--c-red)' : tone === 'info' ? 'var(--c-blue)' : 'var(--t3)' }}>{children}</span>
  )
}

export interface ConfirmOptions {
  title: string
  body?: React.ReactNode
  /** A path or name shown in mono under the text. */
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** A destructive action: the confirm button is red. */
  danger?: boolean
}

/** A question with a second way to say yes (choose): its button sits between Cancel and the main one. */
export interface ChooseOptions extends ConfirmOptions {
  altLabel?: string
}

type Answer = 'confirm' | 'alt' | null
type Pending = ChooseOptions & { resolve: (a: Answer) => void }
let show: ((p: Pending) => void) | null = null

/**
 * Asks before doing something - from a component, a menu item or a helper:
 *   if (await confirm({ title: 'Delete "x"?', danger: true })) …
 * Enter confirms, Esc or a click outside cancels.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return choose(options).then((a) => a === 'confirm')
}

/**
 * Like confirm, with a second choice (altLabel): 'confirm' for the main
 * button (Enter), 'alt' for the other, null for Cancel (Esc).
 */
export function choose(options: ChooseOptions): Promise<Answer> {
  return new Promise((resolve) => {
    if (!show) return resolve(null)
    show({ ...options, resolve })
  })
}

/** Mounted once (App): shows what `confirm()` asks. */
export function ConfirmHost(): React.JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null)
  useEffect(() => {
    show = (p) =>
      setPending((cur) => {
        cur?.resolve(null) // a newer question replaces an unanswered one
        return p
      })
    return () => {
      show = null
    }
  }, [])

  const answer = (a: Answer): void => {
    pending?.resolve(a)
    setPending(null)
  }

  // Ahead of the app's shortcuts: Enter/Esc answer this, and no other key
  // reaches the page behind it (Tab still moves between the buttons).
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      // Enter on a button reached with Tab presses that button.
      const el = document.activeElement as HTMLElement | null
      if (e.key === 'Enter' && el?.tagName === 'BUTTON' && el.closest('[role=dialog]')) return
      e.preventDefault()
      pending.resolve(e.key === 'Enter' ? 'confirm' : null)
      setPending(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending])

  if (!pending) return null
  return (
    <Modal width={pending.altLabel ? 480 : 420} top={160} hint={null} onClose={() => answer(null)}>
      <div style={{ padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ font: '600 16px var(--font-ui)', color: 'var(--t1)', letterSpacing: '-0.01em' }}>{pending.title}</div>
        {pending.body ? <div style={{ font: '13px/1.5 var(--font-ui)', color: 'var(--t-icon)' }}>{pending.body}</div> : null}
        {pending.detail ? (
          <div style={{ font: "11px/1.5 var(--font-mono)", color: 'var(--t4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre' }} title={pending.detail}>
            {pending.detail}
          </div>
        ) : null}
      </div>
      <ModalFooter>
        <Button size="lg" hint="esc" onClick={() => answer(null)}>
          {pending.cancelLabel ?? 'Cancel'}
        </Button>
        {pending.altLabel ? (
          <Button size="lg" onClick={() => answer('alt')}>
            {pending.altLabel}
          </Button>
        ) : null}
        <Button size="lg" variant="primary" tone={pending.danger ? 'danger' : undefined} hint="↵" onClick={() => answer('confirm')}>
          {pending.confirmLabel ?? 'OK'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
