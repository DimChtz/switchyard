import type { Prefs, Project, Task } from '@shared/types'
import { AGENTS } from '@shared/constants'
import { reposOf } from './multiRepo'

/**
 * The board's search and filters: which cards show. Filters of one kind
 * are alternatives (Claude or Codex); different kinds all apply.
 */
export interface BoardFilter {
  /** Words that must all be in the task's key, title, description or branch. */
  query: string
  /** Agents - 'none' for tasks without one. Empty: any. */
  agents: string[]
  /** Empty: any. */
  status: BoardStatus[]
  /** Cost at least this many dollars (0: any; 0.01: any cost at all). */
  spend: number
  /** Only tasks with review comments still open (in a review, or sent and not resolved). */
  review: boolean
}

export type BoardStatus = 'working' | 'needs' | 'queued' | 'idle'

export const NO_FILTER: BoardFilter = { query: '', agents: [], status: [], spend: 0, review: false }

/** Filters in use (the search not counted). */
export function filterCount(f: BoardFilter): number {
  return (f.agents.length ? 1 : 0) + (f.status.length ? 1 : 0) + (f.spend > 0 ? 1 : 0) + (f.review ? 1 : 0)
}

export function isFiltering(f: BoardFilter): boolean {
  return !!f.query.trim() || filterCount(f) > 0
}

export function statusOf(t: Pick<Task, 'st' | 'queued'>): BoardStatus {
  if (t.queued) return 'queued'
  if (t.st === 'working') return 'working'
  if (t.st === 'waiting' || t.st === 'failed') return 'needs'
  return 'idle'
}

/** Whether the card shows. `cost` and `openReview` are what's known about the task. */
export function matchesFilter(t: Task, f: BoardFilter, info: { cost: number; openReview: boolean }): boolean {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length) {
    const hay = [t.key, t.title, t.desc, t.branch, t.issue ? `#${t.issue.number}` : ''].join(' ').toLowerCase()
    if (!words.every((w) => hay.includes(w))) return false
  }
  if (f.agents.length && !f.agents.includes(t.agentKind ?? 'none')) return false
  if (f.status.length && !f.status.includes(statusOf(t))) return false
  if (f.spend > 0 && info.cost < f.spend) return false
  if (f.review && !info.openReview) return false
  return true
}

// ── Views ───────────────────────────────────────────────────────────
/** A named set of filters (the search isn't part of one). */
export interface BoardView {
  id: string
  name: string
  filter: BoardFilter
}

export const BUILTIN_VIEWS: BoardView[] = [
  { id: 'needs', name: 'Needs me', filter: { ...NO_FILTER, status: ['needs'] } },
  { id: 'working', name: 'Working', filter: { ...NO_FILTER, status: ['working', 'queued'] } },
  { id: 'review', name: 'Open review', filter: { ...NO_FILTER, review: true } },
  { id: 'expensive', name: 'Expensive', filter: { ...NO_FILTER, spend: 5 } }
]

/** Same filters, whatever order they were picked in (the search not compared). */
export function sameFilters(a: BoardFilter, b: BoardFilter): boolean {
  const set = (l: string[]): string => [...l].sort().join(',')
  return set(a.agents) === set(b.agents) && set(a.status) === set(b.status) && a.spend === b.spend && a.review === b.review
}

/** The view the filters are, if any. */
export function viewOf(f: BoardFilter, views: BoardView[]): BoardView | null {
  if (!filterCount(f)) return null
  return views.find((v) => sameFilters(v.filter, f)) ?? null
}

// ── Swimlanes ───────────────────────────────────────────────────────
export type BoardGroup = 'none' | 'agent' | 'repo'

export interface Lane {
  key: string
  label: string
  tasks: Task[]
}

/**
 * The cards in lanes: by agent (the one it runs, or is queued for; "No
 * agent" last) or by repository (a multi-repo task's lane is its set of
 * repositories, after the board's own). One lane of everything for 'none'.
 */
export function lanesOf(tasks: Task[], group: BoardGroup, opts: { projectId: string; projectName: (id: string) => string }): Lane[] {
  if (group === 'none') return [{ key: '', label: '', tasks }]
  const lanes = new Map<string, Lane & { rank: number }>()
  for (const t of tasks) {
    let key: string
    let label: string
    let rank: number
    if (group === 'agent') {
      key = t.agentKind ?? t.queued?.agentKind ?? 'none'
      const i = AGENTS.findIndex((a) => a.kind === key)
      label = i >= 0 ? AGENTS[i].name : 'No agent'
      rank = i >= 0 ? i : AGENTS.length
    } else {
      // The board's repository first, the others by name.
      const repos = reposOf(t)
      const ids = [opts.projectId, ...repos.filter((r) => r !== opts.projectId).sort((a, b) => opts.projectName(a).localeCompare(opts.projectName(b)))].filter((r) => repos.includes(r))
      key = ids.join('+')
      label = ids.map(opts.projectName).join(' + ')
      rank = ids.length === 1 && ids[0] === opts.projectId ? 0 : ids.length
    }
    let lane = lanes.get(key)
    if (!lane) lanes.set(key, (lane = { key, label, tasks: [], rank }))
    lane.tasks.push(t)
  }
  return [...lanes.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).map(({ key, label, tasks }) => ({ key, label, tasks }))
}

/** The board's filters for the project it shows. */
export function boardFilterOf(state: { projectId: string | null; board: BoardPrefs }): BoardFilter {
  return (state.projectId && state.board.filters[state.projectId]) || NO_FILTER
}

/** The board's lanes: as picked there, else Settings → Board's default (a project can have its own). */
export function boardGroupOf(state: { projectId: string | null; board: BoardPrefs; prefs?: Prefs; projects?: Project[] }): BoardGroup {
  const picked = state.projectId ? state.board.group[state.projectId] : undefined
  if (picked) return picked
  const own = state.projects?.find((p) => p.id === state.projectId)?.prefs?.defaultLanes
  return own ?? state.prefs?.defaultLanes ?? 'none'
}

// ── Kept per project ────────────────────────────────────────────────
/** What the board remembers: each project's filters and lanes, the views saved. */
export interface BoardPrefs {
  filters: Record<string, BoardFilter>
  group: Record<string, BoardGroup>
  /** Folded lanes, by project. */
  collapsed: Record<string, string[]>
  views: BoardView[]
}

const KEY = 'switchyard.board'
export const NO_BOARD_PREFS: BoardPrefs = { filters: {}, group: {}, collapsed: {}, views: [] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
function cleanFilter(v: unknown): BoardFilter {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    query: '',
    agents: strings(o.agents),
    status: strings(o.status).filter((s): s is BoardStatus => ['working', 'needs', 'queued', 'idle'].includes(s)),
    spend: typeof o.spend === 'number' && o.spend >= 0 ? o.spend : 0,
    review: o.review === true
  }
}

/** What was kept (anything odd in it is dropped). */
export function parseBoardPrefs(raw: string | null): BoardPrefs {
  if (!raw) return NO_BOARD_PREFS
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
    return {
      filters: Object.fromEntries(Object.entries(rec(o.filters)).map(([k, v]) => [k, cleanFilter(v)])),
      group: Object.fromEntries(Object.entries(rec(o.group)).filter(([, v]) => v === 'agent' || v === 'repo')) as Record<string, BoardGroup>,
      collapsed: Object.fromEntries(Object.entries(rec(o.collapsed)).map(([k, v]) => [k, strings(v)])),
      views: (Array.isArray(o.views) ? o.views : [])
        .filter((v): v is BoardView => !!v && typeof v.id === 'string' && typeof v.name === 'string')
        .map((v) => ({ id: v.id, name: v.name, filter: cleanFilter(v.filter) }))
    }
  } catch {
    return NO_BOARD_PREFS
  }
}

/** Saved without the searches (they're for the moment). */
export function serializeBoardPrefs(p: BoardPrefs): string {
  return JSON.stringify({ ...p, filters: Object.fromEntries(Object.entries(p.filters).filter(([, f]) => filterCount(f)).map(([k, f]) => [k, { ...f, query: undefined }])) })
}

export function loadBoardPrefs(): BoardPrefs {
  try {
    return parseBoardPrefs(localStorage.getItem(KEY))
  } catch {
    return NO_BOARD_PREFS
  }
}

export function saveBoardPrefs(p: BoardPrefs): void {
  try {
    localStorage.setItem(KEY, serializeBoardPrefs(p))
  } catch {
    // kept for this session only
  }
}

// The cards the board shows, in the order it shows them, for the keyboard's moves across it.
let order: Map<string, number> | null = null
export function setBoardOrder(ids: string[] | null): void {
  order = ids ? new Map(ids.map((id, i) => [id, i])) : null
}
export function cardVisible(id: string): boolean {
  return !order || order.has(id)
}
/** The tasks as the board lists them (lane by lane). */
/** Pinned tasks first (the latest pinned on top), the rest as they were. */
export function pinnedFirst<T extends { pinnedAt?: number | null }>(tasks: T[]): T[] {
  if (!tasks.some((t) => t.pinnedAt)) return tasks
  return [...tasks.filter((t) => t.pinnedAt).sort((a, b) => b.pinnedAt! - a.pinnedAt!), ...tasks.filter((t) => !t.pinnedAt)]
}

export function inBoardOrder<T extends { id: string }>(tasks: T[]): T[] {
  if (!order) return tasks
  const o = order
  return tasks.filter((t) => o.has(t.id)).sort((a, b) => o.get(a.id)! - o.get(b.id)!)
}

/** Focus the board's search ("/"). */
export function focusBoardSearch(): void {
  window.dispatchEvent(new CustomEvent('switchyard:board-search'))
}
