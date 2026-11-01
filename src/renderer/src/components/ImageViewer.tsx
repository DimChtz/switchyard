import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/AppStore'
import { Button } from './ui'
import { closeImage, imageChanged, useImageView, viewImage } from '../lib/imageViewer'
import { agentShort } from '../lib/derive'
import { revealLabel } from '../lib/keys'
import { errText } from '../lib/errors'
import { ANNOTATION_COLORS } from '../lib/annotationColors'

/**
 * A picture full size (click one in a note, a task's description or a
 * comment): fit to the window or at 100%, scroll to zoom, drag to look
 * around. Annotate draws on it - an arrow, a box, a highlight, a pen, a blur
 * over a secret - and saves it in place, so wherever it shows is updated.
 */
export function ImageViewer(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const view = useImageView()
  const [src, setSrc] = useState<string | null | undefined>(undefined)
  const [info, setInfo] = useState<{ path: string | null; editable: boolean }>({ path: null, editable: false })
  const [mode, setMode] = useState<'view' | 'annotate'>('view')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!view) return
    setMode(view.mode)
    setSrc(undefined)
    let live = true
    window.api.notes
      .image(view.ref)
      .then((s) => live && setSrc(s))
      .catch(() => live && setSrc(null))
    window.api.images
      .info(view.ref)
      .then((i) => live && setInfo(i))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [view, version])

  if (!view) return null
  const name = (info.path ?? view.ref).split(/[\\/]/).pop() ?? view.ref
  // (Below the title bar, as the app's dialogs are: the window's own buttons and its drag area are there.)
  return createPortal(
    <div style={{ position: 'fixed', top: 36, left: 0, right: 0, bottom: 0, zIndex: 150, background: 'color-mix(in srgb, var(--sh) 82%, transparent)', display: 'flex', flexDirection: 'column', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {src === undefined ? (
        <Center text="Loading…" />
      ) : src === null ? (
        <Center text={`Can't show ${name} - it's not there any more, or isn't an image.`} onClose={closeImage} />
      ) : mode === 'annotate' ? (
        <Annotator
          src={src}
          onCancel={() => (view.mode === 'annotate' ? closeImage() : setMode('view'))}
          onError={(text) => dispatch({ type: 'TOAST', text })}
          onSave={async (dataUrl) => {
            if (info.editable) {
              // One Switchyard keeps: saved over, so wherever it shows is updated.
              await window.api.images.save(view.ref, dataUrl)
              imageChanged(view.ref)
              dispatch({ type: 'TOAST', text: `Annotated ${name} - updated wherever it shows.`, tone: 'done' })
            } else {
              // A file of yours (a repository's image): left as it is - the annotation is a copy, for an agent.
              const copy = (await window.api.attachments.save(dataUrl)).replace(/\\/g, '/')
              const task = view.taskId ? state.tasks.find((t) => t.id === view.taskId) : undefined
              const agent = task?.agentKind ? agentShort(task.agentKind) : ''
              dispatch({
                type: 'TOAST',
                text: `Saved an annotated copy of ${name} - ${name} itself is unchanged.`,
                tone: 'done',
                action: task && agent ? { label: `Send to ${agent}`, run: () => dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: `An annotated image of ${name} - open and look at it: ${copy}`, toast: `Sent to ${agent}.` }) } : { label: 'Show', run: () => viewImage(copy) }
              })
              if (!(task && agent)) return void viewImage(copy)
            }
            if (view.mode === 'annotate') closeImage()
            else {
              setMode('view')
              setVersion((v) => v + 1)
            }
          }}
        />
      ) : (
        <Viewer src={src} name={name} info={info} onAnnotate={() => setMode('annotate')} />
      )}
    </div>,
    document.body
  )
}

function Center({ text, onClose }: { text: string; onClose?: () => void }): React.JSX.Element {
  useEsc(onClose ?? closeImage)
  return (
    <div onClick={onClose ?? closeImage} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '13px var(--font-ui)', color: 'var(--t3)' }}>
      {text}
    </div>
  )
}

function useEsc(fn: () => void): void {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [fn])
}

/** The bar over the picture. */
function Bar({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ flex: 'none', height: 46, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: 'var(--bg-panel)', borderBottom: '1px solid var(--bd-2)', font: '12.5px var(--font-ui)', color: 'var(--t2)' }}>
      {children}
    </div>
  )
}

function Viewer({ src, name, info, onAnnotate }: { src: string; name: string; info: { path: string | null; editable: boolean }; onAnnotate: () => void }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const area = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [fit, setFit] = useState(1)
  // null: fitted to the window.
  const [zoom, setZoom] = useState<number | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const scale = zoom ?? fit
  useEsc(closeImage)

  useLayoutEffect(() => {
    const el = area.current
    if (!el || !nat) return
    const measure = (): void => setFit(Math.min(1, (el.clientWidth - 48) / nat.w, (el.clientHeight - 48) / nat.h))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [nat])

  const setScale = useCallback((s: number | null) => {
    setZoom(s === null ? null : Math.max(0.05, Math.min(16, s)))
    if (s === null) setPan({ x: 0, y: 0 })
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '+' || e.key === '=') setScale(scale * 1.25)
      else if (e.key === '-') setScale(scale / 1.25)
      else if (e.key === '0') setScale(null)
      else if (e.key === '1') setScale(1)
      else if (e.key === 'a' || e.key === 'A') onAnnotate()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [scale, onAnnotate, setScale])

  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  return (
    <>
      <Bar>
        <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={info.path ?? name}>
          {name}
        </span>
        {nat ? <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap' }}>{nat.w}×{nat.h}</span> : null}
        <span style={{ flex: 1 }} />
        <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t3)', minWidth: 44, textAlign: 'right' }}>{Math.round(scale * 100)}%</span>
        <Button size="xs" onClick={() => setScale(null)} title="Fit the window (0)">
          Fit
        </Button>
        <Button size="xs" onClick={() => setScale(1)} title="Actual size (1)">
          100%
        </Button>
        <Button
          size="xs"
          variant="primary"
          onClick={onAnnotate}
          title={info.editable ? 'Draw on it - arrows, boxes, a highlight, a blur over a secret (A)' : 'Draw on a copy - this image is a file of yours (a repository’s), which stays as it is (A)'}
        >
          {info.editable ? 'Annotate' : 'Annotate a copy'}
        </Button>
        {info.path ? (
          <>
            <Button size="xs" onClick={() => window.api.sys.reveal(info.path!).catch(toastErr)} title="Open it in its app">
              Open
            </Button>
            <Button size="xs" onClick={() => window.api.sys.showItem(info.path!).catch(toastErr)} title={revealLabel}>
              Show in folder
            </Button>
          </>
        ) : null}
        <Button size="xs" onClick={closeImage} title="Close (Esc)">
          ✕
        </Button>
      </Bar>
      <div
        ref={area}
        onClick={(e) => {
          // A click on the dark around it closes it (not the end of a drag).
          if (e.target === e.currentTarget && !drag.current) closeImage()
        }}
        onWheel={(e) => setScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) return
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (d && e.buttons) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
        }}
        onMouseUp={() => setTimeout(() => (drag.current = null), 0)}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: scale > fit ? 'grab' : 'default' }}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            width: nat ? nat.w * scale : undefined,
            height: nat ? nat.h * scale : undefined,
            maxWidth: 'none',
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            boxShadow: '0 10px 40px color-mix(in srgb, var(--sh) 50%, transparent)',
            imageRendering: scale > 2 ? 'pixelated' : 'auto',
            userSelect: 'none'
          }}
        />
      </div>
    </>
  )
}

/* ---------- the annotator ---------- */

type Tool = 'arrow' | 'box' | 'mark' | 'pen' | 'blur'
type Pt = [number, number]
interface Shape {
  tool: Tool
  color: string
  w: number
  pts: Pt[]
}

const COLORS = ANNOTATION_COLORS
const TOOLS: [Tool, string, string][] = [
  ['arrow', 'Arrow', 'Point at something'],
  ['box', 'Box', 'Frame something'],
  ['mark', 'Highlight', 'A see-through marker over something'],
  ['pen', 'Pen', 'Draw freely'],
  ['blur', 'Blur', 'Hide a secret (a key, a password, an email) - pixelated for good when saved']
]

/** Draws a shape onto the picture (`img`: the picture as it was, which a blur pixelates). */
function drawShape(g: CanvasRenderingContext2D, s: Shape, img: HTMLImageElement): void {
  const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]
  const x = Math.min(a[0], b[0])
  const y = Math.min(a[1], b[1])
  const w = Math.abs(b[0] - a[0])
  const h = Math.abs(b[1] - a[1])
  g.save()
  g.strokeStyle = s.color
  g.fillStyle = s.color
  g.lineWidth = s.w
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (s.tool === 'box') g.strokeRect(x, y, w, h)
  else if (s.tool === 'mark') {
    g.globalAlpha = 0.35
    g.fillRect(x, y, w, h)
  } else if (s.tool === 'pen') {
    g.beginPath()
    s.pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)))
    g.stroke()
  } else if (s.tool === 'arrow') {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    const head = s.w * 4.5
    g.beginPath()
    g.moveTo(a[0], a[1])
    g.lineTo(b[0] - Math.cos(ang) * head * 0.8, b[1] - Math.sin(ang) * head * 0.8)
    g.stroke()
    g.beginPath()
    g.moveTo(b[0], b[1])
    g.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45))
    g.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45))
    g.closePath()
    g.fill()
  } else if (s.tool === 'blur' && w > 1 && h > 1) {
    // Pixelated from the picture itself: big blocks, so nothing under it can be read back.
    const block = Math.max(8, Math.round(Math.min(w, h) / 6))
    const sw = Math.max(1, Math.round(w / block))
    const sh = Math.max(1, Math.round(h / block))
    const tmp = document.createElement('canvas')
    tmp.width = sw
    tmp.height = sh
    tmp.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, sw, sh)
    g.imageSmoothingEnabled = false
    g.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
  }
  g.restore()
}

/**
 * Draws on a picture: `onSave` gets it, drawn on, as a PNG data: URL (the
 * viewer saves it over the image or as a copy; Quick capture attaches it).
 */
export function Annotator({ src, onCancel, onSave, onError }: { src: string; onCancel: () => void; onSave: (dataUrl: string) => Promise<void>; onError: (text: string) => void }): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [undone, setUndone] = useState<Shape[]>([])
  const [saving, setSaving] = useState(false)
  const drawing = useRef<Shape | null>(null)
  const [, setTick] = useState(0)
  // The canvas's size on screen: the picture fitted to the space (scaled up to 4× when small).
  const stage = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = stage.current
    const img = imgRef.current
    if (!el || !img || !ready) return
    const measure = (): void => {
      const k = Math.min(4, (el.clientWidth - 48) / img.naturalWidth, (el.clientHeight - 48) / img.naturalHeight)
      setShown({ w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ready])

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const c = canvas.current
      if (c) {
        c.width = img.naturalWidth
        c.height = img.naturalHeight
      }
      setReady(true)
    }
    img.src = src
  }, [src])

  // Everything drawn again: the picture, then the shapes in order (and the one being drawn).
  const paint = useCallback(() => {
    const c = canvas.current
    const img = imgRef.current
    if (!c || !img) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0)
    for (const s of shapes) drawShape(g, s, img)
    if (drawing.current) drawShape(g, drawing.current, img)
  }, [shapes])
  useEffect(paint, [paint, ready])

  const strokeW = Math.max(3, Math.round((imgRef.current?.naturalWidth ?? 1200) / 320))
  const at = (e: React.PointerEvent): Pt => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]
  }
  const undo = (): void => {
    if (!shapes.length) return
    setUndone((u) => [shapes[shapes.length - 1], ...u])
    setShapes((s) => s.slice(0, -1))
  }
  const redo = (): void => {
    if (!undone.length) return
    setShapes((s) => [...s, undone[0]])
    setUndone((u) => u.slice(1))
  }
  const save = async (): Promise<void> => {
    const c = canvas.current
    if (!c || saving) return
    if (!shapes.length) return onCancel()
    setSaving(true)
    try {
      await onSave(c.toDataURL('image/png'))
    } catch (err) {
      setSaving(false)
      onError(`Could not save the annotation: ${errText(err)}`)
    }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') onCancel()
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) undo()
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) redo()
      else if ((mod && e.key.toLowerCase() === 's') || (mod && e.key === 'Enter')) void save()
      else if (!mod && /^[1-5]$/.test(e.key)) setTool(TOOLS[Number(e.key) - 1][0])
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  return (
    <>
      <Bar>
        <span style={{ font: '600 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--c-blue)' }}>Annotate</span>
        <span style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, border: '1px solid var(--bd-2)' }}>
          {TOOLS.map(([t, label, tip], i) => (
            <span
              key={t}
              onClick={() => setTool(t)}
              title={`${tip} (${i + 1})`}
              style={{ padding: '3px 10px', borderRadius: 4, cursor: 'pointer', color: tool === t ? 'var(--t1)' : 'var(--t3)', background: tool === t ? 'var(--bg-hover)' : 'transparent' }}
            >
              {label}
            </span>
          ))}
        </span>
        <span style={{ display: 'flex', gap: 5, opacity: tool === 'blur' ? 0.3 : 1 }} title={tool === 'blur' ? 'A blur has no colour' : 'Colour'}>
          {COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              style={{ width: 16, height: 16, borderRadius: 8, background: c, cursor: 'pointer', boxShadow: color === c ? '0 0 0 2px var(--bg-panel), 0 0 0 4px var(--c-blue)' : 'inset 0 0 0 1px var(--bd-4)' }}
            />
          ))}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="xs" disabled={!shapes.length} onClick={undo} title="Undo (Ctrl/⌘+Z)">
          Undo
        </Button>
        <Button size="xs" disabled={!undone.length} onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)">
          Redo
        </Button>
        <Button size="xs" onClick={onCancel} title="Leave it as it was (Esc)">
          Cancel
        </Button>
        <Button size="xs" variant="primary" disabled={saving || !shapes.length} onClick={() => void save()} title="Save it over the image - wherever it shows is updated (Ctrl/⌘+S)">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Bar>
      <div ref={stage} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'hidden' }}>
        <canvas
          ref={canvas}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = at(e)
            drawing.current = { tool, color, w: tool === 'mark' ? strokeW : strokeW, pts: [p, p] }
            paint()
          }}
          onPointerMove={(e) => {
            const d = drawing.current
            if (!d) return
            const p = at(e)
            d.pts = d.tool === 'pen' ? [...d.pts, p] : [d.pts[0], p]
            paint()
            setTick((t) => t + 1)
          }}
          onPointerUp={() => {
            const d = drawing.current
            drawing.current = null
            if (!d) return
            const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]]
            // (A click, not a drag: nothing.)
            if (d.tool !== 'pen' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return paint()
            setShapes((s) => [...s, d])
            setUndone([])
          }}
          // (As big as the space allows - a small picture scaled up to draw on, up to 4×.)
          style={{ width: shown?.w, height: shown?.h, cursor: 'crosshair', boxShadow: '0 10px 40px color-mix(in srgb, var(--sh) 50%, transparent)', touchAction: 'none', visibility: ready ? 'visible' : 'hidden' }}
        />
      </div>
    </>
  )
}

