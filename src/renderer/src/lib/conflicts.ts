import { useEffect, useSyncExternalStore } from 'react'
import type { ConflictPair, ConflictReport, Task } from '@shared/types'

/** The conflict radar's latest check (see main's conflicts service), kept current. */
let report: ConflictReport = { at: 0, pairs: [], mergeCheck: true }
let started = false
const listeners = new Set<() => void>()

function set(r: ConflictReport): void {
  report = r
  listeners.forEach((l) => l())
}

function start(): void {
  if (started) return
  started = true
  window.api.conflicts.get().then(set).catch(() => {})
  window.api.conflicts.onChanged(set)
}

export function useConflicts(): ConflictReport {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => report
  )
}

/** One task's collisions: with another task (other = its id) or its base branch (other = null). */
export interface TaskConflict {
  other: string | null
  repoId: string
  files: string[]
  conflicts: string[]
}

export function conflictsOf(r: ConflictReport, taskId: string): TaskConflict[] {
  return r.pairs
    .filter((p: ConflictPair) => p.a === taskId || p.b === taskId)
    .map((p) => ({ other: p.a === taskId ? p.b : p.a, repoId: p.repoId, files: p.files, conflicts: p.conflicts }))
    .sort((a, b) => b.conflicts.length - a.conflicts.length)
}

/** "conflicts with SYT-3 +1", "same files as SYT-3", "conflicts with main" - for a card. */
export function conflictLabel(list: TaskConflict[], tasks: Task[], base: string): { text: string; hard: boolean } | null {
  if (!list.length) return null
  const hard = list.filter((c) => c.conflicts.length)
  const shown = hard.length ? hard : list
  const name = (c: TaskConflict): string => (c.other ? (tasks.find((t) => t.id === c.other)?.key ?? c.other) : base)
  const more = shown.length > 1 ? ` +${shown.length - 1}` : ''
  return hard.length ? { text: `conflicts with ${name(shown[0])}${more}`, hard: true } : { text: `same files as ${name(shown[0])}${more}`, hard: false }
}

/**
 * What to tell the task's agent about one collision. `dir`: the repository's
 * folder in the task's folder (a task in several repositories works there).
 */
export function conflictMessage(c: TaskConflict, other: Task | undefined, base: string, dir = ''): string {
  const at = (f: string): string => (dir ? `${dir}/${f}` : f)
  c = { ...c, files: c.files.map(at), conflicts: c.conflicts.map(at) }
  if (!c.other) return `Heads-up from Switchyard: your changes no longer merge cleanly with ${base} - conflicts in ${c.conflicts.join(', ')}. Bring ${base} into this branch (rebase or merge) and resolve them, then check that everything still works.`
  const who = other ? `task ${other.key} "${other.title}" (branch ${other.branch})` : `task ${c.other}`
  const theirs = other?.branch ? ` See their changes with: git ${dir ? `-C ${dir} ` : ''}diff ${base}...${other.branch} -- <file>.` : ''
  return c.conflicts.length
    ? `Heads-up from Switchyard: ${who}, running in parallel, also changes ${c.files.join(', ')} - and ${c.conflicts.join(', ')} won't merge cleanly with your changes.${theirs} Keep your edits there as small as you can and compatible with theirs, or tell me if one task should wait for the other.`
    : `Heads-up from Switchyard: ${who}, running in parallel, also changes ${c.files.join(', ')}. The edits still merge, but keep them compatible.${theirs}`
}
