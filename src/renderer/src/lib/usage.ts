import { useEffect, useSyncExternalStore } from 'react'
import { periodStart, spendAlerts, type SpendAlert, type UsageEntry } from '@shared/usage'
import type { Prefs } from '@shared/types'

/** Agents' recorded token use (see main's usage service), kept current. */
let entries: UsageEntry[] = []
let started = false
const listeners = new Set<() => void>()

function start(): void {
  if (started) return
  started = true
  window.api.usage
    .list()
    .then((e) => {
      entries = e
      listeners.forEach((l) => l())
    })
    .catch(() => {})
  window.api.usage.onChanged((e) => {
    entries = e
    listeners.forEach((l) => l())
  })
}

export function useUsage(): UsageEntry[] {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => entries
  )
}

// The alerts already given (kept, so a restart doesn't repeat them): keys of the periods they were for.
const ALERTED = 'switchyard.spendAlerted'
function alerted(): string[] {
  try {
    const raw = localStorage.getItem(ALERTED)
    if (!raw) return []
    // Earlier versions kept the day of the daily alert.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return [`day:${raw}`]
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/**
 * Once the agents' cost reaches a limit - the day's, week's or month's
 * alert, or a project's monthly budget - says so (a toast, the
 * notification center, and the system's notification when the window
 * isn't in front): once per period.
 */
export function useSpendAlerts(prefs: Pick<Prefs, 'spendAlert' | 'spendAlertWeek' | 'spendAlertMonth' | 'projectBudgets' | 'modelPrices'>, onAlert: (a: SpendAlert) => void): void {
  const entries = useUsage()
  const { spendAlert, spendAlertWeek, spendAlertMonth, projectBudgets, modelPrices } = prefs
  useEffect(() => {
    if (!entries.length) return
    const now = Date.now()
    const given = alerted()
    const fresh = spendAlerts(entries, { now, prices: modelPrices, limits: { day: spendAlert, week: spendAlertWeek, month: spendAlertMonth }, budgets: projectBudgets }).filter((a) => !given.includes(a.key))
    if (!fresh.length) return
    // Only the current periods' are worth keeping.
    const floor = [periodStart('week', now), periodStart('month', now)].sort()[0]
    const keep = [...given, ...fresh.map((a) => a.key)].filter((k) => (k.split(':').pop() ?? '') >= floor)
    try {
      localStorage.setItem(ALERTED, JSON.stringify(keep))
    } catch {
      // without storage they may be said again after a restart
    }
    fresh.forEach(onAlert)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAlert is a fresh function each render
  }, [entries, spendAlert, spendAlertWeek, spendAlertMonth, projectBudgets, modelPrices])
}
