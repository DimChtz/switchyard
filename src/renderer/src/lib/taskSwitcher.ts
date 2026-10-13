import { useSyncExternalStore } from 'react'

/**
 * Ctrl+Tab between tasks: the tasks in the order you last opened them, and
 * the switcher showing them while Ctrl is held (Tab steps down, Shift+Tab up,
 * letting go opens the highlighted one).
 */

const KEY = 'sy.recentTasks'
const MAX = 30

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

let recent: string[] = load()

/** Moves a task to the front of the recent list. */
export function withVisit(list: string[], taskId: string): string[] {
  return [taskId, ...list.filter((id) => id !== taskId)].slice(0, MAX)
}

/** A task was opened (its workspace shown). */
export function recordTaskVisit(taskId: string): void {
  if (recent[0] === taskId) return
  recent = withVisit(recent, taskId)
  try {
    localStorage.setItem(KEY, JSON.stringify(recent))
  } catch {
    // (Remembered for this run only.)
  }
}

/** The recent task ids, most recent first, among the ones still there. */
export function recentTasks(exists: (id: string) => boolean): string[] {
  return recent.filter(exists)
}

// ── The switcher (open or not, and which row is highlighted) ──

export interface SwitcherState {
  open: boolean
  /** The tasks listed (fixed while it's open). */
  ids: string[]
  index: number
}

let sw: SwitcherState = { open: false, ids: [], index: 0 }
const listeners = new Set<() => void>()
const set = (next: SwitcherState): void => {
  sw = next
  for (const l of listeners) l()
}

export function useSwitcher(): SwitcherState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sw
  )
}

/**
 * Where a step lands: opening, the one after the current task (or the most
 * recent, when no task is showing) - backwards, the oldest; once open, the
 * next or previous row, wrapping round.
 */
export function stepIndex(open: boolean, index: number, dir: 1 | -1, count: number, onTask: boolean): number {
  if (count === 0) return 0
  if (!open) return dir > 0 ? Math.min(onTask ? 1 : 0, count - 1) : count - 1
  return (index + dir + count) % count
}

/** Ctrl+Tab (dir 1) or Ctrl+Shift+Tab (-1): opens the switcher, or moves through it. */
export function stepSwitcher(dir: 1 | -1, ids: string[], currentTaskId: string | null): void {
  const list = sw.open ? sw.ids : ids
  if (!list.length) return
  const onTask = !!currentTaskId && list[0] === currentTaskId
  set({ open: true, ids: list, index: stepIndex(sw.open, sw.index, dir, list.length, onTask) })
}

export function moveSwitcher(index: number): void {
  if (sw.open) set({ ...sw, index })
}

/** Closes it; the highlighted task's id (null when cancelled). */
export function closeSwitcher(take: boolean): string | null {
  if (!sw.open) return null
  const id = take ? (sw.ids[sw.index] ?? null) : null
  set({ open: false, ids: [], index: 0 })
  return id
}
