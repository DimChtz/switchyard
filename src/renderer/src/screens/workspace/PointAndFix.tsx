import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { agentShort } from '../../lib/derive'
import { errText } from '../../lib/errors'
import { keyLabel } from '../../lib/keys'
import { Button, IconButton } from '../../components/ui'
import { CANCEL_PICK_SCRIPT, PICK_SCRIPT, pickMessage, sourceHint, type PickedElement } from '../../lib/elementPicker'
import type { Task } from '@shared/types'

interface Picked {
  el: PickedElement
  /** The screenshot around it, outlined (PNG data URL). */
  shot: string | null
  /** Where its text is in the task's files, when the page didn't say where it's written. */
  candidates: string[]
}

export interface PointState {
  picking: boolean
  picked: Picked | null
  toggle: () => void
  pickAgain: () => void
  close: () => void
}

/** The screenshot: the element with some room around it, outlined in blue. */
async function captureShot(wv: Electron.WebviewTag, el: PickedElement): Promise<string> {
  const pad = 32
  const x = Math.max(0, Math.floor(el.rect.x - pad))
  const y = Math.max(0, Math.floor(el.rect.y - pad))
  const w = Math.min(el.viewport.width, Math.ceil(el.rect.x + el.rect.width + pad)) - x
  const h = Math.min(el.viewport.height, Math.ceil(el.rect.y + el.rect.height + pad)) - y
  if (w < 4 || h < 4) throw new Error('It isn’t on screen')
  const shot = await wv.capturePage({ x, y, width: w, height: h })
  const image = new Image()
  await new Promise<void>((ok, fail) => {
    image.onload = () => ok()
    image.onerror = () => fail(new Error('Could not read the screenshot'))
    image.src = shot.toDataURL()
  })
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return image.src
  const s = image.width / w
  ctx.drawImage(image, 0, 0)
  ctx.strokeStyle = '#4f8cff'
  ctx.lineWidth = Math.max(2, Math.round(2 * s))
  ctx.strokeRect((el.rect.x - x) * s, (el.rect.y - y) * s, el.rect.width * s, el.rect.height * s)
  return canvas.toDataURL('image/png')
}

/** Picking in the Preview's page: start, cancel, and what was picked. */
export function usePointAndFix(webview: React.MutableRefObject<Electron.WebviewTag | null>, root: string | null): PointState {
  const { dispatch } = useAppStore()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const pickingRef = useRef(false)

  const cancel = useCallback((): void => {
    webview.current?.executeJavaScript(CANCEL_PICK_SCRIPT).catch(() => {})
  }, [webview])

  const start = useCallback(async (): Promise<void> => {
    const wv = webview.current
    if (!wv || pickingRef.current) return
    pickingRef.current = true
    setPicking(true)
    setPicked(null)
    try {
      const el = (await wv.executeJavaScript(PICK_SCRIPT, true)) as PickedElement | null
      if (!el) return
      // The outline has to be gone from the page before the screenshot.
      await new Promise((r) => setTimeout(r, 90))
      const shot = await captureShot(wv, el).catch(() => null)
      setPicked({ el, shot, candidates: [] })
      // No word from the framework on where it's written: where its text is.
      const text = el.text.split(/\s{2,}|\n/)[0]
      if (!el.source && root && text.length >= 3 && text.length <= 80) {
        const found = await window.api.fs
          .searchText(root, { query: text, regex: false, caseSensitive: true, wholeWord: false, include: '', exclude: 'node_modules, dist, build, out, .git, .next, coverage, *.map, *.lock, *.min.js, .switchyard' })
          .catch(() => null)
        const candidates = (found?.files ?? []).slice(0, 3).map((f) => `${f.path}:${(f.lines[0]?.line ?? 0) + 1}`)
        if (candidates.length) setPicked((p) => (p && p.el === el ? { ...p, candidates } : p))
      }
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not pick in the page: ${errText(err)}` })
    } finally {
      pickingRef.current = false
      setPicking(false)
    }
  }, [webview, root, dispatch])

  // Esc in the app (not the page) stops picking too.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picking, cancel])

  // Leaving the page (a reload, navigating) ends it.
  useEffect(() => {
    const wv = webview.current
    if (!wv) return
    const off = (): void => setPicked(null)
    wv.addEventListener('did-navigate', off)
    return () => {
      wv.removeEventListener('did-navigate', off)
    }
  }, [webview, picked])

  return {
    picking,
    picked,
    toggle: () => (picking ? cancel() : start()),
    pickAgain: () => start(),
    close: () => setPicked(null)
  }
}

/** The card over the page once something is picked: what it is, where it's written, and what should change. */
export function PointAndFix({ task, root, point }: { task: Task; root: string | null; point: PointState }): React.JSX.Element | null {
  const { dispatch } = useAppStore()
  const [ask, setAsk] = useState('')
  const [sending, setSending] = useState(false)
  const picked = point.picked
  if (!picked) return null
  const { el } = picked
  const agent = agentShort(task.agentKind) || 'the agent'
  const src = sourceHint(el, root)
  // Out of the element's way: at the bottom when it's in the top half.
  const below = el.rect.y + el.rect.height / 2 < el.viewport.height / 2

  const send = async (): Promise<void> => {
    if (!ask.trim() || sending) return
    setSending(true)
    try {
      const shot = picked.shot && root ? await window.api.preview.saveShot(root, picked.shot).catch(() => null) : null
      dispatch({
        type: 'MESSAGE_AGENT',
        taskId: task.id,
        text: pickMessage(el, ask, { root, screenshot: shot?.rel ?? null, candidates: picked.candidates }),
        toast: `Sent to ${agent} - with the element${shot ? ' and a screenshot' : ''}.`
      })
      setAsk('')
      point.close()
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 12,
        [below ? 'bottom' : 'top']: 12,
        width: 440,
        maxWidth: 'calc(100% - 24px)',
        boxSizing: 'border-box',
        background: 'var(--bg-menu)',
        border: '1px solid var(--bd-4)',
        borderRadius: 8,
        boxShadow: '0 12px 32px color-mix(in srgb, black 35%, transparent)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 5
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <span style={{ font: '12px var(--font-mono)', color: 'var(--c-blue)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }} title={el.selector}>
          {el.label}
        </span>
        {el.text ? (
          <span style={{ font: '12px var(--font-ui)', color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }} title={el.text}>
            “{el.text}”
          </span>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <IconButton size={22} title="Close" onClick={point.close}>
          ×
        </IconButton>
      </div>
      <div style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)', overflowWrap: 'anywhere' }}>
        {src ? (
          <>
            <span style={{ color: 'var(--t1)' }}>{src}</span>
            {el.components.length ? <span> · {el.components.slice(0, 3).join(' < ')}</span> : null}
          </>
        ) : picked.candidates.length ? (
          <>
            text found in <span style={{ color: 'var(--t1)' }}>{picked.candidates.join(', ')}</span>
          </>
        ) : (
          <span>No source location from the page - {agent} gets its selector, text and a screenshot</span>
        )}
      </div>
      {picked.shot ? (
        <div style={{ background: 'var(--bg-console)', border: '1px solid var(--bd-2)', borderRadius: 5, padding: 6, display: 'flex', justifyContent: 'center' }}>
          <img src={picked.shot} alt="The picked element" style={{ maxWidth: '100%', maxHeight: 110, objectFit: 'contain', borderRadius: 3 }} />
        </div>
      ) : null}
      <textarea
        autoFocus
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            send()
          }
          if (e.key === 'Escape') point.close()
        }}
        rows={2}
        placeholder="What should change? e.g. make it match the header, it overflows on narrow screens…"
        style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 5, padding: '7px 9px', font: '12.5px/1.45 var(--font-ui)', outline: 'none' }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', flex: 1 }}>
          {Math.round(el.rect.width)}×{Math.round(el.rect.height)} · {el.framework ?? 'html'}
        </span>
        <Button size="sm" onClick={point.pickAgain}>
          Pick another
        </Button>
        <Button size="sm" variant="primary" hint={keyLabel('⌘↵')} disabled={!ask.trim() || sending} onClick={send}>
          Send to {agent}
        </Button>
      </div>
    </div>
  )
}
