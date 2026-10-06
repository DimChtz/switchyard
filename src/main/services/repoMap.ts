import { execFile } from 'child_process'
import { promisify } from 'util'
import { gitArgs, gitEnv, newestBase } from './gitEnv'
import { existsSync, promises as fs } from 'fs'
import { isAbsolute, join, relative } from 'path'
import { getProjects, getTasks } from './store'
import { checkoutPath } from './conflicts'
import { baseFor } from '@shared/stack'
import type { MapActivity, MapTree, Task } from '@shared/types'

/**
 * The repository map: a project's files with their sizes (from its default
 * branch), and where each running task's agent works in it - the files it
 * changed (committed or not) and the one it's on right now.
 */

const execFileP = promisify(execFile)
const MAX_FILES = 30_000

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(args), { cwd, env: gitEnv(), windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/* ---------- where an agent is right now (from its tool calls) ---------- */

const focus = new Map<string, { path: string; tool: string; at: number }>()

/** Claude Code is about to use a tool: the file it's on (an absolute path, or one in its folder). */
export function noteTool(taskId: string, tool: string | undefined, input: Record<string, unknown> | undefined): void {
  const p = input?.file_path ?? input?.notebook_path ?? input?.path
  if (typeof p !== 'string' || !p) return
  focus.set(taskId, { path: p, tool: tool ?? '', at: Date.now() })
}

/* ---------- the files ---------- */

const trees = new Map<string, { head: string; tree: MapTree }>()

/** The project's files on its default branch, with their sizes (cached until the branch moves). */
export async function tree(projectId: string): Promise<MapTree> {
  const project = getProjects().find((p) => p.id === projectId)
  if (!project?.repoPath || !existsSync(project.repoPath)) return { projectId, ref: '', files: [], truncated: false }
  const ref = project.defaultBranch ?? 'main'
  const head = (await git(project.repoPath, ['rev-parse', ref]).catch(() => git(project.repoPath, ['rev-parse', 'HEAD']))).trim()
  const hit = trees.get(projectId)
  if (hit && hit.head === head) return hit.tree
  const raw = await git(project.repoPath, ['-c', 'core.quotepath=off', 'ls-tree', '-r', '-l', '--full-tree', '-z', head])
  const files: MapTree['files'] = []
  for (const entry of raw.split('\0')) {
    // "<mode> blob <sha> <size>\t<path>"
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const meta = entry.slice(0, tab).split(/\s+/)
    if (meta[1] !== 'blob') continue
    files.push({ path: entry.slice(tab + 1), size: Number(meta[3]) || 0 })
    if (files.length >= MAX_FILES) break
  }
  const t: MapTree = { projectId, ref, files, truncated: files.length >= MAX_FILES }
  trees.set(projectId, { head, tree: t })
  return t
}

/* ---------- where each task works ---------- */

/** A task's changed files in a checkout (vs where it branched off; uncommitted and new ones too). */
async function changed(path: string, base: string): Promise<string[]> {
  const fork = (await git(path, ['merge-base', await newestBase(path, base), 'HEAD']).catch(() => '')).trim()
  const [diff, untracked] = await Promise.all([
    fork ? git(path, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', fork]).catch(() => '') : Promise.resolve(''),
    git(path, ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard']).catch(() => '')
  ])
  return [...new Set([...diff.split('\n'), ...untracked.split('\n')].map((f) => f.trim()).filter(Boolean))]
}

/** The file it's on: the one its last tool call named (in this checkout), else the one it changed last. */
async function current(task: Task, path: string, files: string[]): Promise<{ file: string | null; at: number; tool: string | null }> {
  const f = focus.get(task.id)
  if (f && Date.now() - f.at < 10 * 60_000) {
    const abs = isAbsolute(f.path) ? f.path : join(path, f.path)
    const rel = relative(path, abs).replace(/\\/g, '/')
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return { file: rel, at: f.at, tool: f.tool }
  }
  let best: { file: string | null; at: number } = { file: null, at: 0 }
  for (const file of files.slice(0, 400)) {
    const st = await fs.stat(join(path, file)).catch(() => null)
    if (st && st.mtimeMs > best.at) best = { file, at: st.mtimeMs }
  }
  return { ...best, tool: null }
}

/** Every open task's files in the project, and the one its agent is on. */
export async function activity(projectId: string): Promise<MapActivity[]> {
  const projects = getProjects()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return []
  const all = getTasks()
  const tasks = all.filter((t) => t.worktreePath && t.branch && t.col !== 'done' && (t.projectId === projectId || t.repos?.includes(projectId)))
  const out: MapActivity[] = []
  for (const t of tasks) {
    const path = checkoutPath(t, project)
    if (!path || !existsSync(path)) continue
    const base = baseFor(t, project, all)
    const files = await changed(path, base)
    const now = await current(t, path, files)
    out.push({ taskId: t.id, files, now: now.file, nowAt: now.at, tool: now.tool })
  }
  return out
}
