import type { Task } from '@shared/types'

const DAY = 24 * 60 * 60 * 1000

/**
 * Settings → Board, "Park tasks untouched for": the tasks In Progress or in
 * Review that nothing happened to for that many days (their project's
 * setting) - not a pinned one or the scratchpad, not one whose agent is working, queued or
 * asleep until its usage limit resets.
 */
export function dueForPark(tasks: Task[], daysFor: (projectId: string) => number, now = Date.now()): Task[] {
  return tasks.filter((t) => {
    const days = daysFor(t.projectId)
    if (!days || (t.col !== 'progress' && t.col !== 'review') || t.archivedAt) return false
    // (A project's scratchpad lives off the board: never parked.)
    if (t.scratch || t.pinnedAt || t.st === 'working' || t.queued || t.sleeping) return false
    const last = Math.max(t.lastActivityAt ?? 0, t.startedAt ?? 0, t.createdAt ?? 0)
    return now - last > days * DAY
  })
}

/** The weekly look at what's parked: due once a week (and only with something parked). */
export function summaryDue(parked: number, lastAt: number, now = Date.now()): boolean {
  return parked > 0 && now - lastAt > 7 * DAY
}
