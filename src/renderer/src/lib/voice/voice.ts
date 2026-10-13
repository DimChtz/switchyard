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
  /** What it has heard so far (the live preview, while listening). */
  partial: string
}

let state: VoiceState = { phase: 'idle', since: 0, level: 0, download: null, device: null, target: null, partial: '' }
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

type Target = { kind: 'terminal'; paste: (text: string) => void; enter: () => void; label: string } | { kind: 'field'; el: HTMLElement; label: string } | null

/** The terminals on screen, so dictation into a focused one types into its program. */
const terminals = new Map<HTMLElement, { paste: (text: string) => void; enter: () => void; label: string }>()
export function registerTerminal(el: HTMLElement, paste: (text: string) => void, enter: () => void, label: string): () => void {
  terminals.set(el, { paste, enter, label })
  return () => terminals.delete(el)
}

function captureTarget(): Target {
  const a = document.activeElement as HTMLElement | null
  if (!a || a === document.body) return null
  for (const [el, t] of terminals) if (el.contains(a)) return { kind: 'terminal', paste: t.paste, enter: t.enter, label: t.label }
  const field = a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test((a as HTMLInputElement).type)) || a.isContentEditable
  if (!field) return null
  const named = a.getAttribute('aria-label') || a.getAttribute('placeholder') || ''
  // (Short: a field's placeholder can be a sentence.)
  const label = a.closest('.cm-editor') ? 'the editor' : named && named.length <= 28 ? `“${named.replace(/[….]+$/, '')}”` : 'the text field'
  return { kind: 'field', el: a, label }
}

/**
 * Spoken commands in what was said: "new line" and "new paragraph" become
 * line breaks; "send" (or "send it", "submit") at the end presses Enter once
 * it's typed in; "scratch that" at the end throws the whole thing away.
 */
export function voiceCommands(text: string): { text: string; send: boolean; discard: boolean } {
  let t = text.trim()
  if (/\bscratch that[.!]?$/i.test(t)) return { text: '', send: false, discard: true }
  let send = false
  const end = /[,.;]?\s*\b(?:send(?: it)?|submit)[.!]?$/i
  if (end.test(t)) {
    send = true
    t = t.replace(end, '').trim()
  }
  t = t
    .replace(/[,.;]?\s*\bnew paragraph\b[,.;]?\s*/gi, '\n\n')
    .replace(/[,.;]?\s*\bnew line\b[,.;]?\s*/gi, '\n')
    // ("…page.\nAnd" - Whisper capitalizes after the break itself.)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return { text: t, send, discard: false }
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

/** "Send": Enter in a terminal; in a field, the app's send key (Ctrl/⌘+Enter - plain Enter in a one-line field). */
function pressEnter(target: Target): void {
  if (target?.kind === 'terminal') return target.enter()
  if (target?.kind !== 'field') return
  const mac = window.electron.process.platform === 'darwin'
  const multi = target.el.tagName === 'TEXTAREA' || target.el.isContentEditable
  target.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: multi && !mac, metaKey: multi && mac }))
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
  live: ReturnType<typeof setInterval> | null
}
let rec: Recording | null = null

export interface VoiceOptions {
  model: string
  language: string
  /** "send", "new line", "scratch that". */
  commands: boolean
  /** Show the words while you speak. */
  live: boolean
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
    const r: Recording = { stream, ctx, chunks: [], peak: 0, target, byKey, stopKeys: () => {}, timer: setTimeout(() => void stopVoice(o), MAX_MS), live: null }
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
    set({ partial: '' })
    // The model loads (or downloads) while you speak; then, the words so far every few seconds.
    preloadVoice(o.model)
      .then(() => {
        if (o.live && rec === r) r.live = setInterval(() => void livePreview(r, o), 2000)
      })
      .catch(() => {})
  } catch (err) {
    set({ phase: 'idle', level: 0 })
    o.toast(err instanceof Error && err.name === 'NotAllowedError' ? 'Switchyard isn’t allowed to use the microphone.' : `Voice input: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Seconds of speech the preview looks at (the end of what was said). */
const PREVIEW_SECONDS = 20
let previewing = false

async function livePreview(r: Recording, o: VoiceOptions): Promise<void> {
  if (previewing || rec !== r) return
  const length = r.chunks.reduce((n, c) => n + c.length, 0)
  if (length < 16000 || r.peak < 0.01) return
  previewing = true
  try {
    const want = Math.min(length, 16000 * PREVIEW_SECONDS)
    const audio = new Float32Array(want)
    // (The newest chunks, back to front.)
    let at = want
    for (let i = r.chunks.length - 1; i >= 0 && at > 0; i--) {
      const c = r.chunks[i]
      const take = Math.min(c.length, at)
      audio.set(c.subarray(c.length - take), at - take)
      at -= take
    }
    const m = await ask({ type: 'transcribe', model: o.model, audio, language: o.language }, [audio.buffer])
    if (rec === r && m.type === 'text') set({ partial: (length > want ? '… ' : '') + cleanTranscript(m.text) })
  } catch {
    // (Only a preview.)
  } finally {
    previewing = false
  }
}

function release(r: Recording): void {
  clearTimeout(r.timer)
  if (r.live) clearInterval(r.live)
  r.stopKeys()
  for (const t of r.stream.getTracks()) t.stop()
  void r.ctx.close()
}

/** Stops listening without typing anything. */
export function cancelVoice(): void {
  if (rec) release(rec)
  rec = null
  set({ phase: 'idle', level: 0, partial: '' })
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
    const heard = m.type === 'text' ? cleanTranscript(m.text) : ''
    const said = o.commands ? voiceCommands(heard) : { text: heard, send: false, discard: false }
    if (said.discard) o.toast('Scratched - nothing typed.')
    else if (!said.text && !said.send) o.toast('Didn’t catch any words.')
    else {
      let typed = true
      if (said.text) insert(r.target, said.text, (t) => {
        typed = false
        o.toast(`Heard: “${t.length > 80 ? `${t.slice(0, 80)}…` : t}”`, { label: 'Copy', run: () => window.api.sys.copy(t) })
      })
      // ("Send": once what was said is in - a terminal's program reads a paste and an Enter apart.)
      if (said.send && typed) setTimeout(() => pressEnter(r.target), said.text.includes('\n') ? 150 : 60)
    }
  } catch (err) {
    o.toast(`Voice input: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    set({ phase: 'idle', download: null, partial: '' })
  }
}
