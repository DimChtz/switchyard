import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { cancelVoice, toggleVoice, useVoice, type VoiceOptions } from '../lib/voice/voice'
import { shortcut } from '../lib/shortcuts'
import { useHover } from '../lib/useHover'
import type { Action } from '../store/types'
import type { Prefs } from '@shared/types'

/** What voice input needs from the app: the settings, and a way to say things. */
export function voiceOptions(prefs: Prefs, dispatch: Dispatch): VoiceOptions {
  return {
    model: prefs.voiceModel,
    language: prefs.voiceLanguage,
    toast: (text, action) => dispatch({ type: 'TOAST', text, action })
  }
}

type Dispatch = (action: Action) => void

const mb = (n: number): string => `${Math.round(n / 1_000_000)} MB`

/** While dictating: listening (time and level), the model downloading the first time, transcribing. */
export function VoiceIndicator(): React.JSX.Element | null {
  const v = useVoice()
  const [, tick] = useState(0)
  useEffect(() => {
    if (v.phase !== 'listening') return
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [v.phase])
  if (v.phase === 'idle') return null
  const secs = Math.floor((Date.now() - v.since) / 1000)
  const key = shortcut('voice-input')
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 40,
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        borderRadius: 20,
        background: 'var(--bg-menu)',
        border: '1px solid var(--bd-4)',
        boxShadow: '0 8px 24px color-mix(in srgb, var(--sh) 40%, transparent)',
        font: '12.5px var(--font-ui)',
        color: 'var(--t1)',
        whiteSpace: 'nowrap'
      }}
    >
      {v.phase === 'listening' ? (
        <>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--c-red)', animation: 'sy-voice-pulse 1.2s ease-in-out infinite' }} />
          <span>
            Listening <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)' }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
          </span>
          <span style={{ width: 64, height: 4, borderRadius: 2, background: 'var(--bd-3)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.round(v.level * 100)}%`, background: 'var(--c-green)', transition: 'width 80ms' }} />
          </span>
          {v.target ? <span style={{ color: 'var(--t3)' }}>into {v.target}</span> : <span style={{ color: 'var(--t4)' }}>nothing focused - you&apos;ll get the text to copy</span>}
        </>
      ) : (
        <>
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid var(--c-blue)', borderTopColor: 'transparent', animation: 'sy-voice-spin .8s linear infinite', boxSizing: 'border-box' }} />
          <span>Transcribing…</span>
        </>
      )}
      {v.download && v.download.total ? (
        <span style={{ color: 'var(--c-amber)' }}>
          downloading the voice model (once): {Math.round((v.download.loaded / v.download.total) * 100)}% of {mb(v.download.total)}
        </span>
      ) : null}
      <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>
        {v.phase === 'listening' ? `${key ? `${key} stop · ` : ''}Esc cancel` : 'Esc cancel'}
      </span>
      <span onClick={cancelVoice} title="Cancel" style={{ cursor: 'pointer', color: 'var(--t3)' }}>
        ✕
      </span>
    </div>
  )
}

/** The status bar's mic: click to dictate into what has the cursor (it doesn't take the focus). */
export function VoiceButton(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const v = useVoice()
  const [hover, hoverProps] = useHover()
  const on = v.phase !== 'idle'
  const key = shortcut('voice-input')
  return (
    <span
      {...hoverProps}
      // (Not taking the focus: the text goes where the cursor is.)
      onMouseDown={(e) => {
        e.preventDefault()
        if (v.phase === 'transcribing') return
        toggleVoice(voiceOptions(state.prefs, dispatch))
      }}
      title={on ? 'Stop and type it in' : `Voice input - dictate into what has the cursor${key ? ` (${key}; hold it to talk)` : ''}`}
      style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: on ? 'var(--c-red)' : hover ? 'var(--t1)' : 'var(--t4)' }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
        <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
      </svg>
    </span>
  )
}
