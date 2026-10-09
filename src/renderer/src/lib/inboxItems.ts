import { needsYou } from './status'
import type { ConflictReport, Notice, ReviewComment, Task, TeamMessage } from '@shared/types'
import { AGENTS } from '@shared/constants'

/**
 * The Inbox: everything that waits on you, most urgent first - approvals
 * and questions, failures and usage limits, clashes and failing tests,
 * review answers, held Team messages, finished turns.
 */

export type InboxKind = 'approval' | 'question' | 'failed' | 'limit' | 'conflict' | 'tests' | 'criteria' | 'review' | 'team' | 'waiting'

const ORDER: InboxKind[] = ['approval', 'question', 'failed', 'limit', 'conflict', 'tests', 'criteria', 'review', 'team', 'waiting']

export interface InboxItem {
  /** Stable while it's the same thing waiting (skipping remembers it). */
  id: string
  kind: InboxKind
  taskId: string | null
  title: string
  detail: string | null
  at: number
  comment?: ReviewComment
  notice?: Notice
  message?: TeamMessage
  /** For a clash: the other task (null: the base branch) and the files. */
  other?: string | null
  files?: string[]
  repoId?: string
}

const agentName = (t: Task): string => AGENTS.find((a) => a.kind === t.agentKind)?.name ?? 'The agent'

export function buildInbox(src: { tasks: Task[]; comments: ReviewComment[]; notices: Notice[]; team: TeamMessage[]; conflicts: ConflictReport }): InboxItem[] {
  const out: InboxItem[] = []
  const live = src.tasks.filter((t) => t.col !== 'done')
  const byId = new Map(src.tasks.map((t) => [t.id, t]))
  for (const t of live) {
    const at = t.lastActivityAt ?? 0
    if (t.sleeping) out.push({ id: `limit:${t.id}:${t.sleeping.since}`, kind: 'limit', taskId: t.id, title: `${agentName(t)} hit a usage limit`, detail: t.sleeping.reason, at: t.sleeping.since })
    else if (t.st === 'waiting' && t.askKind === 'permission') out.push({ id: `approval:${t.id}:${t.ask ?? ''}`, kind: 'approval', taskId: t.id, title: `${agentName(t)} asks for approval`, detail: t.ask, at })
    else if (t.st === 'failed') out.push({ id: `failed:${t.id}:${at}`, kind: 'failed', taskId: t.id, title: `${agentName(t)} failed`, detail: t.ask, at })
    else if (t.st === 'waiting' && t.agentKind && t.col === 'progress' && needsYou(t)) out.push({ id: `waiting:${t.id}:${at}`, kind: 'waiting', taskId: t.id, title: `${agentName(t)} finished its turn`, detail: t.activity ?? null, at })
    if (t.lastTest?.status === 'failed' && (t.col === 'progress' || t.col === 'review'))
      out.push({ id: `tests:${t.id}:${t.lastTest.at}`, kind: 'tests', taskId: t.id, title: 'Tests failed', detail: `exit ${t.lastTest.exitCode ?? '?'}`, at: t.lastTest.at })
    const failed = (t.criteria ?? []).filter((c) => c.status === 'failed')
    if (failed.length) out.push({ id: `criteria:${t.id}:${failed.map((c) => c.id + (c.at ?? '')).join(',')}`, kind: 'criteria', taskId: t.id, title: `${failed.length} acceptance criteri${failed.length === 1 ? 'on' : 'a'} failed`, detail: failed.map((c) => `✕ ${c.text}${c.note ? ` - ${c.note}` : ''}`).join('\n'), at: Math.max(...failed.map((c) => c.at ?? 0)) })
  }
  for (const n of src.notices) {
    if (n.kind !== 'agent-question' || n.read) continue
    const t = byId.get(n.taskId)
    if (!t || t.col === 'done') continue
    out.push({ id: `question:${n.id}`, kind: 'question', taskId: t.id, title: `${agentName(t)} asks`, detail: n.detail ?? null, at: n.at, notice: n })
  }
  for (const p of src.conflicts.pairs) {
    if (!p.conflicts.length) continue
    const t = byId.get(p.a)
    if (!t || t.col === 'done') continue
    const other = p.b ? byId.get(p.b) : null
    out.push({
      id: `conflict:${p.a}:${p.b ?? 'base'}:${p.conflicts.join(',')}`,
      kind: 'conflict',
      taskId: t.id,
      title: p.b ? `Clashes with ${other?.key ?? p.b}` : 'No longer merges with its base branch',
      detail: p.conflicts.join(', '),
      at: src.conflicts.at,
      other: p.b,
      files: p.conflicts,
      repoId: p.repoId
    })
  }
  for (const c of src.comments) {
    const last = c.thread?.[c.thread.length - 1]
    if (c.pending || c.resolved || last?.from !== 'agent') continue
    const t = byId.get(c.taskId)
    if (!t || t.col === 'done') continue
    out.push({ id: `review:${c.id}:${last.at}`, kind: 'review', taskId: t.id, title: `${agentName(t)} answered review comment [${c.ref ?? '?'}]`, detail: last.text, at: last.at, comment: c })
  }
  for (const m of src.team) {
    if (m.state !== 'held') continue
    out.push({ id: `team:${m.id}`, kind: 'team', taskId: byId.has(m.to) ? m.to : null, title: `Held message ${byId.get(m.from)?.key ?? m.from} → ${byId.get(m.to)?.key ?? m.to}`, detail: m.text, at: m.at, message: m })
  }
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.at - a.at)
}
