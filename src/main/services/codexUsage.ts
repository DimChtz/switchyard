import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import type { UsageEntry, UsageTokens } from '@shared/usage'
import { codexHome, readCodexSession, samePath } from './outside'

/**
 * Codex's token use, from its session logs (CODEX_HOME/sessions/Y/M/D/
 * rollout-*.jsonl): each `token_count` event carries the session's running
 * total, so what a step used is how much the total grew. The model is the
 * latest `turn_context`'s. OpenAI counts cached input inside input; here it's
 * split out (it costs a tenth).
 */

interface Totals {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
}

const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function codexDailyUsage(text: string): UsageEntry['days'] {
  const days: UsageEntry['days'] = {}
  let model = 'gpt-5-codex'
  let prev: Required<Totals> = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 }
  for (const raw of text.split('\n')) {
    if (!raw.includes('token_count') && !raw.includes('turn_context')) continue
    let line: { timestamp?: string; type?: string; payload?: { type?: string; model?: string; info?: { total_token_usage?: Totals } | null } }
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    const p = line.payload
    if (line.type === 'turn_context' && p?.model) {
      model = p.model
      continue
    }
    const total = p?.type === 'token_count' ? p.info?.total_token_usage : undefined
    if (!total) continue
    const now = { input_tokens: total.input_tokens ?? 0, cached_input_tokens: total.cached_input_tokens ?? 0, output_tokens: total.output_tokens ?? 0 }
    const d = { input: now.input_tokens - prev.input_tokens, cached: now.cached_input_tokens - prev.cached_input_tokens, output: now.output_tokens - prev.output_tokens }
    prev = now
    if (d.input <= 0 && d.output <= 0) continue
    const day = dayOf(Date.parse(line.timestamp ?? '') || Date.now())
    const t: UsageTokens = ((days[day] ??= {})[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    const cached = Math.max(0, d.cached)
    t.input += Math.max(0, d.input - cached)
    t.cacheRead += cached
    t.output += Math.max(0, d.output)
  }
  return days
}

/** Codex sessions that ran in `folder` since `since` (their logs are filed by day). */
export async function codexSessionsIn(folder: string, since: number): Promise<{ id: string; path: string }[]> {
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return []
  const out: { id: string; path: string }[] = []
  const DAY = 86_400_000
  for (let t = Date.now(); t >= since - DAY; t -= DAY) {
    const d = new Date(t)
    const dir = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    for (const f of (await fs.readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith('.jsonl'))) {
      try {
        const s = await readCodexSession(join(dir, f))
        if (s && s.at >= since && samePath(s.cwd, folder)) out.push({ id: s.id, path: s.path })
      } catch {
        // unreadable - skip it
      }
    }
  }
  return out
}
