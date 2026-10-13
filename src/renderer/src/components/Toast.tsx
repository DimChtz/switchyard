import React from 'react'
import { useAppStore } from '../store/AppStore'

const TONE_COLOR: Record<string, string> = {
  plain: 'var(--c-blue)',
  waiting: 'var(--c-amber)',
  done: 'var(--c-green)'
}

export function Toast(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  if (!state.toast) return null
  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        bottom: 42,
        background: 'var(--bg-panel)',
        border: '1px solid var(--bd-3)',
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
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: TONE_COLOR[state.toast.tone] ?? TONE_COLOR.plain
        }}
      />
      {state.toast.text}
      {state.toast.action ? (
        <button
          type="button"
          onClick={() => {
            const t = state.toast!
            dispatch({ type: 'DISMISS_TOAST', id: t.id })
            t.action!.run()
          }}
          style={{ marginLeft: 4, padding: '2px 9px', borderRadius: 4, border: '1px solid var(--bd-4)', color: 'var(--c-blue)', font: '500 12px var(--font-ui)', cursor: 'pointer' }}
        >
          {state.toast.action.label}
        </button>
      ) : null}
    </div>
  )
}
