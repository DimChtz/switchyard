import type { Task } from '@shared/types'
import { expandWorktreeEnv, slotPort, type WorktreeEnvInfo } from '@shared/worktreeEnv'
import { getPrefs, getTasks, kvGet, kvSet } from './store'
import { canonical, isInside } from './paths'

/**
 * Each open task's own slot (1, 2, 3…; 0 is your own checkout): its ports,
 * database names and the like don't clash with the other tasks' - see
 * shared/worktreeEnv. A slot is kept while the task is open, and freed
 * once it's done or deleted.
 */
const KEY = 'worktreeSlots'

function openTasks(): Task[] {
  return getTasks().filter((t) => t.col !== 'done')
}

export function slotOf(taskId: string): number {
  const slots = kvGet<Record<string, number>>(KEY) ?? {}
  const open = new Set(openTasks().map((t) => t.id))
  // (Done and deleted tasks' slots go back.)
  for (const id of Object.keys(slots)) if (!open.has(id)) delete slots[id]
  if (!slots[taskId]) {
    const taken = new Set(Object.values(slots))
    let n = 1
    while (taken.has(n)) n++
    slots[taskId] = n
  }
  kvSet(KEY, slots)
  return slots[taskId]
}

/** The task whose worktree (or task folder) `cwd` is in - not one working in the repository itself. */
export function taskAt(cwd: string): Task | null {
  if (!cwd) return null
  const c = canonical(cwd)
  let best: { task: Task; len: number } | null = null
  for (const t of openTasks()) {
    if (t.inPlace) continue
    for (const p of [t.worktreePath, t.taskDir]) {
      if (!p || !isInside(c, p)) continue
      const len = canonical(p).length
      if (!best || len > best.len) best = { task: t, len }
    }
  }
  return best?.task ?? null
}

/** What a process started in `cwd` gets: its slot's variables, and {port}-style placeholders in `env` filled in. */
export function worktreeInfo(cwd: string): WorktreeEnvInfo {
  const task = taskAt(cwd)
  const slot = task ? slotOf(task.id) : 0
  return { slot, port: slotPort(getPrefs().worktreePortBase, slot), task: task?.key ?? null }
}

export function envFor(cwd: string, env: Record<string, string> | undefined): Record<string, string> {
  return expandWorktreeEnv(env ?? {}, worktreeInfo(cwd))
}

// (For tests and the slot list: which task has which.)
export function slotsHeld(): Record<string, number> {
  return { ...(kvGet<Record<string, number>>(KEY) ?? {}) }
}
