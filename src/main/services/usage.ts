import { BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { dailyUsage } from './transcript'
import { codexDailyUsage, codexSessionsIn } from './codexUsage'
import { log } from './log'
import { getTasks, getUsage, setUsage } from './store'
import type { UsageEntry } from '@shared/usage'

/**
 * Agents' token use, per session - kept apart from the tasks, so it stays
 * when a task is finished or deleted. Refreshed from the session's
 * transcript as it works (Claude Code sessions: their hooks say where the
 * transcript is; Codex sessions: found by the folder they ran in).
 */

export function list(): UsageEntry[] {
  return getUsage()
}

let notifying: ReturnType<typeof setTimeout> | undefined
/** Records one session's entry (a database write: all of it or nothing). */
export function record(entry: UsageEntry): void {
  const all = getUsage()
  const i = all.findIndex((e) => e.sessionId === entry.sessionId)
  if (i >= 0) all[i] = entry
  else all.push(entry)
  setUsage(all)
  clearTimeout(notifying)
  notifying = setTimeout(() => {
    const now = getUsage()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('usage:changed', now)
  }, 300)
}

const pending = new Map<string, ReturnType<typeof setTimeout>>()

/** Sessions recorded before this was kept (or while the app was closed): read them once at start. */
export function backfill(): void {
  for (const t of getTasks()) {
    if (t.session?.transcript) refresh(t.id, t.session, 3000)
    else if (t.agentKind === 'codex' && t.worktreePath) refreshCodex(t.id, 5000)
  }
  // Codex says nothing when it works: running Codex tasks are read now and then.
  setInterval(() => {
    for (const t of getTasks()) if (t.agentKind === 'codex' && (t.st === 'working' || t.st === 'waiting') && t.worktreePath) refreshCodex(t.id, 0)
  }, 180_000)
}

/**
 * A Codex task's sessions (found by the folder its agent runs in, since it
 * started), read from Codex's session logs into usage.
 */
export function refreshCodex(taskId: string, delay = 2000): void {
  const key = `codex:${taskId}`
  if (pending.has(key)) return
  pending.set(
    key,
    setTimeout(async () => {
      pending.delete(key)
      const task = getTasks().find((t) => t.id === taskId)
      const folder = task?.taskDir || task?.worktreePath
      if (!task || !folder || task.agentKind !== 'codex') return
      try {
        for (const s of await codexSessionsIn(folder, (task.startedAt ?? task.createdAt) - 60_000)) {
          const days = codexDailyUsage(await readFile(s.path, 'utf-8'))
          if (!Object.keys(days).length) continue
          record({ sessionId: s.id, taskId, taskKey: task.key, title: task.title, projectId: task.projectId, agentKind: 'codex', days, updatedAt: Date.now() })
        }
      } catch (err) {
        log.warn('usage', `Could not read ${task.key}'s Codex sessions`, err)
      }
    }, delay)
  )
}

/**
 * Reads the session's transcript again (a moment later, and at most every
 * few seconds while it's busy) and records what it has used.
 */
export function refresh(taskId: string, session: { id: string; transcript: string }, delay = 4000): void {
  if (pending.has(session.id)) return
  pending.set(
    session.id,
    setTimeout(async () => {
      pending.delete(session.id)
      try {
        const days = await dailyUsage(session.transcript)
        if (!Object.keys(days).length) return
        const task = getTasks().find((t) => t.id === taskId)
        const was = getUsage().find((e) => e.sessionId === session.id)
        record({
          sessionId: session.id,
          taskId,
          taskKey: task?.key ?? was?.taskKey ?? taskId,
          title: task?.title ?? was?.title ?? '',
          projectId: task?.projectId ?? was?.projectId ?? '',
          agentKind: task?.agentKind ?? was?.agentKind ?? 'claude',
          days,
          updatedAt: Date.now()
        })
      } catch {
        // the transcript moved or isn't there yet
      }
    }, delay)
  )
}
