import type { BoardColumn, Prefs, Task } from '@shared/types'
import { COLUMN_LABEL, COLUMN_ORDER, DEFAULT_PREFS } from '@shared/constants'

/**
 * Settings → Board, as the board uses it: which columns show and what
 * they're called, their limits, the order in a column, what a card shows.
 * (A project can have its own - prefsFor gives the right ones.)
 */

const DAY = 24 * 60 * 60 * 1000

/** A column's name: its own (Settings → Board), else the usual one. */
export function columnName(prefs: Pick<Prefs, 'boardNames'>, col: BoardColumn): string {
  return prefs.boardNames?.[col]?.trim() || COLUMN_LABEL[col]
}

/** The columns shown, in order - In Progress always is. */
export function visibleColumns(prefs: Pick<Prefs, 'boardHidden'>): BoardColumn[] {
  const hidden = new Set(prefs.boardHidden ?? [])
  return COLUMN_ORDER.filter((c) => c === 'progress' || !hidden.has(c))
}

/** A column's card limit (0: none). */
export function wipLimit(prefs: Pick<Prefs, 'wipLimits'>, col: BoardColumn): number {
  const n = Number(prefs.wipLimits?.[col])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** What a card shows (a partial setting keeps the rest as they were). */
export function cardShow(prefs: Pick<Prefs, 'cardShow'>): Prefs['cardShow'] {
  return { ...DEFAULT_PREFS.cardShow, ...(prefs.cardShow ?? {}) }
}

/** When it came into its column (older tasks: their last activity). */
export function inColumnSince(t: Task): number {
  return t.colAt ?? t.lastActivityAt ?? t.createdAt
}

/** It hasn't moved in `days` (Done cards aren't stale - they're done). */
export function isStale(t: Task, days: number, now = Date.now()): boolean {
  return days > 0 && t.col !== 'done' && !t.archivedAt && now - inColumnSince(t) > days * DAY
}

const NEEDS: Record<string, number> = { failed: 0, waiting: 1, working: 2 }

/** A column's cards in the order set - pinned ones first either way (the latest pin on top). */
export function sortColumn(tasks: Task[], sort: Prefs['columnSort']): Task[] {
  if (sort === 'manual' || !sort) return tasks
  const by: Record<Exclude<Prefs['columnSort'], 'manual'>, (a: Task, b: Task) => number> = {
    newest: (a, b) => b.createdAt - a.createdAt,
    activity: (a, b) => b.lastActivityAt - a.lastActivityAt,
    needs: (a, b) => (NEEDS[a.st ?? ''] ?? 3) - (NEEDS[b.st ?? ''] ?? 3) || b.lastActivityAt - a.lastActivityAt
  }
  const pinned = tasks.filter((t) => t.pinnedAt)
  const rest = tasks.filter((t) => !t.pinnedAt).sort(by[sort])
  return [...pinned, ...rest]
}

/** Done cards old enough for the archive (Settings → Board: after N days). */
export function dueForArchive(tasks: Task[], days: number, now = Date.now()): Task[] {
  if (!days) return []
  return tasks.filter((t) => t.col === 'done' && !t.archivedAt && now - inColumnSince(t) > days * DAY)
}
