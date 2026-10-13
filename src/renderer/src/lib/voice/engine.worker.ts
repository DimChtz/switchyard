/**
 * Speech to text, on this machine: Whisper (ONNX) through transformers.js,
 * in a worker so the window never waits on it. The model is downloaded once
 * (Hugging Face) and kept in the app's cache; the engine itself ships with
 * the app. It runs on the GPU (WebGPU) when there is one, else the CPU.
 */
import { env, pipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

// The engine's files from the app (not a CDN), loaded as they are (a blob: import would need a looser CSP).
env.allowLocalModels = false
env.useWasmCache = false
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }

type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>

export type ToEngine = { type: 'load'; id: number; model: string } | { type: 'transcribe'; id: number; model: string; audio: Float32Array; language: string }
export type FromEngine =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; id: number; device: 'gpu' | 'cpu' }
  | { type: 'text'; id: number; text: string }
  | { type: 'error'; id: number; message: string }

const post = (m: FromEngine): void => (self as unknown as { postMessage: (m: FromEngine) => void }).postMessage(m)

let current: { model: string; asr: Promise<{ asr: Asr; device: 'gpu' | 'cpu' }> } | null = null

async function load(model: string): Promise<{ asr: Asr; device: 'gpu' | 'cpu' }> {
  const id = `onnx-community/whisper-${model}`
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
  }
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (gpu && (await gpu.requestAdapter().catch(() => null))) {
    try {
      const asr = await pipeline('automatic-speech-recognition', id, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback })
      return { asr: asr as unknown as Asr, device: 'gpu' }
    } catch {
      // (A GPU it can't use: the CPU below.)
    }
  }
  const asr = await pipeline('automatic-speech-recognition', id, { device: 'wasm', dtype: 'q8', progress_callback })
  return { asr: asr as unknown as Asr, device: 'cpu' }
}

self.onmessage = async (e: MessageEvent<ToEngine>): Promise<void> => {
  const m = e.data
  try {
    if (!current || current.model !== m.model) current = { model: m.model, asr: load(m.model) }
    const engine = current
    const { asr, device } = await engine.asr.catch((err: unknown) => {
      // (A failed download is tried again next time.)
      if (current === engine) current = null
      throw err
    })
    if (m.type === 'load') return post({ type: 'ready', id: m.id, device })
    const out = await asr(m.audio, { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, ...(m.language ? { language: m.language } : {}) })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).replace(/\s+/g, ' ').trim()
    post({ type: 'text', id: m.id, text })
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) })
  }
}
