import { useEffect, useState } from 'react'
import { matchPath } from './fuzzy'
import type { AppState, FileScope } from '../store/types'
import type { CheckoutFiles } from '@shared/types'
import { inProject, taskRoot } from './multiRepo'

/**
 * Go to file (Ctrl+P): which checkout it searches, its files (cached per
 * checkout, refreshed on every open), the files opened there lately, and
 * the ranking.
 */

/** Where you are: the open task's worktree, else the current project's main checkout. */
export function defaultScope(state: AppState): FileScope | null {
  const task = state.view === 'workspace' ? state.tasks.find((t) => t.id === state.taskId) : undefined
  if (task?.worktreePath) return { projectId: task.projectId, taskId: task.id }
  const project = state.projects.find((p) => p.id === state.projectId) ?? state.projects[0]
  return project ? { projectId: project.id, taskId: null } : null
}

/** The checkouts of a project Go to file can switch between: its main checkout, then each task's worktree. */
export function scopesOf(state: AppState, projectId: string): FileScope[] {
  return [{ projectId, taskId: null }, ...state.tasks.filter((t) => inProject(t, projectId) && t.worktreePath).map((t) => ({ projectId, taskId: t.id }))]
}

export function scopeRoot(state: AppState, scope: FileScope): string | null {
  if (scope.taskId) {
    const task = state.tasks.find((t) => t.id === scope.taskId)
    return task ? taskRoot(task) : null
  }
  return state.projects.find((p) => p.id === scope.projectId)?.repoPath || null
}

/** "demo › SYT-1 · feature/x" or "demo › main checkout · main". */
export function scopeLabel(state: AppState, scope: FileScope): { project: string; where: string; branch: string } {
  const project = state.projects.find((p) => p.id === scope.projectId)
  const task = scope.taskId ? state.tasks.find((t) => t.id === scope.taskId) : undefined
  return {
    project: project?.name ?? '?',
    where: task ? `${task.key} ${task.title}` : 'main checkout',
    branch: task ? (task.branch ?? '') : (project?.defaultBranch ?? 'main')
  }
}

export const sameScope = (a: FileScope | null, b: FileScope | null): boolean => !!a && !!b && a.projectId === b.projectId && a.taskId === b.taskId

const lists = new Map<string, CheckoutFiles>()

/** A checkout's files: the last list at once (if any), then a fresh one. */
export function useCheckoutFiles(root: string | null): { list: CheckoutFiles | null; error: string | null } {
  const [state, setState] = useState<{ root: string | null; list: CheckoutFiles | null; error: string | null }>({ root, list: root ? (lists.get(root) ?? null) : null, error: null })
  useEffect(() => {
    if (!root) return
    let live = true
    setState({ root, list: lists.get(root) ?? null, error: null })
    window.api.fs
      .listAll(root)
      .then((list) => {
        lists.set(root, list)
        if (live) setState({ root, list, error: null })
      })
      .catch((err: unknown) => live && setState({ root, list: lists.get(root) ?? null, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [root])
  return state.root === root ? { list: state.list, error: state.error } : { list: root ? (lists.get(root) ?? null) : null, error: null }
}

/* ---------- files opened lately, per checkout ---------- */

const RECENT_KEY = 'switchyard.recentFiles'
const RECENT_MAX = 20

function readRecent(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string[]>
  } catch {
    return {}
  }
}

const rootKey = (root: string): string => root.replace(/\\/g, '/').toLowerCase()

export function recentFiles(root: string): string[] {
  return readRecent()[rootKey(root)] ?? []
}

/** Remembers a file opened in a checkout (newest first), so Go to file lists it on top. */
export function rememberFile(root: string, path: string): void {
  const all = readRecent()
  const key = rootKey(root)
  all[key] = [path, ...(all[key] ?? []).filter((p) => p !== path)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(all))
  } catch {
    // Storage full or unavailable - recent files are a convenience.
  }
}

/* ---------- ranking ---------- */

export interface FileHit {
  path: string
  positions: number[]
  changed: boolean
  recent: boolean
}

/**
 * The files to show for a query. Empty: recently opened, then changed,
 * then the rest. Otherwise fuzzy matches, recent and changed ones a little
 * higher.
 */
export function searchFiles(list: CheckoutFiles, query: string, recent: string[], limit = 80): FileHit[] {
  const changed = new Set(list.changed)
  const recentRank = new Map(recent.map((p, i) => [p, i]))
  const hit = (path: string, positions: number[] = []): FileHit => ({ path, positions, changed: changed.has(path), recent: recentRank.has(path) })
  if (!query.trim()) {
    const has = indexOf(list).has
    const first = [...recent.filter((p) => has.has(p)), ...list.changed.filter((p) => has.has(p) && !recentRank.has(p))]
    const seen = new Set(first)
    const out = first.map((p) => hit(p))
    for (const p of list.files) {
      if (out.length >= limit) break
      if (!seen.has(p)) out.push(hit(p))
    }
    return out.slice(0, limit)
  }
  const { lower, all } = indexOf(list)
  // Typing on: only what matched the shorter query can still match.
  const prevHit = lastSearch?.list === list && query.startsWith(lastSearch.query) && !(query.includes('/') && !lastSearch.query.includes('/'))
  const candidates = prevHit ? lastSearch!.matched : all
  const matched: number[] = []
  const scored: { path: string; score: number; positions: number[] }[] = []
  for (const i of candidates) {
    const path = list.files[i]
    const m = matchPath(query, path, lower[i])
    if (!m) continue
    matched.push(i)
    const r = recentRank.get(path)
    scored.push({ path, positions: m.positions, score: m.score + (r !== undefined ? 12 - r * 0.5 : 0) + (changed.has(path) ? 4 : 0) })
  }
  lastSearch = { list, query, matched }
  // Only the best `limit` are shown: sort just those (a big checkout can match thousands).
  let top = scored
  if (scored.length > limit) {
    const scores = Float64Array.from(scored, (x) => x.score).sort()
    const cut = scores[scores.length - limit]
    top = scored.filter((x) => x.score >= cut)
  }
  top.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return top.slice(0, limit).map((s) => hit(s.path, s.positions))
}

// Lower-cased paths, once per list; and the last search, to narrow the next.
interface Index {
  lower: string[]
  all: number[]
  has: Set<string>
}
const indexes = new WeakMap<CheckoutFiles, Index>()
let lastSearch: { list: CheckoutFiles; query: string; matched: number[] } | null = null

function indexOf(list: CheckoutFiles): Index {
  let ix = indexes.get(list)
  if (!ix) {
    ix = { lower: list.files.map((f) => f.toLowerCase()), all: list.files.map((_, i) => i), has: new Set(list.files) }
    indexes.set(list, ix)
  }
  return ix
}
