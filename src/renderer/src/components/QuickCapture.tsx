import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CaptureShow, Prefs } from '@shared/types'
import { toggleVoice, useVoice } from '../lib/voice/voice'
import { isMac } from '../lib/keys'
import { Annotator } from './ImageViewer'

/**
 * The quick capture box (its own little window, over whatever app is in
 * front): what's on your mind becomes a task - Enter adds it, Shift+Enter
 * adds and starts it. The clipboard's screenshot (attached unless you untick
 * it) or text (attached if you tick it) goes along.
 */
export function QuickCapture(): React.JSX.Element {
  const [show, setShow] = useState<CaptureShow | null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [details, setDetails] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [withImage, setWithImage] = useState(true)
  const [withText, setWithText] = useState(false)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [busy, setBusy] = useState(false)
  // The screenshot drawn on (an arrow, a box, a blur over a secret) - attached in place of the one copied.
  const [image, setImage] = useState<string | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const voice = useVoice()

  // Opened again: a fresh box, with what's on the clipboard now.
  useEffect(() => {
    const open = (s: CaptureShow): void => {
        setShow(s)
        setTitle('')
        setDesc('')
        setDetails(false)
        setProjectId(s.projectId)
        setWithImage(!!s.clip.image)
        setWithText(false)
        setBusy(false)
        setImage(null)
        setAnnotating(false)
        window.api.prefs.get().then(setPrefs).catch(() => {})
        setTimeout(() => titleRef.current?.focus(), 30)
    }
    // (The first open came before this page listened: what it shows, asked for.)
    window.api.capture.current().then((s) => s && open(s)).catch(() => {})
    return window.api.capture.onShow(open)
  }, [])

  // The window as tall as what it shows.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => !annotatingRef.current && window.api.capture.resize(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const annotatingRef = useRef(false)
  annotatingRef.current = annotating
  const close = (): void => void window.api.capture.hide()
  // Annotating: the box grows to draw in, and comes back after.
  const startAnnotating = (): void => {
    setAnnotating(true)
    void window.api.capture.size(1100, 760)
  }
  const stopAnnotating = (): void => {
    setAnnotating(false)
    void window.api.capture.size(620, box.current?.offsetHeight ?? 200)
    setTimeout(() => {
      if (box.current) void window.api.capture.size(620, box.current.offsetHeight)
      titleRef.current?.focus()
    }, 50)
  }
  const submit = async (start: boolean): Promise<void> => {
    const t = title.trim()
    if (!t || busy || !show) return
    setBusy(true)
    await window.api.capture
      .submit({ title: t, desc, projectId, image: withImage ? (image ?? show.clip.image) : null, text: withText ? show.clip.text : null, start })
      .catch(() => setBusy(false))
  }
  const dictate = (): void => {
    if (!prefs) return
    titleRef.current?.focus()
    toggleVoice({ model: prefs.voiceModel, language: prefs.voiceLanguage, commands: prefs.voiceCommands, live: prefs.voiceLive, toast: () => {} })
  }

  const clip = show?.clip
  const mod = isMac ? '⌘' : 'Ctrl+'
  if (annotating && clip?.image)
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', border: '1px solid var(--bd-3)', borderRadius: 10, overflow: 'hidden', boxSizing: 'border-box' }}>
        <Annotator
          src={image ?? clip.image}
          onCancel={stopAnnotating}
          onError={() => {}}
          onSave={async (dataUrl) => {
            setImage(dataUrl)
            setWithImage(true)
            stopAnnotating()
          }}
        />
      </div>
    )
  return (
    <div
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 10px', background: 'var(--bg-panel)', color: 'var(--t1)', font: '13px var(--font-ui)', boxSizing: 'border-box', border: '1px solid var(--bd-3)', borderRadius: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: '600 11px var(--font-mono)', letterSpacing: '.08em', color: 'var(--c-blue)', textTransform: 'uppercase', flex: 'none' }}>New task</span>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit(e.shiftKey)
            } else if (e.key === 'Tab' && !e.shiftKey && !details) {
              e.preventDefault()
              setDetails(true)
            }
          }}
          placeholder="What's on your mind? - the login button is misaligned on mobile"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '500 16px var(--font-ui)', padding: '4px 0' }}
        />
        <span
          onClick={dictate}
          title="Say it (voice input)"
          style={{ flex: 'none', width: 26, height: 26, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: voice.phase === 'listening' ? 'var(--bg-panel)' : 'var(--t3)', background: voice.phase === 'listening' ? 'var(--c-red)' : 'transparent' }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <rect x="4.6" y="1.5" width="4.8" height="7.2" rx="2.4" />
            <path d="M2.6 6.6a4.4 4.4 0 0 0 8.8 0M7 11v1.6" />
          </svg>
        </span>
      </div>
      {voice.phase !== 'idle' ? (
        <div style={{ font: '12px var(--font-ui)', color: 'var(--t3)' }}>{voice.phase === 'listening' ? (voice.partial ? `“${voice.partial}”` : 'Listening… click the mic again when done') : 'Writing it down…'}</div>
      ) : null}
      {details ? (
        <textarea
          autoFocus
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit(e.shiftKey)
            }
          }}
          rows={3}
          placeholder="Details (optional)"
          style={{ resize: 'none', background: 'var(--bg-input)', border: '1px solid var(--bd-2)', borderRadius: 6, color: 'var(--t1)', font: '13px/1.5 var(--font-ui)', padding: '7px 9px', outline: 'none' }}
        />
      ) : null}
      {clip?.image || clip?.text ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', border: '1px solid var(--bd-2)', borderRadius: 6, background: 'var(--bg-input)' }}>
          <input type="checkbox" checked={clip.image ? withImage : withText} onChange={(e) => (clip.image ? setWithImage(e.target.checked) : setWithText(e.target.checked))} style={{ margin: 0 }} />
          {clip.image ? (
            <img
              src={image ?? clip.image}
              alt=""
              onClick={startAnnotating}
              title="Draw on it - an arrow, a box, a blur over a secret"
              style={{ height: 40, maxWidth: 120, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--bd-2)', cursor: 'pointer' }}
            />
          ) : null}
          <span style={{ flex: 1, minWidth: 0, font: '12px var(--font-ui)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {clip.image ? (image ? 'Attach the screenshot - annotated' : 'Attach the screenshot on the clipboard') : <>Attach the copied text: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--t2)' }}>{clip.text}</span></>}
          </span>
          {clip.image ? (
            <span onClick={startAnnotating} title="Draw on it - an arrow, a box, a blur over a secret" style={{ flex: 'none', font: '12px var(--font-ui)', color: 'var(--c-blue)', cursor: 'pointer' }}>
              {image ? 'Annotate again' : 'Annotate'}
            </span>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>
        {show && show.projects.length ? (
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            title="The board it goes on"
            style={{ background: 'var(--bg-input)', color: 'var(--t2)', border: '1px solid var(--bd-2)', borderRadius: 4, font: '12px var(--font-ui)', padding: '2px 4px', maxWidth: 200 }}
          >
            {show.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: 'var(--c-amber)' }}>Add a project in Switchyard first</span>
        )}
        <span style={{ flex: 1 }} />
        {/* (In the details, Enter is a new line: the keys there take Ctrl/⌘.) */}
        {!details ? <span>Tab details</span> : null}
        <span>{details ? `${mod}↵` : '↵'} add</span>
        <span>{details ? `${mod}⇧↵` : '⇧↵'} add &amp; start</span>
        <span>esc</span>
      </div>
    </div>
  )
}
