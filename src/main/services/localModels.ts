import { DEFAULT_URL, type LocalModel, type LocalProvider } from '@shared/localModels'
import { getPrefs } from './store'

/**
 * The models Ollama and LM Studio have on this machine - asked of their
 * local servers (a short wait each: one that isn't running just has none).
 */
export interface LocalModels {
  models: LocalModel[]
  /** Providers whose server answered. */
  running: LocalProvider[]
}

let cached: { at: number; value: LocalModels } | null = null

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export function providerUrls(): Record<LocalProvider, string> {
  const p = getPrefs()
  return { ollama: (p.ollamaUrl || DEFAULT_URL.ollama).replace(/\/+$/, ''), lmstudio: (p.lmStudioUrl || DEFAULT_URL.lmstudio).replace(/\/+$/, '') }
}

export async function listLocalModels(fresh = false): Promise<LocalModels> {
  if (cached && !fresh && Date.now() - cached.at < 30_000) return cached.value
  const urls = providerUrls()
  const [ollama, lmstudio] = await Promise.all([
    getJson(`${urls.ollama}/api/tags`)
      .then((j) => ((j as { models?: { name?: string; size?: number }[] }).models ?? []).filter((m) => m.name).map((m): LocalModel => ({ provider: 'ollama', name: m.name!, size: m.size })))
      .catch(() => null),
    getJson(`${urls.lmstudio}/v1/models`)
      .then((j) =>
        ((j as { data?: { id?: string }[] }).data ?? [])
          // (Embedding models can't drive an agent.)
          .filter((m) => m.id && !/embed/i.test(m.id))
          .map((m): LocalModel => ({ provider: 'lmstudio', name: m.id! }))
      )
      .catch(() => null)
  ])
  const value: LocalModels = {
    models: [...(ollama ?? []), ...(lmstudio ?? [])],
    running: [...(ollama ? (['ollama'] as const) : []), ...(lmstudio ? (['lmstudio'] as const) : [])]
  }
  cached = { at: Date.now(), value }
  return value
}
