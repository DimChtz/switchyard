import { useEffect, useSyncExternalStore } from 'react'
import { dayOf } from '@shared/usage'
import type { ActivityLog, Prefs } from '@shared/types'

/** The activity log behind the daily summary (see main's activity service), kept current. null until it's read. */
let log: ActivityLog | null = null
let started = false
const listeners = new Set<() => void>()

function set(next: ActivityLog): void {
  log = next
  listeners.forEach((l) => l())
}

function start(): void {
  if (started) return
  started = true
  window.api.activity.list().then(set).catch(() => {})
  window.api.activity.onChanged(set)
}

export function useActivity(): ActivityLog | null {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => log
  )
}

/** Today at the summary's time ("HH:MM"). */
export function summaryTime(prefs: Pick<Prefs, 'summaryAt'>, now: number): number {
  const [h, m] = (/^(\d{1,2}):(\d{2})$/.exec(prefs.summaryAt) ?? [null, '9', '00']).slice(1).map(Number)
  const d = new Date(now)
  d.setHours(Math.min(23, h), Math.min(59, m), 0, 0)
  return d.getTime()
}

/** The day's summary is out and not looked at since. */
export function summaryUnseen(log: ActivityLog | null, prefs: Pick<Prefs, 'dailySummary' | 'summaryAt'>, now: number): boolean {
  return !!log && prefs.dailySummary && log.announced === dayOf(now) && log.seenAt < summaryTime(prefs, now) && log.events.some((e) => e.at > log.seenAt)
}

/**
 * Each day at the summary's time (or when the app opens after it), says
 * the summary is ready - once a day, and only when something happened
 * since it was last looked at.
 */
export function useSummaryAnnouncement(prefs: Pick<Prefs, 'dailySummary' | 'summaryAt'>, announce: () => void): void {
  const current = useActivity()
  useEffect(() => {
    if (!prefs.dailySummary || !current) return
    const check = (): void => {
      const now = Date.now()
      const today = dayOf(now)
      if (!log || log.announced === today || now < summaryTime(prefs, now)) return
      const news = log.events.some((e) => e.at > log!.seenAt)
      window.api.activity.announced(today).catch(() => {})
      if (news) announce()
    }
    check()
    const t = setInterval(check, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.dailySummary, prefs.summaryAt, !!current])
}
