import { execFile } from 'child_process'
import { promisify } from 'util'
import { GIT_CONFIG, gitBusy, gitEnv } from './gitEnv'
import { listWorktrees } from './git'
import { canonical } from './paths'
import { workingIn } from './agentStatus'
import { getProjects } from './store'
import { log } from './log'

/**
 * Switchyard's own git chores - the background fetch, pruning stale
 * worktrees, git's housekeeping - done when nothing else is at work in the
 * repository, so they never hold a lock an agent's `git commit` or rebase
 * needs ("Another git process seems to be running in this repository").
 *
 * "At work": a git mid-way through something (a lock held, a rebase under
 * way - see gitBusy), or an agent in the middle of a turn in one of the
 * repository's worktrees - it may run git any moment.
 */

const execFileP = promisify(execFile)

/** What's at work in the repository, or null when it's quiet. */
export async function repoAtWork(repoPath: string): Promise<string | null> {
  const busy = await gitBusy(repoPath)
  if (busy) return busy
  const agents = workingIn().map(canonical)
  if (!agents.length) return null
  const trees = (await listWorktrees(repoPath).catch(() => [])).map((w) => canonical(w.path))
  // Its folder is one of the repository's worktrees - or the folder of a task in several
  // repositories, which holds them side by side (only directly: not any folder above one).
  const at = agents.find((a) => trees.some((t) => t === a || t.slice(0, t.lastIndexOf('/')) === a))
  return at ? `an agent is at work in ${at}` : null
}

/**
 * Waits for a quiet moment in the repository - checking every `everyMs`,
 * for up to `maxMs`. True once it's quiet; false if it never was (the
 * caller decides whether to go ahead anyway).
 */
export async function whenQuiet(repoPath: string, maxMs: number, everyMs = 20_000): Promise<boolean> {
  const until = Date.now() + maxMs
  for (;;) {
    if (!(await repoAtWork(repoPath))) return true
    if (Date.now() + everyMs > until) return false
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

/**
 * git's housekeeping (packing loose objects and refs), run by Switchyard at
 * a quiet moment. Its own git commands never start it (gc.auto=0), but they
 * do add objects - each checkpoint is a commit - so left alone, the next
 * `git commit` an agent makes would start it, and on Windows wait for it,
 * holding locks the other tasks' agents then run into. `gc --auto` does
 * nothing until git's own threshold is reached, and honours your gc.auto
 * (0: never).
 */
export async function housekeep(repoPath: string): Promise<boolean> {
  const busy = await repoAtWork(repoPath)
  if (busy) {
    log.info('git', `Housekeeping in ${repoPath} waits - ${busy}`)
    return false
  }
  const config = GIT_CONFIG.filter((c) => !/^(gc\.auto|maintenance\.auto)=/.test(c)).flatMap((c) => ['-c', c])
  try {
    await execFileP('git', [...config, 'gc', '--auto', '--quiet'], { cwd: repoPath, env: gitEnv(), windowsHide: true, timeout: 10 * 60_000 })
    return true
  } catch (err) {
    log.warn('git', `Housekeeping in ${repoPath} failed`, err)
    return false
  }
}

/** housekeep for every project, one after another. */
export async function housekeepAll(): Promise<void> {
  for (const p of getProjects()) if (p.repoPath) await housekeep(p.repoPath)
}
