import { promises as fs, type Stats } from 'fs'
import { basename, join, relative, resolve } from 'path'
import { generatedKind, type DiskFree, type GeneratedFolder, type LeftoverFolder, type WorktreeSize } from '@shared/diskSpace'
import { getPrefs, getProjects, getTasks } from './store'
import { listWorktrees } from './git'
import { ignoredOf } from './fs'
import { expandPath } from './repos'
import { canonical, isInside } from './paths'
import { mainWindow } from './windows'
import { log } from './log'

/**
 * How much room worktrees take on disk, and what can be given back: the
 * generated folders in them (dependencies, builds, caches - made again by
 * an install or a build), and folders git no longer knows (left behind by a
 * worktree removed by hand, or a crash).
 */

// Many files at a time, not so many that the disk (or the file handles) choke.
function limiter(n: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async (work) => {
    if (active >= n) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await work()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
const io = limiter(48)

// The room a file takes (its blocks where the system says), and hard links
// (pnpm's store) counted once.
function sizeOf(st: Stats, seen: Set<string> | null): number {
  if (seen && st.nlink > 1) {
    const id = `${st.dev}:${st.ino}`
    if (seen.has(id)) return 0
    seen.add(id)
  }
  return typeof st.blocks === 'number' && process.platform !== 'win32' ? st.blocks * 512 : st.size
}

/** All the bytes under a folder (links not followed). */
async function folderBytes(dir: string, seen: Set<string> | null): Promise<number> {
  const entries = await io(() => fs.readdir(dir, { withFileTypes: true })).catch(() => [])
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const p = join(dir, e.name)
      if (e.isDirectory()) return folderBytes(p, seen)
      if (e.isSymbolicLink()) return 0
      const st = await io(() => fs.lstat(p)).catch(() => null)
      return st ? sizeOf(st, seen) : 0
    })
  )
  return sizes.reduce((a, b) => a + b, 0)
}

const cache = new Map<string, WorktreeSize>()
const FRESH_FOR = 10 * 60_000

/** A worktree's size: the code, and each generated folder in it. Measured again after ten minutes, or when asked. */
export async function measureWorktree(path: string, fresh = false): Promise<WorktreeSize> {
  const key = canonical(path)
  const known = cache.get(key)
  if (known && !fresh && Date.now() - known.measuredAt < FRESH_FOR) return known
  const seen = process.platform === 'win32' ? null : new Set<string>()
  let code = 0
  const found: { rel: string; kind: GeneratedFolder['kind']; bytes: number }[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await io(() => fs.readdir(dir, { withFileTypes: true })).catch(() => [])
    await Promise.all(
      entries.map(async (e) => {
        const p = join(dir, e.name)
        const r = rel ? `${rel}/${e.name}` : e.name
        // (The worktree's .git is a small file pointing at the repository.)
        if (!rel && e.name === '.git') return
        if (e.isSymbolicLink()) return
        if (e.isDirectory()) {
          const kind = generatedKind(e.name)
          if (kind) found.push({ rel: r, kind, bytes: await folderBytes(p, seen) })
          else await walk(p, r)
          return
        }
        const st = await io(() => fs.lstat(p)).catch(() => null)
        if (st) code += sizeOf(st, seen)
      })
    )
  }
  await walk(path, '')
  // Only what git ignores is generated: a committed vendor/ is code.
  const ignored = found.length ? await ignoredOf(path, found.map((f) => f.rel)) : new Set<string>()
  const out: WorktreeSize = { path, total: 0, code, deps: 0, build: 0, cache: 0, generated: [], measuredAt: Date.now() }
  for (const f of found) {
    if (ignored.has(f.rel)) {
      out[f.kind] += f.bytes
      out.generated.push(f)
    } else out.code += f.bytes
  }
  out.generated.sort((a, b) => b.bytes - a.bytes)
  out.total = out.code + out.deps + out.build + out.cache
  cache.set(key, out)
  return out
}

/** Every worktree path git knows of, in every project (not the repositories' own checkouts). */
async function knownWorktrees(): Promise<string[]> {
  const lists = await Promise.all(getProjects().filter((p) => p.repoPath).map((p) => listWorktrees(p.repoPath).catch(() => null)))
  // (A project whose repository can't be read: nothing of its can be called left behind.)
  if (lists.some((l) => l === null)) throw new Error('A project’s repository could not be read - nothing is called left behind while it can’t.')
  return lists.flatMap((l) => (l ?? []).filter((w) => !w.isMain).map((w) => w.path))
}

/** The folders where Switchyard puts worktrees: .worktrees in each repository, or the worktree root from Settings. */
function worktreeHomes(): { projectId: string; dir: string }[] {
  const root = getPrefs().worktreeRoot
  const repos = getProjects().map((p) => p.repoPath).filter(Boolean)
  // (A worktree root that is - or holds - a repository: only its worktree folders count, never the repository.)
  const safe = (h: { dir: string }): boolean => h.dir.endsWith('.worktrees') || !repos.some((r) => isInside(r, h.dir) || isInside(h.dir, r))
  const homes = getProjects()
    .filter((p) => p.repoPath)
    .flatMap((p) => [
      { projectId: p.id, dir: join(p.repoPath, '.worktrees') },
      ...(root ? [{ projectId: p.id, dir: join(expandPath(root), basename(p.repoPath)) }] : [])
    ])
    .concat(root && getProjects()[0] ? [{ projectId: getProjects()[0].id, dir: join(expandPath(root), '_multi') }] : [])
  return homes.filter(safe)
}

async function isDir(p: string): Promise<boolean> {
  return (await fs.stat(p).catch(() => null))?.isDirectory() ?? false
}

/**
 * Folders in Switchyard's worktree homes that no worktree, task or task
 * folder is in - what's left of a worktree git forgot. Never a folder that
 * is a repository of its own.
 */
export async function leftoverFolders(measure = true): Promise<LeftoverFolder[]> {
  const known = (await knownWorktrees()).map(canonical)
  const held = getTasks()
    .flatMap((t) => [t.worktreePath, t.taskDir])
    .filter((p): p is string => !!p)
    .map(canonical)
  // (A task working in the repository itself holds no worktree folder.)
  const repos = getProjects().map((p) => (p.repoPath ? canonical(p.repoPath) : '')).filter(Boolean)
  const inUse = [...known, ...held].filter((u) => !repos.includes(u))
  const candidates: { projectId: string; path: string }[] = []
  const seen = new Set<string>()
  for (const home of worktreeHomes()) {
    if (!(await isDir(home.dir))) continue
    const entries = await fs.readdir(home.dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = join(home.dir, e.name)
      // A task in several repositories: one folder per task in _multi.
      if (e.name === '_multi') {
        for (const m of await fs.readdir(p, { withFileTypes: true }).catch(() => [])) if (m.isDirectory()) candidates.push({ projectId: home.projectId, path: join(p, m.name) })
      } else candidates.push({ projectId: home.projectId, path: p })
    }
  }
  const out: LeftoverFolder[] = []
  for (const c of candidates) {
    const key = canonical(c.path)
    if (seen.has(key)) continue
    seen.add(key)
    if (inUse.some((u) => u === key || u.startsWith(key + '/') || key.startsWith(u + '/'))) continue
    if (getProjects().some((p) => p.repoPath && isInside(p.repoPath, c.path))) continue
    // A repository of its own (a clone put here): not a worktree's leftovers.
    if (await isDir(join(c.path, '.git'))) continue
    const st = await fs.stat(c.path).catch(() => null)
    if (!st) continue
    out.push({ ...c, bytes: measure ? await folderBytes(c.path, null) : 0, modifiedAt: st.mtimeMs })
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

/** Deletes a folder left behind - after checking again that it still is one. */
export async function deleteLeftover(path: string): Promise<void> {
  const still = (await leftoverFolders(false)).some((l) => canonical(l.path) === canonical(path))
  if (!still) throw new Error(`${path} is not a folder left behind (any more) - not deleted.`)
  await fs.rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
  log.info('disk', `Deleted the leftover folder ${path}`)
}

/**
 * Deletes generated folders in a worktree (relative paths, from its
 * measure) - each checked again: inside it, a generated folder's name, and
 * ignored by git. Returns the bytes freed.
 */
export async function clearGenerated(worktreePath: string, rels: string[]): Promise<number> {
  const root = resolve(worktreePath)
  const ok = rels.filter((r) => {
    const p = resolve(root, r)
    return p !== root && isInside(p, root) && !relative(root, p).startsWith('..') && !!generatedKind(basename(p))
  })
  const ignored = ok.length ? await ignoredOf(root, ok) : new Set<string>()
  const known = cache.get(canonical(root))
  let freed = 0
  for (const rel of ok) {
    if (!ignored.has(rel)) continue
    await fs.rm(resolve(root, rel), { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    freed += known?.generated.find((g) => g.rel === rel)?.bytes ?? 0
  }
  cache.delete(canonical(root))
  log.info('disk', `Cleared ${ok.length} generated folder(s) in ${root}`)
  return freed
}

/** Free room on each drive that holds projects or worktrees. */
export async function diskFree(): Promise<DiskFree[]> {
  const root = getPrefs().worktreeRoot
  const places = [...getProjects().map((p) => p.repoPath), ...(root ? [expandPath(root)] : [])].filter(Boolean)
  const out: DiskFree[] = []
  const drives = new Set<string>()
  for (const p of places) {
    const st = await fs.statfs(p).catch(() => null)
    if (!st) continue
    // (The same drive: the same numbers - one entry.)
    const id = `${st.blocks}:${st.bsize}:${st.type}`
    if (drives.has(id)) continue
    drives.add(id)
    out.push({ path: p, free: st.bavail * st.bsize, size: st.blocks * st.bsize })
  }
  return out
}

const warnedAt = new Map<string, number>()

/** Settings → Git: says when a drive with projects on it runs low (at most every 6 hours per drive). */
export async function checkLowDisk(): Promise<void> {
  const gb = getPrefs().lowDiskGb
  if (!gb) return
  for (const d of await diskFree()) {
    if (d.free >= gb * 1e9) continue
    const last = warnedAt.get(d.path) ?? 0
    if (Date.now() - last < 6 * 60 * 60_000) continue
    warnedAt.set(d.path, Date.now())
    mainWindow()?.webContents.send('disk:low', d)
  }
}
