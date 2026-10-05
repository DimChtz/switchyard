import type { AgentStatus, TestRun } from '@shared/types'

export const STATUS_COLOR: Record<Exclude<AgentStatus, null>, string> = {
  working: 'var(--c-green)',
  waiting: 'var(--c-amber)',
  failed: 'var(--c-red)',
  done: 'var(--t4)',
  paused: 'var(--t3)'
}

export const STATUS_LABEL: Record<Exclude<AgentStatus, null>, string> = {
  working: 'working',
  waiting: 'needs you',
  failed: 'failed',
  done: 'done',
  paused: 'paused'
}

export const TEST_LABEL: Record<TestRun['status'], string> = {
  running: 'tests running',
  passed: 'tests passing',
  failed: 'tests failing'
}

export const TEST_COLOR: Record<TestRun['status'], string> = {
  running: 'var(--c-amber)',
  passed: 'var(--c-green)',
  failed: 'var(--c-red)'
}

export function statusColor(st: AgentStatus): string {
  if (!st) return 'var(--t4)'
  return STATUS_COLOR[st]
}

export function statusLabel(st: AgentStatus): string {
  if (!st) return ''
  return STATUS_LABEL[st]
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/** "15:00" today, "Thu 15:00" another day. */
export function clock(ts: number): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** When a sleeping task's agent is woken: at the reset (a minute after), or an hour after it hit the limit. */
export function wakeAt(sleeping: { until: number | null; since: number }): number {
  return sleeping.until ? sleeping.until + 60_000 : sleeping.since + 3_600_000
}
