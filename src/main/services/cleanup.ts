import { BrowserWindow } from 'electron'
import { gitAt } from './gitEnv'
import { staleReason } from '@shared/constants'
import { getPrefs, getProjects, getTasks } from './store'
import { getWorktreeStatus, listWorktrees } from './git'
import { expandPath } from './repos'
import { log } from './log'
import { join } from 'path'
import { canonical } from './paths'

const norm = canonical

const HOUR = 60 * 60 * 1000

/**
 * Settings → Git: prune stale worktrees on their own. Only ones no open
 * task uses, with no uncommitted changes, whose branch either has nothing
 * beyond the base branch or hasn't had a commit in `staleDays`. The folder
 * goes; the branch is kept unless it has no commits of its own - so no
 * work is ever lost.
 */
export async function pruneStale(now = false): Promise<string[]> {
  const prefs = getPrefs()
  if (!prefs.autoPrune && !now) return []
  // What open tasks use: their worktrees and task folders (a task in several
  // repositories holds a worktree in each), and their branches in every one
  // of their repositories.
  const open = getTasks().filter((t) => t.col !== 'done' && (t.worktreePath || t.branch))
  const heldPaths = open.flatMap((t) => [t.worktreePath, t.taskDir].filter((p): p is string => !!p)).map(norm)
  const openBranches = new Set(open.flatMap((t) => (t.branch ? [t.projectId, ...(t.repos ?? [])].map((id) => `${id}|${t.branch}`) : [])))
  const root = prefs.worktreeRoot ? norm(expandPath(prefs.worktreeRoot)) : null
  const pruned: string[] = []
  for (const project of getProjects()) {
    const base = project.defaultBranch ?? 'main'
    let worktrees: Awaited<ReturnType<typeof listWorktrees>>
    try {
      worktrees = (await listWorktrees(project.repoPath)).filter((w) => !w.isMain && !w.locked)
    } catch {
      continue
    }
    // Only folders Switchyard makes (.worktrees in the repository, or the
    // worktree root): a worktree you made yourself elsewhere is yours.
    const ours = (p: string): boolean => {
      const n = norm(p)
      return n.startsWith(norm(join(project.repoPath, '.worktrees')) + '/') || (!!root && n.startsWith(root + '/'))
    }
    for (const w of worktrees) {
      if (!ours(w.path) || heldPaths.some((h) => norm(w.path) === h || norm(w.path).startsWith(h + '/'))) continue
      try {
        const status = await getWorktreeStatus(w.path, base)
        const linked = openBranches.has(`${project.id}|${w.branch}`)
        if (status.dirty > 0 || !staleReason({ linked, ...status }, prefs.staleDays, base)) continue
        const git = gitAt(project.repoPath)
        await git.raw(['worktree', 'remove', w.path])
        if (status.ahead === 0 && w.branch) await git.raw(['branch', '-d', w.branch]).catch(() => {})
        pruned.push(`${project.name}: ${w.branch || w.path}`)
        log.info('cleanup', `Pruned the stale worktree ${w.path}`)
      } catch (err) {
        // in use or changed meanwhile - try again next time
        log.warn('cleanup', `Could not prune ${w.path}`, err)
      }
    }
  }
  if (pruned.length) {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('worktrees:pruned', pruned)
  }
  return pruned
}

/** Runs the cleanup shortly after start and then hourly. */
export function startCleanup(): void {
  setTimeout(() => pruneStale().catch(() => {}), 30_000)
  setInterval(() => pruneStale().catch(() => {}), HOUR)
}
