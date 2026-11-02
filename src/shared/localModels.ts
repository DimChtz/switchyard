import type { AgentKind } from './types'

/**
 * Models running on this machine - Ollama, LM Studio - for agents that can
 * use them: free, private, offline. A task's model "ollama/qwen2.5-coder:7b"
 * or "lmstudio/qwen2.5-coder-7b" becomes the agent's own way of saying so.
 */
export type LocalProvider = 'ollama' | 'lmstudio'

export interface LocalModel {
  provider: LocalProvider
  name: string
  /** Bytes on disk, when the provider says. */
  size?: number
}

export const PROVIDER_LABEL: Record<LocalProvider, string> = { ollama: 'Ollama', lmstudio: 'LM Studio' }
export const DEFAULT_URL: Record<LocalProvider, string> = { ollama: 'http://127.0.0.1:11434', lmstudio: 'http://127.0.0.1:1234' }

/** Which agents can use which (Aider through LiteLLM; Codex's --oss is Ollama). */
export const LOCAL_SUPPORT: Partial<Record<AgentKind, LocalProvider[]>> = {
  aider: ['ollama', 'lmstudio'],
  codex: ['ollama']
}

export function localModelId(m: Pick<LocalModel, 'provider' | 'name'>): string {
  return `${m.provider}/${m.name}`
}

export function parseLocalModel(model: string | null | undefined): { provider: LocalProvider; name: string } | null {
  const m = (model ?? '').trim().match(/^(ollama|lmstudio)\/(.+)$/)
  return m ? { provider: m[1] as LocalProvider, name: m[2] } : null
}

/** Whether this agent runs this task's local model (else the model goes to it as typed). */
export function runsLocal(kind: AgentKind | null | undefined, model: string | null | undefined): boolean {
  const local = parseLocalModel(model)
  return !!kind && !!local && !!LOCAL_SUPPORT[kind]?.includes(local.provider)
}

/** The agent's arguments for a local model; null when the model isn't one it runs locally. */
export function localModelArgs(kind: AgentKind | null | undefined, model: string | null | undefined): string[] | null {
  const local = parseLocalModel(model)
  if (!local || !runsLocal(kind, model)) return null
  if (kind === 'aider') return ['--model', `${local.provider === 'ollama' ? 'ollama_chat' : 'lm_studio'}/${local.name}`]
  if (kind === 'codex') return ['--oss', '--model', local.name]
  return null
}

/** Where the agent finds the provider (its own variables). */
export function localModelEnv(kind: AgentKind | null | undefined, model: string | null | undefined, urls: Partial<Record<LocalProvider, string>>): Record<string, string> {
  const local = parseLocalModel(model)
  if (!local || !runsLocal(kind, model)) return {}
  const url = (urls[local.provider] || DEFAULT_URL[local.provider]).replace(/\/+$/, '')
  if (kind === 'aider') return local.provider === 'ollama' ? { OLLAMA_API_BASE: url } : { LM_STUDIO_API_BASE: `${url}/v1`, LM_STUDIO_API_KEY: 'lm-studio' }
  // Codex's local provider reads its address from here.
  if (kind === 'codex') return { CODEX_OSS_BASE_URL: `${url}/v1` }
  return {}
}
