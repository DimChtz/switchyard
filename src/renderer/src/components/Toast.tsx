import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { Button, Modal } from './ui'
import { showErrors } from '../lib/notices'

const TONE_COLOR: Record<string, string> = {
  plain: 'var(--c-blue)',
  waiting: 'var(--c-amber)',
  done: 'var(--c-green)',
  error: 'var(--c-red)'
}

/**
 * The toast at the bottom right. An error stays longer, the whole of it is a
 * click away (Details), and it's kept in the notification center's Errors -
 * as is every error. Pointing at a toast keeps it up.
 */
export function Toast(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const toast = state.toast
  const [hover, setHover] = useState(false)
  const [details, setDetails] = useState<string | null>(null)
  const error = toast?.tone === 'error'

  useEffect(() => {
    if (!toast || hover) return
    // (Long enough to reach for Undo, or to read an error.)
    const t = setTimeout(() => dispatch({ type: 'DISMISS_TOAST', id: toast.id }), toast.action ? 8000 : error ? 10_000 : 3200)
    return () => clearTimeout(t)
  }, [toast, hover, error, dispatch])
  useEffect(() => setHover(false), [toast?.id])

  return (
    <>
      {toast ? (
        <div
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 42,
            maxWidth: 'min(560px, calc(100% - 32px))',
            background: 'var(--bg-panel)',
            border: `1px solid ${error ? 'color-mix(in srgb, var(--c-red) 45%, var(--bd-3))' : 'var(--bd-3)'}`,
            borderRadius: 6,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 12.5,
            color: 'var(--t1)',
            boxShadow: '0 8px 24px color-mix(in srgb, var(--sh) 40%, transparent)',
            zIndex: 50
          }}
        >
          <span style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: TONE_COLOR[toast.tone] ?? TONE_COLOR.plain }} />
          <span style={{ minWidth: 0, lineHeight: 1.45, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>{toast.text}</span>
          {error ? (
            <ToastButton
              label="Details"
              onClick={() => {
                setDetails(toast.text)
                dispatch({ type: 'DISMISS_TOAST', id: toast.id })
              }}
            />
          ) : null}
          {toast.action ? (
            <ToastButton
              label={toast.action.label}
              onClick={() => {
                dispatch({ type: 'DISMISS_TOAST', id: toast.id })
                toast.action!.run()
              }}
            />
          ) : null}
        </div>
      ) : null}
      {details !== null ? <ErrorDetails text={details} onClose={() => setDetails(null)} /> : null}
    </>
  )
}

function ToastButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ flex: 'none', marginLeft: 4, padding: '2px 9px', borderRadius: 4, border: '1px solid var(--bd-4)', color: 'var(--c-blue)', font: '500 12px var(--font-ui)', cursor: 'pointer' }}
    >
      {label}
    </button>
  )
}

/** An error, all of it: to read, copy, or see with the others. */
export function ErrorDetails({ text, onClose }: { text: string; onClose: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <Modal
      width={640}
      kicker="Error"
      title="What went wrong"
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1 }} />
          <Button
            onClick={() => {
              onClose()
              showErrors()
            }}
          >
            All errors
          </Button>
          <Button
            onClick={() => {
              window.api.sys.copy(text)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <pre style={{ margin: 0, padding: '16px 20px', maxHeight: '50vh', overflow: 'auto', font: '12px/1.55 var(--font-mono)', color: 'var(--t1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{text}</pre>
    </Modal>
  )
}
