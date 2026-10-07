import type { AppState } from '../store/types'
import type { AgentKind, Project, Task } from '@shared/types'
import { AGENTS, staleReason } from '@shared/constants'
import { inProject } from './multiRepo'

export function agentDef(kind: Task['agentKind']) {
  if (!kind) return null
  return AGENTS.find((a) => a.kind === kind) ?? null
}

export function agentShort(kind: Task['agentKind']): string {
  return agentDef(kind)?.short ?? ''
}

// The highest number each project has given out (state.keyHigh, deleted tasks
// included) - for callers outside the reducer; the reducer passes its own.
let keyHigh: Record<string, number> = {}
export function knowKeyHigh(high: Record<string, number>): void {
  keyHigh = high
}

/** The highest numbers, raised by these tasks' keys (the reducer keeps state.keyHigh this way). */
export function raiseKeyHigh(high: Record<string, number>, tasks: Task[]): Record<string, number> {
  let out = high
  for (const t of tasks) {
    const n = Number(t.key.split('-').pop()) || 0
    if (n > (out[t.projectId] ?? 0)) out = { ...out, [t.projectId]: n }
  }
  return out
}

/**
 * The key the project's next task gets: its prefix and one past the highest
 * number it ever had - a deleted task's key isn't given out again (its notes,
 * usage and history still carry it).
 */
export function nextTaskKey(tasks: Task[], project: Project, high: Record<string, number> = keyHigh): string {
  const nums = tasks.filter((t) => t.projectId === project.id).map((t) => Number(t.key.split('-').pop()) || 0)
  const n = Math.max(0, high[project.id] ?? 0, ...nums) + 1
  // Never an id another project's task has (two projects with one prefix).
  let key = `${project.prefix}-${n}`
  for (let i = n + 1; tasks.some((t) => t.id === key); i++) key = `${project.prefix}-${i}`
  return key
}

/** Tasks on the board (not in the archive). */
export function onBoard(t: Task): boolean {
  return !t.archivedAt
}

/** The project's tasks - with those from other projects that work in its repository too. Not its scratchpad. */
export function tasksForProject(state: AppState, projectId: string): Task[] {
  return state.tasks.filter((t) => inProject(t, projectId) && !t.scratch)
}

export function liveTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => t.st === 'working' || t.st === 'waiting' || t.st === 'failed')
}

export function blockedTasks(state: AppState): Task[] {
  return state.tasks
    .filter((t) => t.st === 'waiting' || t.st === 'failed')
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
}

export function workingTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => t.st === 'working').sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

/**
 * Agents taking up a slot (Settings → Agents: max working at once): ones
 * working, or stopped mid-task on an approval. One that finished its turn
 * and waits for a message doesn't - so a queued batch keeps moving.
 */
export function busyAgents(tasks: Task[]): number {
  return tasks.filter((t) => t.col !== 'done' && (t.st === 'working' || (t.st === 'waiting' && t.askKind === 'permission'))).length
}

/** Queued tasks, first in line first. */
export function queuedTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.queued).sort((a, b) => a.queued!.at - b.queued!.at)
}

export function doneTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => t.col === 'review' && t.st === 'done')
}

export interface WorktreeRow {
  id: string
  projectId: string
  branch: string
  path: string
  taskId: string | null
  ahead: number
  behind: number
  dirty: number
  lastActivityAt: number
  /** Time of the checked-out commit (ms), 0 when unknown. */
  lastCommitAt: number
  /** Branch the project compares against (vs main). */
  base: string
}

/** Worktrees that can be cleaned up (Settings → Git: stale after N days), with why. */
export function staleWorktrees(worktrees: WorktreeRow[], days: number): (WorktreeRow & { reason: string })[] {
  return worktrees.flatMap((w) => {
    const reason = staleReason({ linked: w.taskId !== null, ahead: w.ahead, dirty: w.dirty, lastCommitAt: w.lastCommitAt }, days, w.base)
    return reason ? [{ ...w, reason }] : []
  })
}

/** Whether the agent can be given Switchyard's tools (MCP) at launch. */
export function hasTools(kind: AgentKind | null | undefined): boolean {
  return !!AGENTS.find((a) => a.kind === kind)?.tools
}
