/**
 * What agents used: tokens per session, by day and model, read from Claude
 * Code's transcripts and Codex's session logs - and what that would cost at
 * API prices. (A
 * subscription isn't billed per token; the cost is what the same work costs
 * through the API.) Kept apart from tasks, so it outlives them.
 */

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** One agent session's usage. */
export interface UsageEntry {
  sessionId: string
  taskId: string
  taskKey: string
  title: string
  projectId: string
  /** Which agent (older entries: Claude Code). */
  agentKind?: string
  /** Local day (YYYY-MM-DD) → model → tokens. */
  days: Record<string, Record<string, UsageTokens>>
  updatedAt: number
}

/** A model's price in US dollars per million tokens. */
export interface ModelPrice {
  input: number
  output: number
  /** Default: 1.25× input (5-minute cache writes). */
  cacheWrite?: number
  /** Default: 0.1× input. */
  cacheRead?: number
}

/**
 * Published API prices for the models it knows, matched by the start of the
 * model's id (the longest match wins). Others need a price in Settings →
 * Agents to show a cost.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // (Dated ids for the x.0 models, so a newer 4.x isn't taken for them.)
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4-2025': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-2025': { input: 3, output: 15 },
  'claude-3-7-sonnet': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-5-haiku': { input: 0.8, output: 4 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // OpenAI (Codex): cached input is a tenth of the price; writing the cache costs nothing extra.
  'gpt-5': { input: 1.25, output: 10, cacheWrite: 0 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheWrite: 0 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheWrite: 0 }
}

export const ZERO: UsageTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function addTokens(a: UsageTokens, b: UsageTokens): UsageTokens {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }
}

export function totalTokens(t: UsageTokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

/** The price for a model: the user's (by exact id or prefix) over the defaults; null when unknown. */
export function priceOf(model: string, overrides: Record<string, ModelPrice> = {}): ModelPrice | null {
  const find = (table: Record<string, ModelPrice>): ModelPrice | null => {
    let best: [string, ModelPrice] | null = null
    // (Not a newer point version: "gpt-5" isn't "gpt-5.1".)
    for (const [k, v] of Object.entries(table)) if (model.startsWith(k) && model[k.length] !== '.' && (!best || k.length > best[0].length)) best = [k, v]
    return best?.[1] ?? null
  }
  return find(overrides) ?? find(DEFAULT_PRICES)
}

/** What the tokens cost in dollars; null when the model has no price. */
export function costOf(t: UsageTokens, model: string, overrides?: Record<string, ModelPrice>): number | null {
  const p = priceOf(model, overrides)
  if (!p) return null
  const write = p.cacheWrite ?? p.input * 1.25
  const read = p.cacheRead ?? p.input * 0.1
  return (t.input * p.input + t.output * p.output + t.cacheWrite * write + t.cacheRead * read) / 1_000_000
}

/** Summed usage: tokens, the cost of what has a price, and what didn't. */
export interface UsageSum {
  tokens: UsageTokens
  cost: number
  /** Tokens of models with no price (not in `cost`). */
  unpriced: number
  sessions: number
}

const empty = (): UsageSum => ({ tokens: { ...ZERO }, cost: 0, unpriced: 0, sessions: 0 })

function addModel(sum: UsageSum, model: string, t: UsageTokens, prices?: Record<string, ModelPrice>): void {
  sum.tokens = addTokens(sum.tokens, t)
  const c = costOf(t, model, prices)
  if (c == null) sum.unpriced += totalTokens(t)
  else sum.cost += c
}

/** A local day as YYYY-MM-DD. */
export function dayOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Sums the entries, over the days from `since` (YYYY-MM-DD, inclusive),
 * grouped by `key` (a project, a task, a model, a day) - or all as one ('').
 */
export function sumUsage(
  entries: UsageEntry[],
  opts: { since?: string; prices?: Record<string, ModelPrice>; by?: 'project' | 'task' | 'model' | 'day' } = {}
): Map<string, UsageSum> {
  const out = new Map<string, UsageSum>()
  for (const e of entries) {
    const counted = new Set<string>()
    for (const [day, models] of Object.entries(e.days)) {
      if (opts.since && day < opts.since) continue
      for (const [model, t] of Object.entries(models)) {
        const key = opts.by === 'project' ? e.projectId : opts.by === 'task' ? e.taskId : opts.by === 'model' ? model : opts.by === 'day' ? day : ''
        let s = out.get(key)
        if (!s) out.set(key, (s = empty()))
        addModel(s, model, t, opts.prices)
        if (!counted.has(key)) {
          counted.add(key)
          s.sessions++
        }
      }
    }
  }
  return out
}

/**
 * The usage as CSV: a row per session, day and model - tokens and cost
 * (empty for a model without a price). `projectName` names projects.
 */
export function usageCsv(entries: UsageEntry[], prices: Record<string, ModelPrice>, projectName: (id: string) => string, since?: string): string {
  const esc = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows: (string | number)[][] = [['date', 'project', 'task', 'title', 'session', 'model', 'input', 'output', 'cache_read', 'cache_write', 'cost_usd']]
  const lines: (string | number)[][] = []
  for (const e of entries)
    for (const [day, models] of Object.entries(e.days)) {
      if (since && day < since) continue
      for (const [model, t] of Object.entries(models)) {
        const c = costOf(t, model, prices)
        lines.push([day, projectName(e.projectId), e.taskKey, e.title, e.sessionId, model, t.input, t.output, t.cacheRead, t.cacheWrite, c == null ? '' : c.toFixed(4)])
      }
    }
  lines.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])))
  return [...rows, ...lines].map((r) => r.map(esc).join(',')).join('\n') + '\n'
}

/** "$0.42", "$12", "<$0.01". */
export function formatCost(c: number): string {
  if (c === 0) return '$0'
  if (c < 0.01) return '<$0.01'
  if (c < 100) return `$${c.toFixed(2)}`
  return `$${Math.round(c).toLocaleString('en-US')}`
}

/** "950", "12.3k", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

// ── Spending alerts ─────────────────────────────────────────────────
export type SpendPeriod = 'day' | 'week' | 'month'

/** The first day (YYYY-MM-DD) of the day, week (from Monday) or month `ts` is in. */
export function periodStart(period: SpendPeriod, ts: number): string {
  const d = new Date(ts)
  if (period === 'month') d.setDate(1)
  else if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayOf(d.getTime())
}

/** A limit that was reached: its key names the period, so it's said once in it. */
export interface SpendAlert {
  key: string
  period: SpendPeriod
  cost: number
  limit: number
  /** A project's monthly budget. */
  projectId?: string
}

/**
 * The limits the cost has reached: the day's, week's and month's alerts
 * (0: none), and each project's budget for the month.
 */
export function spendAlerts(
  entries: UsageEntry[],
  opts: { now: number; prices?: Record<string, ModelPrice>; limits: Partial<Record<SpendPeriod, number>>; budgets?: Record<string, number> }
): SpendAlert[] {
  const out: SpendAlert[] = []
  for (const period of ['day', 'week', 'month'] as SpendPeriod[]) {
    const limit = opts.limits[period] ?? 0
    if (!limit) continue
    const since = periodStart(period, opts.now)
    const cost = sumUsage(entries, { since, prices: opts.prices }).get('')?.cost ?? 0
    if (cost >= limit) out.push({ key: `${period}:${since}`, period, cost, limit })
  }
  const budgets = Object.entries(opts.budgets ?? {}).filter(([, v]) => v > 0)
  if (budgets.length) {
    const since = periodStart('month', opts.now)
    const byProject = sumUsage(entries, { since, prices: opts.prices, by: 'project' })
    for (const [projectId, limit] of budgets) {
      const cost = byProject.get(projectId)?.cost ?? 0
      if (cost >= limit) out.push({ key: `budget:${projectId}:${since}`, period: 'month', cost, limit, projectId })
    }
  }
  return out
}
