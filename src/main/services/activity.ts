import { BrowserWindow } from 'electron'
import { getActivity, getTasks, setActivity } from './store'
import { IPC } from '@shared/ipc'
import type { ActivityEvent, ActivityLog, Checkpoint } from '@shared/types'

/**
 * The activity log behind the daily summary: agents' turns (from
 * checkpoints), and moves to Review, failures and finishes (from the
 * board). Kept for 60 days, at most 5000 events.
 */

const KEEP_MS = 60 * 24 * 60 * 60 * 1000
const MAX = 5000

function changed(log: ActivityLog): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.activityChanged, log)
}

export function list(): ActivityLog {
  return getActivity()
}

export function add(e: ActivityEvent): void {
  const log = getActivity()
  const cutoff = Date.now() - KEEP_MS
  const next = { ...log, events: [...log.events.filter((x) => x.at >= cutoff), e].slice(-MAX) }
  setActivity(next)
  changed(next)
}

/** An agent's turn ended: what it changed (if anything) and its last words. */
export function turn(taskId: string, files: Checkpoint['files'], said: string | null): void {
  const t = getTasks().find((x) => x.id === taskId)
  if (!t) return
  add({
    at: Date.now(),
    kind: 'turn',
    taskId,
    taskKey: t.key,
    title: t.title,
    projectId: t.projectId,
    agentKind: t.agentKind,
    files: files.map((f) => f.path),
    added: files.reduce((n, f) => n + f.added, 0),
    deleted: files.reduce((n, f) => n + f.deleted, 0),
    said: said ? said.slice(0, 600) : null
  })
}

/** The summary was looked at (its "since you last looked" starts here). */
export function seen(at: number): void {
  const next = { ...getActivity(), seenAt: at }
  setActivity(next)
  changed(next)
}

/** The day's summary was announced. */
export function announced(day: string): void {
  const next = { ...getActivity(), announced: day }
  setActivity(next)
  changed(next)
}
