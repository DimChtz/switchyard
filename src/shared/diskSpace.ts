/**
 * What fills a worktree's disk: besides the code, what tools generate in it -
 * dependencies, build output, caches. Folders with these names count as such
 * only where git ignores them (a committed vendor/ or build/ is code).
 */
export type SpaceKind = 'deps' | 'build' | 'cache'

const KINDS: Record<string, SpaceKind> = {
  node_modules: 'deps',
  bower_components: 'deps',
  '.venv': 'deps',
  venv: 'deps',
  vendor: 'deps',
  deps: 'deps',
  Pods: 'deps',
  '.pnpm-store': 'deps',
  '.yarn': 'deps',
  dist: 'build',
  build: 'build',
  out: 'build',
  target: 'build',
  _build: 'build',
  '.next': 'build',
  '.nuxt': 'build',
  '.output': 'build',
  '.svelte-kit': 'build',
  '.expo': 'build',
  storybook_static: 'build',
  '.turbo': 'cache',
  '.cache': 'cache',
  '.parcel-cache': 'cache',
  '.angular': 'cache',
  '.gradle': 'cache',
  '.pytest_cache': 'cache',
  '.mypy_cache': 'cache',
  '.ruff_cache': 'cache',
  __pycache__: 'cache',
  coverage: 'cache',
  '.nyc_output': 'cache',
  '.elixir_ls': 'cache'
}

export function generatedKind(folderName: string): SpaceKind | null {
  return Object.prototype.hasOwnProperty.call(KINDS, folderName) ? KINDS[folderName] : null
}

export const SPACE_LABEL: Record<SpaceKind, string> = { deps: 'Dependencies', build: 'Build output', cache: 'Caches' }

/** A generated folder in a worktree (path relative to it, with /). */
export interface GeneratedFolder {
  rel: string
  kind: SpaceKind
  bytes: number
}

export interface WorktreeSize {
  path: string
  total: number
  code: number
  deps: number
  build: number
  cache: number
  /** The generated folders, biggest first: what clearing would delete. */
  generated: GeneratedFolder[]
  measuredAt: number
}

/** A folder where Switchyard keeps worktrees that git no longer knows - left behind. */
export interface LeftoverFolder {
  projectId: string
  path: string
  bytes: number
  modifiedAt: number
}

export interface DiskFree {
  /** A folder on the drive (the first project on it). */
  path: string
  free: number
  size: number
}

export function generatedBytes(s: Pick<WorktreeSize, 'deps' | 'build' | 'cache'>): number {
  return s.deps + s.build + s.cache
}

/** 1.4 GB, 312 MB, 18 KB. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** A worktree whose generated folders can go without getting in anyone's way: no agent at work, and left alone a while. */
export const IDLE_DAYS = 3

export function idleForClearing(task: { st: string | null; queued?: unknown; col: string; lastActivityAt: number } | null, now = Date.now()): boolean {
  if (!task) return true
  if (task.st === 'working' || task.queued) return false
  return task.col === 'parked' || task.col === 'done' || now - task.lastActivityAt >= IDLE_DAYS * 86_400_000
}
