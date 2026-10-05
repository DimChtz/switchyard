import { AGENTS, COLUMN_LABEL } from '@shared/constants'
import { costOf, dayOf, formatCost, type ModelPrice, type UsageEntry } from '@shared/usage'
import { parentFinished, parentOf } from '@shared/stack'
import type { ActivityEvent, AgentKind, ConflictReport, Task } from '@shared/types'

/**
 * The daily summary: what the agents did in a period (from the activity
 * log), what's waiting for you now, and what's next.
 */

export type SummaryPeriod = 'since' | 'today' | 'yesterday' | 'week'

const DAY = 24 * 60 * 60 * 1000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The period's start and end, and what to call it. */
export function periodRange(p: SummaryPeriod, now: number, seenAt: number): { from: number; to: number; label: string } {
  const today = startOfDay(now)
  if (p === 'today') return { from: today, to: now, label: 'Today' }
  if (p === 'yesterday') return { from: startOfDay(today - DAY / 2), to: today, label: 'Yesterday' }
  if (p === 'week') return { from: startOfDay(now - 6 * DAY), to: now, label: 'Last 7 days' }
  const from = seenAt > 0 && seenAt < now ? seenAt : today
  return { from, to: now, label: seenAt > 0 ? `Since ${when(from, now)}` : 'Today' }
}

/** "14:05" today, "yesterday 18:40", "Mon 09:12", "3 Sep". */
export function when(ts: number, now: number): string {
  const d = new Date(ts)
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY)
  if (days <= 0) return hm
  if (days === 1) return `yesterday ${hm}`
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export interface WorkRow {
  taskId: string
  key: string
  title: string
  projectId: string
  agentKind: AgentKind | null
  /** The task as it is now (gone when it was deleted). */
  task?: Task
  turns: number
  files: number
  added: number
  deleted: number
  /** Its agent's last words in the period. */
  said: string | null
  cost: number
  /** Finished in the period: when, and how. */
  finished?: { at: number; note: string | null }
  toReview: boolean
  failed: boolean
}

export interface AttentionRow {
  task: Task
  why: string
  /** Since when (not known for a clash: it's as of the last check). */
  since?: number
  tone: 'amber' | 'red' | 'blue'
}

export interface NextRow {
  task: Task
  why: string
}

export interface Summary {
  from: number
  to: number
  totals: { tasks: number; turns: number; files: number; added: number; deleted: number; finished: number; review: number; cost: number }
  finished: WorkRow[]
  worked: WorkRow[]
  attention: AttentionRow[]
  review: Task[]
  next: NextRow[]
  costByProject: { projectId: string; cost: number }[]
}

export function agentName(kind: AgentKind | null | undefined): string {
  return AGENTS.find((a) => a.kind === kind)?.name ?? 'the agent'
}

/** An agent's last words, short: their first paragraph, up to about two sentences. */
export function gist(said: string | null | undefined, max = 220): string | null {
  if (!said) return null
  const para = said.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^[#>`|-]/.test(p)) ?? said.trim()
  const flat = para.replace(/\s+/g, ' ').replace(/[*_`]/g, '')
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`
}

/** Agent spend per task over the days the period touches (usage is kept per day). */
function costPerTask(usage: UsageEntry[], from: number, to: number, prices?: Record<string, ModelPrice>): Map<string, number> {
  const a = dayOf(from)
  const b = dayOf(to)
  const out = new Map<string, number>()
  for (const e of usage)
    for (const [day, models] of Object.entries(e.days)) {
      if (day < a || day > b) continue
      for (const [model, t] of Object.entries(models)) out.set(e.taskId, (out.get(e.taskId) ?? 0) + (costOf(t, model, prices) ?? 0))
    }
  return out
}

export function buildSummary(input: {
  tasks: Task[]
  events: ActivityEvent[]
  usage: UsageEntry[]
  prices?: Record<string, ModelPrice>
  conflicts?: ConflictReport | null
  from: number
  to: number
  now: number
  /** Only this project's tasks. */
  projectId?: string | null
}): Summary {
  const { tasks, from, to, now, projectId } = input
  const inProject = (p: string): boolean => !projectId || p === projectId
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const costs = costPerTask(input.usage, from, to, input.prices)
  const rows = new Map<string, WorkRow & { paths: Set<string>; saidAt: number }>()
  for (const e of input.events) {
    if (e.at < from || e.at >= to || !inProject(e.projectId)) continue
    let r = rows.get(e.taskId)
    if (!r) {
      r = {
        taskId: e.taskId,
        key: e.taskKey,
        title: byId.get(e.taskId)?.title ?? e.title,
        projectId: e.projectId,
        agentKind: e.agentKind ?? byId.get(e.taskId)?.agentKind ?? null,
        task: byId.get(e.taskId),
        turns: 0,
        files: 0,
        added: 0,
        deleted: 0,
        said: null,
        cost: costs.get(e.taskId) ?? 0,
        toReview: false,
        failed: false,
        paths: new Set(),
        saidAt: 0
      }
      rows.set(e.taskId, r)
    }
    if (e.agentKind) r.agentKind = e.agentKind
    if (e.kind === 'turn') {
      r.turns++
      for (const f of e.files ?? []) r.paths.add(f)
      r.added += e.added ?? 0
      r.deleted += e.deleted ?? 0
      if (e.said && e.at >= r.saidAt) {
        r.said = gist(e.said)
        r.saidAt = e.at
      }
    } else if (e.kind === 'review') r.toReview = true
    else if (e.kind === 'failed') r.failed = true
    else if (e.kind === 'finished') r.finished = { at: e.at, note: e.note ?? null }
  }
  const all = [...rows.values()].map(({ paths, saidAt: _s, ...r }) => ({ ...r, files: paths.size }))
  const finished = all.filter((r) => r.finished).sort((a, b) => a.finished!.at - b.finished!.at)
  const worked = all.filter((r) => !r.finished).sort((a, b) => b.turns - a.turns || b.files - a.files)

  // Now: what waits for you.
  const open = tasks.filter((t) => t.col !== 'done' && inProject(t.projectId))
  const attention: AttentionRow[] = []
  // Clashing changes: each pair once, on the task with the most of them.
  const pairs = (input.conflicts?.pairs ?? []).filter((p) => p.conflicts.length && byId.has(p.a))
  const count = new Map<string, number>()
  for (const p of pairs) for (const id of [p.a, p.b]) if (id) count.set(id, (count.get(id) ?? 0) + 1)
  const clashes = new Map<string, string[]>()
  for (const p of pairs) {
    const [me, other] = !p.b || (count.get(p.a) ?? 0) >= (count.get(p.b) ?? 0) ? [p.a, p.b] : [p.b, p.a]
    const name = other ? (byId.get(other)?.key ?? other) : 'its base branch'
    clashes.set(me, [...(clashes.get(me) ?? []), name])
  }
  for (const t of open) {
    const agent = agentName(t.agentKind)
    if (t.sleeping) attention.push({ task: t, why: `${agent} hit a usage limit${t.sleeping.until ? ` - back at ${new Date(t.sleeping.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`, since: t.sleeping.since, tone: 'blue' })
    else if (t.st === 'failed') attention.push({ task: t, why: `${agent} failed${t.ask ? `: ${t.ask}` : ''}`, since: t.lastActivityAt, tone: 'red' })
    else if (t.st === 'waiting' && t.askKind === 'permission') attention.push({ task: t, why: `${agent} needs your approval${t.ask ? `: ${t.ask}` : ''}`, since: t.lastActivityAt, tone: 'amber' })
    else if (t.st === 'waiting' && t.col === 'progress') attention.push({ task: t, why: t.ask ? `${agent} asks: ${gist(t.ask, 140)}` : t.activity ? `${agent} finished its turn: ${gist(t.activity, 140)}` : `${agent} finished its turn - the next message is yours`, since: t.lastActivityAt, tone: 'amber' })
    const c = clashes.get(t.id)
    if (c) attention.push({ task: t, why: `Its changes clash with ${[...new Set(c)].join(', ')}`, tone: 'red' })
  }
  attention.sort((a, b) => (a.since ?? now) - (b.since ?? now))
  const review = open.filter((t) => t.col === 'review').sort((a, b) => a.lastActivityAt - b.lastActivityAt)

  // Next: the queue in order, then what's Ready.
  const next: NextRow[] = []
  const queued = open.filter((t) => t.queued).sort((a, b) => a.queued!.at - b.queued!.at)
  for (const t of queued) {
    const parent = parentOf(t, tasks)
    next.push({ task: t, why: parent && !parentFinished(t, tasks) ? `queued for ${agentName(t.queued!.agentKind)} - after ${parent.key} is in Review` : `queued for ${agentName(t.queued!.agentKind)}` })
  }
  for (const t of open.filter((x) => x.col === 'ready' && !x.queued && !x.worktreePath)) {
    const parent = parentOf(t, tasks)
    next.push({ task: t, why: parent && !parent.branch && parent.col !== 'done' ? `ready - waits for ${parent.key} to start` : 'ready to start' })
  }

  const costByProject = new Map<string, number>()
  for (const r of all) costByProject.set(r.projectId, (costByProject.get(r.projectId) ?? 0) + r.cost)

  return {
    from,
    to,
    totals: {
      tasks: all.filter((r) => r.turns > 0).length,
      turns: all.reduce((n, r) => n + r.turns, 0),
      files: all.reduce((n, r) => n + r.files, 0),
      added: all.reduce((n, r) => n + r.added, 0),
      deleted: all.reduce((n, r) => n + r.deleted, 0),
      finished: finished.length,
      review: all.filter((r) => r.toReview).length,
      cost: all.reduce((n, r) => n + r.cost, 0)
    },
    finished,
    worked,
    attention,
    review,
    next: next.slice(0, 10),
    costByProject: [...costByProject.entries()].filter(([, c]) => c > 0).map(([id, cost]) => ({ projectId: id, cost })).sort((a, b) => b.cost - a.cost)
  }
}

/** "+1.2k −340". */
export function lines(added: number, deleted: number): string {
  const n = (x: number): string => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10_000 ? 0 : 1)}k` : String(x))
  return `+${n(added)} −${n(deleted)}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The summary as Markdown, to paste into a standup or a channel. */
export function summaryMarkdown(s: Summary, label: string, projectName: (id: string) => string, now: number): string {
  const out: string[] = []
  const t = s.totals
  const many = new Set([...s.finished, ...s.worked].map((r) => r.projectId)).size > 1
  const where = (projectId: string): string => (many ? ` (${projectName(projectId)})` : '')
  out.push(`# Switchyard summary · ${label}`, '')
  const head = [
    t.finished ? `${plural(t.finished, 'task')} finished` : null,
    t.turns ? `${plural(t.turns, 'agent turn')} on ${plural(t.tasks, 'task')}` : null,
    t.files ? `${plural(t.files, 'file')} changed (${lines(t.added, t.deleted)})` : null,
    t.cost ? `${formatCost(t.cost)} at API prices` : null
  ].filter(Boolean)
  out.push(head.length ? head.join(' · ') : 'No agent activity in this period.', '')
  if (s.finished.length) {
    out.push('## Finished', '')
    for (const r of s.finished) out.push(`- **${r.key}** ${r.title}${where(r.projectId)} - ${r.finished!.note ?? 'done'}`)
    out.push('')
  }
  if (s.worked.length) {
    out.push('## Worked on', '')
    for (const r of s.worked) {
      const state = r.task ? (r.task.col === 'done' ? 'Done' : COLUMN_LABEL[r.task.col]) : 'deleted'
      const bits = [plural(r.turns, 'turn'), r.files ? `${plural(r.files, 'file')} ${lines(r.added, r.deleted)}` : null, r.cost ? formatCost(r.cost) : null].filter(Boolean).join(', ')
      out.push(`- **${r.key}** ${r.title}${where(r.projectId)} - ${agentName(r.agentKind)}, ${state}${r.toReview ? ' (ready for review)' : ''}${bits ? ` · ${bits}` : ''}`)
      if (r.said) out.push(`  > ${r.said}`)
    }
    out.push('')
  }
  if (s.attention.length) {
    out.push('## Needs you', '')
    for (const a of s.attention) out.push(`- **${a.task.key}** ${a.task.title} - ${a.why}${a.since ? ` (since ${when(a.since, now)})` : ''}`)
    out.push('')
  }
  if (s.review.length) {
    out.push('## Ready for review', '')
    for (const r of s.review) out.push(`- **${r.key}** ${r.title}${r.pr?.number ? ` · PR #${r.pr.number}` : ''}`)
    out.push('')
  }
  if (s.next.length) {
    out.push('## Next up', '')
    for (const n of s.next) out.push(`- **${n.task.key}** ${n.task.title} - ${n.why}`)
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}
