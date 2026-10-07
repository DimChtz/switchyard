import { execFile } from 'child_process'
import { promisify } from 'util'
import { gitArgs, gitEnv } from './gitEnv'
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getProjects, getTasks } from './store'
import { isInside, realFolder, samePath } from './paths'
import { getWorktreeStatus, listWorktrees } from './git'
import type { OutsideItem, OutsideSession, Project, Task } from '@shared/types'

/**
 * Work done outside Switchyard, in its projects: worktrees and branches no
 * task holds, and Claude Code / Codex conversations (in them, or in the
 * main checkout). Read only - bringing one in is the board's doing.
 */

const execFileP = promisify(execFile)
const DAY = 24 * 60 * 60 * 1000
const SESSION_DAYS = 30
const BRANCH_DAYS = 120
const HEAD_BYTES = 96 * 1024
const TAIL_BYTES = 128 * 1024

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(args), { cwd, env: gitEnv(), windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

export { samePath }

/** Claude Code's folder name for a working directory: everything but letters and digits as "-". */
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

async function head(path: string, bytes: number): Promise<string> {
  const f = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await f.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } finally {
    await f.close()
  }
}

async function tail(path: string, bytes: number): Promise<string> {
  const f = await fs.open(path, 'r')
  try {
    const { size } = await f.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    const { bytesRead } = await f.read(buf, 0, buf.length, start)
    const text = buf.subarray(0, bytesRead).toString('utf-8')
    // A cut first line isn't JSON: drop it.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await f.close()
  }
}

function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    try {
      out.push(JSON.parse(l))
    } catch {
      // a cut line
    }
  }
  return out
}

function short(text: string | null | undefined, max = 280): string | null {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

type Block = { type?: string; text?: string }
const textOf = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? (content as Block[]).filter((b) => (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && b.text).map((b) => b.text).join('\n') : '')
// Not something a person typed: tool results, slash-command wrappers, injected context.
const typed = (t: string): boolean => !!t.trim() && !t.trimStart().startsWith('<') && !t.startsWith('Caveat:')

/** A Claude Code transcript: its working folder, branch, first prompt and last answer. */
export async function readClaudeSession(path: string): Promise<OutsideSession | null> {
  const st = await fs.stat(path)
  const first = jsonLines(await head(path, HEAD_BYTES))
  let cwd = ''
  let id = ''
  let branch: string | null = null
  let ask: string | null = null
  for (const l of first) {
    if (typeof l.cwd === 'string' && !cwd) cwd = l.cwd
    if (typeof l.sessionId === 'string' && !id) id = l.sessionId
    if (typeof l.gitBranch === 'string' && l.gitBranch && !branch) branch = l.gitBranch
    const msg = l.message as { content?: unknown } | undefined
    if (!ask && l.type === 'user' && !l.isMeta && msg) {
      const t = textOf(msg.content)
      if (typed(t)) ask = t
    }
  }
  if (!cwd) return null
  let last: string | null = null
  const end = st.size > HEAD_BYTES ? jsonLines(await tail(path, TAIL_BYTES)) : first
  for (let i = end.length - 1; i >= 0 && !last; i--) {
    const l = end[i]
    const msg = l.message as { content?: unknown } | undefined
    if (l.type === 'assistant' && msg) last = textOf(msg.content) || null
  }
  return { agentKind: 'claude', id: id || (path.split(/[\\/]/).pop() ?? '').replace(/\.jsonl$/, ''), path, cwd, at: st.mtimeMs, first: short(ask), last: short(last), branch }
}

/** A Codex rollout: its session id and folder (session_meta), first prompt and last answer. */
export async function readCodexSession(path: string): Promise<OutsideSession | null> {
  const st = await fs.stat(path)
  const first = jsonLines(await head(path, HEAD_BYTES))
  let cwd = ''
  let id = ''
  let branch: string | null = null
  let ask: string | null = null
  const messageOf = (l: Record<string, unknown>): { role?: string; content?: unknown } | null => {
    const p = (l.payload ?? l) as { type?: string; role?: string; content?: unknown }
    return p.type === 'message' ? p : null
  }
  for (const l of first) {
    const p = l.payload as { id?: string; cwd?: string; git?: { branch?: string } } | undefined
    if (l.type === 'session_meta' && p) {
      cwd ||= p.cwd ?? ''
      id ||= p.id ?? ''
      branch ||= p.git?.branch ?? null
    }
    const m = messageOf(l)
    if (!ask && m?.role === 'user') {
      const t = textOf(m.content)
      if (typed(t)) ask = t
    }
  }
  if (!cwd || !id) return null
  let last: string | null = null
  const end = st.size > HEAD_BYTES ? jsonLines(await tail(path, TAIL_BYTES)) : first
  for (let i = end.length - 1; i >= 0 && !last; i--) {
    const m = messageOf(end[i])
    if (m?.role === 'assistant') last = textOf(m.content) || null
  }
  return { agentKind: 'codex', id, path, cwd, at: st.mtimeMs, first: short(ask), last: short(last), branch }
}

export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

/** Recent Claude Code conversations in these folders (matched by Claude's folder name, then by the cwd inside). */
async function claudeSessions(folders: string[], since: number): Promise<OutsideSession[]> {
  const root = join(claudeHome(), 'projects')
  let dirs: string[]
  try {
    dirs = await fs.readdir(root)
  } catch {
    return []
  }
  // Claude Code names the folder after the path it was started in, which may be spelled
  // differently from git's (macOS's /var for /private/var, a Windows short name): matched by
  // its last two folders, then each conversation's own cwd decides (as real folders).
  const ends = folders.flatMap((f) => [f, realFolder(f)]).map((f) => claudeProjectDir(f.split(/[\\/]+/).filter(Boolean).slice(-2).join('/')).toLowerCase())
  const out: OutsideSession[] = []
  for (const d of dirs) {
    if (!ends.some((e) => d.toLowerCase().endsWith(e))) continue
    const files = (await fs.readdir(join(root, d)).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl'))
    for (const f of files) {
      const p = join(root, d, f)
      try {
        if ((await fs.stat(p)).mtimeMs < since) continue
        const s = await readClaudeSession(p)
        if (s && folders.some((x) => samePath(x, s.cwd))) out.push(s)
      } catch {
        // unreadable - skip it
      }
    }
  }
  return out
}

/** Recent Codex conversations in these folders (its rollouts are filed by day). */
async function codexSessions(folders: string[], since: number): Promise<OutsideSession[]> {
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return []
  const out: OutsideSession[] = []
  for (let t = Date.now(); t >= since - DAY; t -= DAY) {
    const d = new Date(t)
    const dir = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl'))
    for (const f of files) {
      try {
        const s = await readCodexSession(join(dir, f))
        if (s && s.at >= since && folders.some((x) => samePath(x, s.cwd))) out.push(s)
      } catch {
        // unreadable - skip it
      }
    }
  }
  return out
}

/** Folders and branches tasks already hold (a done task holds nothing). */
function held(tasks: Task[]): { paths: string[]; branches: Set<string>; sessions: Set<string> } {
  const open = tasks.filter((t) => t.col !== 'done')
  return {
    paths: open.flatMap((t) => [t.worktreePath, t.taskDir].filter((p): p is string => !!p)),
    branches: new Set(open.flatMap((t) => (t.branch ? [t.projectId, ...(t.repos ?? [])].map((p) => `${p}|${t.branch}`) : []))),
    sessions: new Set(tasks.flatMap((t) => [t.session?.id, t.outside?.startsWith('cs:') ? t.outside.slice(3) : null]).filter((s): s is string => !!s))
  }
}

const inside = isInside

/** One project's outside work. */
async function scanProject(project: Project, tasks: Task[]): Promise<OutsideItem[]> {
  if (!project.repoPath || !existsSync(project.repoPath)) return []
  const base = project.defaultBranch ?? 'main'
  const h = held(tasks)
  const items: OutsideItem[] = []
  const worktrees = await listWorktrees(project.repoPath).catch(() => [])
  const main = worktrees.find((w) => w.isMain)
  const loose = worktrees.filter((w) => !w.isMain && !w.prunable && existsSync(w.path) && !h.paths.some((p) => inside(w.path, p)) && !(w.branch && h.branches.has(`${project.id}|${w.branch}`)))

  const since = Date.now() - SESSION_DAYS * DAY
  const folders = [project.repoPath, ...(main ? [main.path] : []), ...loose.map((w) => w.path)]
  const sessions = [...(await claudeSessions(folders, since)), ...(await codexSessions(folders, since))].filter((s) => !h.sessions.has(s.id)).sort((a, b) => b.at - a.at)

  for (const w of loose) {
    const status = await getWorktreeStatus(w.path, base).catch(() => ({ ahead: 0, behind: 0, dirty: 0, lastCommitAt: 0 }))
    const subject = (await git(w.path, ['log', '-1', '--format=%s']).catch(() => '')).trim()
    const own = sessions.filter((s) => samePath(s.cwd, w.path))
    items.push({
      id: `wt:${w.path}`,
      kind: 'worktree',
      projectId: project.id,
      branch: w.branch || undefined,
      path: w.path,
      ahead: status.ahead,
      dirty: status.dirty,
      lastCommitAt: status.lastCommitAt,
      subject,
      sessions: own,
      at: Math.max(status.lastCommitAt || 0, own[0]?.at ?? 0)
    })
  }

  // Branches with commits of their own that nothing has out.
  const out = new Set(worktrees.map((w) => w.branch).filter(Boolean))
  const refs = await git(project.repoPath, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%09%(committerdate:unix)%09%(subject)', 'refs/heads']).catch(() => '')
  let branches = 0
  for (const line of refs.split('\n')) {
    const [name, when, ...rest] = line.split('\t')
    if (!name || name === base || out.has(name) || h.branches.has(`${project.id}|${name}`)) continue
    const at = Number(when) * 1000
    if (at < Date.now() - BRANCH_DAYS * DAY || branches >= 15) break
    const ahead = Number((await git(project.repoPath, ['rev-list', '--count', `${base}..${name}`]).catch(() => '0')).trim()) || 0
    if (!ahead) continue
    branches++
    items.push({ id: `br:${project.id}:${name}`, kind: 'branch', projectId: project.id, branch: name, ahead, lastCommitAt: at, subject: rest.join('\t'), sessions: [], at })
  }

  // Conversations in the main checkout.
  for (const s of sessions.filter((x) => samePath(x.cwd, project.repoPath) || (main && samePath(x.cwd, main.path))).slice(0, 8)) {
    items.push({ id: `cs:${s.id}`, kind: 'session', projectId: project.id, branch: s.branch ?? undefined, sessions: [s], at: s.at })
  }
  return items
}

/** Outside work in a project (or in all of them), newest first. */
export async function scan(projectId?: string): Promise<OutsideItem[]> {
  const tasks = getTasks()
  const projects = getProjects().filter((p) => !projectId || p.id === projectId)
  const all: OutsideItem[] = []
  for (const p of projects) all.push(...(await scanProject(p, tasks).catch(() => [])))
  return all.sort((a, b) => b.at - a.at)
}
