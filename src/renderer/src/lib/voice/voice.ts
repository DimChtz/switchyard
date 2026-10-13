import { useSyncExternalStore } from 'react'
import type { FromEngine, ToEngine } from './engine.worker'

/**
 * Voice input: dictate into whatever you were typing in - an agent's
 * terminal, a message, a note, a comment. The shortcut (or the mic in the
 * status bar) starts listening and stops it; held down, it's push-to-talk.
 * The text goes in where the cursor was, without pressing Enter.
 */

export type VoicePhase = 'idle' | 'listening' | 'transcribing'

export interface VoiceState {
  phase: VoicePhase
  /** When listening started (ms). */
  since: number
  /** How loud it is now, 0-1 (the meter). */
  level: number
  /** The model downloading (the first time): bytes so far and in all. */
  download: { loaded: number; total: number } | null
  /** Where the engine runs, once it's loaded. */
  device: 'gpu' | 'cpu' | null
  /** Where the text will go, said in the indicator. */
  target: string | null
}

let state: VoiceState = { phase: 'idle', since: 0, level: 0, download: null, device: null, target: null }
const listeners = new Set<() => void>()
function set(patch: Partial<VoiceState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useVoice(): VoiceState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

// ── Where the words go ──

type Target = { kind: 'terminal'; paste: (text: string) => void; label: string } | { kind: 'field'; el: HTMLElement; label: string } | null

/** The terminals on screen, so dictation into a focused one types into its program. */
const terminals = new Map<HTMLElement, { paste: (text: string) => void; label: string }>()
export function registerTerminal(el: HTMLElement, paste: (text: string) => void, label: string): () => void {
  terminals.set(el, { paste, label })
  return () => terminals.delete(el)
}

function captureTarget(): Target {
  const a = document.activeElement as HTMLElement | null
  if (!a || a === document.body) return null
  for (const [el, t] of terminals) if (el.contains(a)) return { kind: 'terminal', paste: t.paste, label: t.label }
  const field = a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test((a as HTMLInputElement).type)) || a.isContentEditable
  if (!field) return null
  const named = a.getAttribute('aria-label') || a.getAttribute('placeholder') || ''
  // (Short: a field's placeholder can be a sentence.)
  const label = a.closest('.cm-editor') ? 'the editor' : named && named.length <= 28 ? `“${named.replace(/[….]+$/, '')}”` : 'the text field'
  return { kind: 'field', el: a, label }
}

/** Whisper's words for silence, not something you said. */
const NOISE = /^\s*(\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you)\s*$/i

export function cleanTranscript(text: string): string {
  const t = text
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return NOISE.test(t) ? '' : t
}

function insert(target: Target, text: string, onNowhere: (text: string) => void): void {
  if (target?.kind === 'terminal') return target.paste(text)
  if (target?.kind === 'field' && target.el.isConnected) {
    const el = target.el
    el.focus()
    // A space between it and a word right before the cursor.
    let before = ''
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) before = el.value.slice(0, el.selectionStart ?? el.value.length).slice(-1)
    const spaced = before && !/\s/.test(before) ? ` ${text}` : text
    // (Typed in as the keyboard would: undo, React's onChange and CodeMirror all see it.)
    if (document.execCommand('insertText', false, spaced)) return
  }
  onNowhere(text)
}

// ── The engine (a worker, started the first time) ──

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { ok: (m: FromEngine) => void; fail: (e: Error) => void }>()

function engine(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<FromEngine>) => {
    const m = e.data
    if (m.type === 'progress') {
      // (Several files download at once: the sum of them.)
      downloads.set(m.file, { loaded: m.loaded, total: m.total })
      const all = [...downloads.values()]
      set({ download: { loaded: all.reduce((n, d) => n + d.loaded, 0), total: all.reduce((n, d) => n + d.total, 0) } })
      return
    }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.type === 'error') p.fail(new Error(m.message))
    else p.ok(m)
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.fail(new Error(e.message || 'The voice engine stopped'))
    pending.clear()
    worker = null
  }
  return worker
}
const downloads = new Map<string, { loaded: number; total: number }>()

/** A message to the engine, before it gets its id. */
type EngineRequest = ToEngine extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never

function ask(msg: EngineRequest, transfer: Transferable[] = []): Promise<FromEngine> {
  const id = ++seq
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail })
    engine().postMessage({ ...msg, id } as ToEngine, transfer)
  })
}

/** Loads the model (downloading it the first time) - Settings' "Download now", and while you speak. */
export async function preloadVoice(model: string): Promise<void> {
  downloads.clear()
  try {
    const m = await ask({ type: 'load', model })
    if (m.type === 'ready') set({ device: m.device })
  } finally {
    set({ download: null })
  }
}

/** Whether a model is already downloaded (in the app's cache). */
export async function voiceModelReady(model: string): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache')
    return (await cache.keys()).some((r) => r.url.includes(`whisper-${model}/`) && /decoder/.test(r.url))
  } catch {
    return false
  }
}

// ── Recording ──

interface Recording {
  stream: MediaStream
  ctx: AudioContext
  chunks: Float32Array[]
  peak: number
  target: Target
  byKey: boolean
  stopKeys: () => void
  timer: ReturnType<typeof setTimeout>
}
let rec: Recording | null = null

export interface VoiceOptions {
  model: string
  language: string
  /** Something went wrong, or there's nothing to say where the text went. */
  toast: (text: string, action?: { label: string; run: () => void }) => void
}

/** Five minutes at most in one go. */
const MAX_MS = 5 * 60_000

/** The shortcut or the mic: starts listening, or stops and types what was said. */
export function toggleVoice(o: VoiceOptions, byKey = false): void {
  if (state.phase === 'listening') void stopVoice(o)
  else if (state.phase === 'idle') void startVoice(o, byKey)
}

async function startVoice(o: VoiceOptions, byKey: boolean): Promise<void> {
  const target = captureTarget()
  set({ phase: 'listening', since: Date.now(), level: 0, target: target?.label ?? null })
  try {
    if (!(await window.api.sys.micAccess())) throw new Error('Switchyard isn’t allowed to use the microphone - allow it in your system’s privacy settings.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    // Whisper takes 16 kHz mono: the browser resamples.
    const ctx = new AudioContext({ sampleRate: 16000 })
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(4096, 1, 1)
    const r: Recording = { stream, ctx, chunks: [], peak: 0, target, byKey, stopKeys: () => {}, timer: setTimeout(() => void stopVoice(o), MAX_MS) }
    proc.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0))
      r.chunks.push(data)
      let sum = 0
      for (const v of data) sum += v * v
      const rms = Math.sqrt(sum / data.length)
      r.peak = Math.max(r.peak, rms)
      set({ level: Math.min(1, rms * 8) })
    }
    source.connect(proc)
    proc.connect(ctx.destination)
    // Escape cancels; holding the shortcut and letting go of Space stops (push-to-talk).
    const onKey = (e: KeyboardEvent): void => {
      if (e.type === 'keydown' && e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelVoice()
      } else if (e.type === 'keyup' && r.byKey && e.code === 'Space' && Date.now() - state.since > 700) void stopVoice(o)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    r.stopKeys = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
    rec = r
    // The model loads (or downloads) while you speak.
    preloadVoice(o.model).catch(() => {})
  } catch (err) {
    set({ phase: 'idle', level: 0 })
    o.toast(err instanceof Error && err.name === 'NotAllowedError' ? 'Switchyard isn’t allowed to use the microphone.' : `Voice input: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function release(r: Recording): void {
  clearTimeout(r.timer)
  r.stopKeys()
  for (const t of r.stream.getTracks()) t.stop()
  void r.ctx.close()
}

/** Stops listening without typing anything. */
export function cancelVoice(): void {
  if (rec) release(rec)
  rec = null
  set({ phase: 'idle', level: 0 })
}

async function stopVoice(o: VoiceOptions): Promise<void> {
  const r = rec
  if (!r) return set({ phase: 'idle' })
  rec = null
  release(r)
  const length = r.chunks.reduce((n, c) => n + c.length, 0)
  // Too short, or nothing louder than the room: nothing to type.
  if (length < 16000 * 0.4 || r.peak < 0.01) {
    set({ phase: 'idle', level: 0 })
    return o.toast(length < 16000 * 0.4 ? 'Too short to hear anything - hold the shortcut while you speak, or press it again to stop.' : 'Didn’t hear anything - is the right microphone selected?')
  }
  const audio = new Float32Array(length)
  let at = 0
  for (const c of r.chunks) {
    audio.set(c, at)
    at += c.length
  }
  set({ phase: 'transcribing', level: 0 })
  try {
    const m = await ask({ type: 'transcribe', model: o.model, audio, language: o.language }, [audio.buffer])
    const text = m.type === 'text' ? cleanTranscript(m.text) : ''
    if (!text) o.toast('Didn’t catch any words.')
    else insert(r.target, text, (t) => o.toast(`Heard: “${t.length > 80 ? `${t.slice(0, 80)}…` : t}”`, { label: 'Copy', run: () => window.api.sys.copy(t) }))
  } catch (err) {
    o.toast(`Voice input: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    set({ phase: 'idle', download: null })
  }
}
