import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { gitArgs, gitEnv, newestBase } from './gitEnv'
import { existsSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { getProjects, getTasks } from './store'
import { snapshotCommit, whenTurnEnds } from './checkpoints'
import { introduce } from './team'
import { IPC } from '@shared/ipc'
import { baseFor, stacked } from '@shared/stack'
import type { ConflictPair, ConflictReport, Project, Task } from '@shared/types'

/**
 * The conflict radar: which running tasks change the same files, and
 * whether their changes (uncommitted ones too) would still merge - with
 * each other, and with their base branch. Each worktree's files are
 * snapshotted as a commit (see checkpoints), and the files two sides both
 * changed are merged three ways with `git merge-file` in a temp folder -
 * no worktree is touched.
 */

const execFileP = promisify(execFile)
const EVERY_MS = 90_000

async function git(cwd: string, args: string[]): Promise<{ out: string }> {
  const { stdout } = await execFileP('git', gitArgs(args), { cwd, env: gitEnv(), windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  return { out: stdout }
}

/** One task's checkout of one repository, snapshotted. */
interface Checkout {
  task: Task
  project: Project
  path: string
  sha: string
  base: string
  files: Set<string>
}

/** Where a task's checkout of a repository is: its worktree, or its folder in the task's folder. */
export function checkoutPath(task: Task, project: Project): string | null {
  if (!task.worktreePath) return null
  if (!task.taskDir) return project.id === task.projectId ? task.worktreePath : null
  const dir = basename(project.repoPath.replace(/[\\/]+$/, '')) || project.name
  const p = join(task.taskDir, dir)
  return existsSync(p) ? p : null
}

/** A file's content at a commit; null when it isn't there. */
async function blob(cwd: string, sha: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileP('git', gitArgs(['show', `${sha}:${path}`]), { cwd, env: gitEnv(), windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

/**
 * Merges one file three ways (git merge-file, in a temp folder - no
 * worktree is touched): whether it clashes, and the merged text with
 * conflict markers.
 */
async function mergeFile(cwd: string, base: string, ours: string, theirs: string, path: string, labels: [string, string]): Promise<{ conflict: boolean; text: string }> {
  const [o, b, t] = await Promise.all([blob(cwd, ours, path), blob(cwd, base, path), blob(cwd, theirs, path)])
  if (o && t && o.equals(t)) return { conflict: false, text: o.toString('utf-8') }
  // Deleted on one side: fine if the other side left it as it was.
  if (!o || !t) {
    const kept = o ?? t
    const clean = !kept || (!!b && kept.equals(b))
    return { conflict: !clean, text: kept ? kept.toString('utf-8') : '' }
  }
  if (o.includes(0) || t.includes(0)) return { conflict: true, text: '(binary file - both changed it)' }
  const dir = await fs.mkdtemp(join(tmpdir(), 'switchyard-merge-'))
  try {
    const [fo, fb, ft] = ['ours', 'base', 'theirs'].map((n) => join(dir, n))
    await Promise.all([fs.writeFile(fo, o), fs.writeFile(fb, b ?? ''), fs.writeFile(ft, t)])
    try {
      const { stdout } = await execFileP('git', gitArgs(['merge-file', '-p', '-L', labels[0], '-L', 'base', '-L', labels[1], fo, fb, ft]), { cwd, env: gitEnv(), windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
      return { conflict: false, text: stdout }
    } catch (err) {
      // Exit code: how many conflicts (a negative one is an error).
      const e = err as { code?: number; stdout?: string }
      if (typeof e.code === 'number' && e.code > 0) return { conflict: true, text: e.stdout ?? '' }
      throw err
    }
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Of the files both sides changed, the ones that won't merge. */
async function clashing(cwd: string, a: string, b: string, files: string[]): Promise<string[]> {
  const base = (await git(cwd, ['merge-base', a, b])).out.trim()
  const out: string[] = []
  for (const f of files) if ((await mergeFile(cwd, base, a, b, f, ['a', 'b']).catch(() => ({ conflict: true }))).conflict) out.push(f)
  return out
}

let last: ConflictReport = { at: 0, pairs: [], mergeCheck: true }
let running: Promise<ConflictReport> | null = null

export function report(): ConflictReport {
  return last
}

/** Checks every running task now (one check at a time). */
export function scan(): Promise<ConflictReport> {
  running ??= doScan().finally(() => (running = null))
  return running
}

async function doScan(): Promise<ConflictReport> {
  const projects = getProjects()
  const all = getTasks()
  const tasks = all.filter((t) => t.worktreePath && t.branch && t.col !== 'done')
  const checkouts: Checkout[] = []
  for (const task of tasks) {
    for (const id of [task.projectId, ...(task.repos ?? []).filter((r) => r !== task.projectId)]) {
      const project = projects.find((p) => p.id === id)
      const path = project?.repoPath ? checkoutPath(task, project) : null
      if (!project || !path || !existsSync(join(path, '.git'))) continue
      try {
        const snap = await snapshotCommit(path, `Switchyard conflict check: ${task.key}`)
        // A task building on another compares with that one's branch (its own changes only).
        const base = baseFor(task, project, all)
        const fork = (await git(path, ['merge-base', await newestBase(path, base), snap.sha])).out.trim()
        const names = (await git(path, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', fork, snap.sha])).out
        checkouts.push({ task, project, path, sha: snap.sha, base, files: new Set(names.split('\n').filter(Boolean)) })
      } catch {
        // no base branch, or not a repository with commits - nothing to compare
      }
    }
  }
  const pairs: ConflictPair[] = []
  // Tasks in the same repository changing the same files.
  for (let i = 0; i < checkouts.length; i++) {
    for (let j = i + 1; j < checkouts.length; j++) {
      const a = checkouts[i]
      const b = checkouts[j]
      if (a.project.id !== b.project.id || a.task.id === b.task.id) continue
      // One builds on the other: it has its changes already (the base check below covers new ones).
      if (stacked(a.task, b.task, all)) continue
      const files = [...a.files].filter((f) => b.files.has(f)).sort()
      if (!files.length) continue
      const conflicts = await clashing(a.path, a.sha, b.sha, files).catch(() => [])
      pairs.push({ repoId: a.project.id, a: a.task.id, b: b.task.id, files, conflicts })
    }
  }
  // A task whose changes no longer merge with its base branch (it moved on, changing the same files).
  for (const c of checkouts) {
    if (!c.files.size) continue
    try {
      const fork = (await git(c.path, ['merge-base', c.base, c.sha])).out.trim()
      const moved = (await git(c.path, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', fork, c.base])).out.split('\n').filter((f) => f && c.files.has(f))
      const conflicts = moved.length ? await clashing(c.path, c.sha, c.base, moved) : []
      if (conflicts.length) pairs.push({ repoId: c.project.id, a: c.task.id, b: null, files: conflicts, conflicts })
    } catch {
      // no base branch
    }
  }
  const touched: Record<string, string[]> = {}
  for (const c of checkouts) {
    const multi = (c.task.repos ?? []).some((r) => r !== c.task.projectId)
    touched[c.task.id] = [...(touched[c.task.id] ?? []), ...[...c.files].map((f) => (multi ? `${c.project.name}:${f}` : f))]
  }
  last = { at: Date.now(), pairs, mergeCheck: true, touched }
  try {
    introduce(pairs)
  } catch {
    // the report stands without introductions
  }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.conflictsChanged, last)
  return last
}

/**
 * The file as merging the two would leave it - conflict markers where they
 * clash. `b` null: the task with its base branch.
 */
export async function preview(repoId: string, a: string, b: string | null, file: string): Promise<string> {
  const projects = getProjects()
  const tasks = getTasks()
  const project = projects.find((p) => p.id === repoId)
  const ta = tasks.find((t) => t.id === a)
  if (!project || !ta) throw new Error('That task is gone.')
  const pa = checkoutPath(ta, project)
  if (!pa) throw new Error('Its worktree isn’t there.')
  const sa = await snapshotCommit(pa, 'Switchyard conflict preview')
  let other: string
  if (b) {
    const tb = tasks.find((t) => t.id === b)
    const pb = tb ? checkoutPath(tb, project) : null
    if (!pb) throw new Error('The other task’s worktree isn’t there.')
    other = (await snapshotCommit(pb, 'Switchyard conflict preview')).sha
  } else other = baseFor(ta, project, tasks)
  const base = (await git(pa, ['merge-base', sa.sha, other])).out.trim()
  const tb = b ? tasks.find((t) => t.id === b) : undefined
  const { text } = await mergeFile(pa, base, sa.sha, other, file, [ta.key, tb?.key ?? other])
  return text.length > 200_000 ? text.slice(0, 200_000) + '\n…' : text
}

// Checked now and then, and soon after an agent finishes a turn.
let soon: ReturnType<typeof setTimeout> | undefined
export function checkSoon(ms = 3000): void {
  clearTimeout(soon)
  soon = setTimeout(() => scan().catch(() => {}), ms)
}

export function start(): void {
  whenTurnEnds(() => checkSoon())
  checkSoon(8000)
  setInterval(() => {
    if (BrowserWindow.getAllWindows().length) scan().catch(() => {})
  }, EVERY_MS)
}
