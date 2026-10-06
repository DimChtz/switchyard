import { BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { gitArgs, gitEnv } from './gitEnv'
import { promises as fs, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { randomBytes } from 'crypto'
import { getCheckpoints, setCheckpoints } from './store'
import * as activity from './activity'
import { usageBetween } from './transcript'
import { diffFilesBetween } from './git'
import { IPC } from '@shared/ipc'
import type { Checkpoint, CheckpointSnap, FileDiff, RewindResult } from '@shared/types'

/**
 * Checkpoints: the task's files as they were when its agent's session
 * started and after each of its turns. Each is a commit made with a
 * throwaway index (so the branch, the real index and the files are left
 * alone) and kept by a ref, refs/switchyard/cp/<task>/<id>. Rewinding
 * writes a checkpoint's files back into the worktree - after saving what's
 * there, so a rewind can be undone the same way.
 */

const execFileP = promisify(execFile)
const KEEP = 200
const IDENTITY = { GIT_AUTHOR_NAME: 'Switchyard', GIT_AUTHOR_EMAIL: 'checkpoints@switchyard.local', GIT_COMMITTER_NAME: 'Switchyard', GIT_COMMITTER_EMAIL: 'checkpoints@switchyard.local' }

async function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(args), { cwd, env: gitEnv(env), windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

function changed(taskId: string): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.checkpointsChanged, taskId)
}

/** The task's checkouts under the folder its agent runs in: the folder itself, or (a multi-repo task) the worktrees inside it. */
export function checkoutsIn(root: string): { dir: string; path: string }[] {
  if (existsSync(join(root, '.git'))) return [{ dir: '', path: root }]
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(root, d.name, '.git')))
      .map((d) => ({ dir: d.name, path: join(root, d.name) }))
  } catch {
    return []
  }
}

/** Snapshots one checkout: its files (tracked and new, not ignored) as a commit on top of HEAD, kept by `ref`. */
async function snapshot(path: string, ref: string, message: string): Promise<Omit<CheckpointSnap, 'dir'>> {
  const snap = await snapshotCommit(path, message)
  await git(path, ['update-ref', ref, snap.sha])
  return snap
}

/**
 * A checkout's files as a commit on top of HEAD (made with a throwaway
 * index; the branch, index and files are left alone). Unreferenced: keep it
 * with a ref, or use it and let git clean it up.
 */
export async function snapshotCommit(path: string, message: string): Promise<Omit<CheckpointSnap, 'dir'>> {
  const head = (await git(path, ['rev-parse', 'HEAD'])).trim()
  const gitDir = resolve(path, (await git(path, ['rev-parse', '--git-common-dir'])).trim())
  const index = resolve(path, (await git(path, ['rev-parse', '--git-path', 'index'])).trim())
  // A copy of the real index: it knows which files haven't changed, so this is quick.
  const tmp = join(tmpdir(), `switchyard-index-${randomBytes(6).toString('hex')}`)
  const env = { GIT_INDEX_FILE: tmp }
  try {
    try {
      await fs.copyFile(index, tmp)
      // With the index's own time: git compares it with each file's to catch a file
      // edited in the same second the index was written ("racily clean" - same size,
      // same time, new content). A copy dated now would hide such an edit.
      const { atime, mtime } = await fs.stat(index)
      await fs.utimes(tmp, atime, mtime)
    } catch {
      await git(path, ['read-tree', 'HEAD'], env)
    }
    await git(path, ['add', '-A', '--', '.'], env)
    const tree = (await git(path, ['write-tree'], env)).trim()
    const sha = (await git(path, ['commit-tree', tree, '-p', head, '-m', message], IDENTITY)).trim()
    return { path, gitDir, sha, head }
  } finally {
    fs.rm(tmp, { force: true }).catch(() => {})
  }
}

/** What changed from one snapshot to the next, per file (paths inside the task: a multi-repo task's start with the repository's folder). */
async function filesBetween(from: CheckpointSnap[], to: CheckpointSnap[]): Promise<Checkpoint['files']> {
  const out: Checkpoint['files'] = []
  for (const s of to) {
    const before = from.find((f) => f.dir === s.dir)?.sha ?? s.head
    if (before === s.sha) continue
    const [numstat, names] = await Promise.all([
      git(s.path, ['diff', '--no-renames', '--numstat', before, s.sha]),
      git(s.path, ['diff', '--no-renames', '--name-status', before, s.sha])
    ])
    const status = new Map(
      names
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [st, p] = l.split('\t')
          return [p, st === 'A' ? 'added' : st === 'D' ? 'deleted' : 'modified'] as const
        })
    )
    for (const l of numstat.split('\n').filter(Boolean)) {
      const [a, d, p] = l.split('\t')
      out.push({ path: s.dir ? `${s.dir}/${p}` : p, status: status.get(p) ?? 'modified', added: Number(a) || 0, deleted: Number(d) || 0 })
    }
  }
  return out
}

// One at a time per task: turns end, sessions start and rewinds happen in order.
const queues = new Map<string, Promise<unknown>>()
function inTurn<T>(taskId: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(taskId) ?? Promise.resolve()).catch(() => {}).then(work)
  queues.set(taskId, next)
  return next
}

let onTurnEnd: ((taskId: string) => void) | null = null
/** Something else to do when an agent finishes a turn (the conflict radar looks again). */
export function whenTurnEnds(fn: (taskId: string) => void): void {
  onTurnEnd = fn
}

// Where each task's agent runs (from its session), and what it was last asked.
const roots = new Map<string, string>()
const prompts = new Map<string, string>()

export function list(taskId: string): Checkpoint[] {
  return getCheckpoints().filter((c) => c.taskId === taskId)
}

/**
 * The checkpoint whose files a checkpoint left behind: a rewind's are the
 * ones it went back to (a rewind's own snapshot is what it found - so
 * rewinding to a rewind undoes it).
 */
function stateOwner(c: Checkpoint, all: Checkpoint[]): Checkpoint {
  return (c.kind === 'rewind' && all.find((x) => x.id === c.rewoundTo)) || c
}

function stateAfter(c: Checkpoint, all: Checkpoint[]): CheckpointSnap[] {
  return stateOwner(c, all).snaps
}

async function record(taskId: string, root: string, fields: Pick<Checkpoint, 'kind' | 'prompt' | 'said'> & { rewoundTo?: string | null; skipIfSame?: boolean }): Promise<Checkpoint | null> {
  const checkouts = checkoutsIn(root)
  if (!checkouts.length) return null
  const mine = list(taskId)
  const last = mine[mine.length - 1]
  const id = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const label = fields.kind === 'turn' ? `turn ${(mine.filter((c) => c.kind === 'turn').length || 0) + 1}` : fields.kind
  const snaps: CheckpointSnap[] = []
  for (const c of checkouts) {
    try {
      snaps.push({ dir: c.dir, ...(await snapshot(c.path, `refs/switchyard/cp/${taskId}/${id}`, `Switchyard checkpoint: ${taskId} ${label}`)) })
    } catch {
      // not a repository with a commit yet - nothing to keep for it
    }
  }
  if (!snaps.length) return null
  const files = last ? await filesBetween(stateAfter(last, mine), snaps) : []
  // Nothing changed and nothing was said: not worth a checkpoint.
  if (fields.skipIfSame && last && !files.length && !fields.prompt && !fields.said) {
    await dropRefs(snaps.map((s) => ({ ...s, ref: `refs/switchyard/cp/${taskId}/${id}` })))
    return null
  }
  const cp: Checkpoint = {
    id,
    taskId,
    at: Date.now(),
    kind: fields.kind,
    turn: fields.kind === 'turn' ? mine.filter((c) => c.kind === 'turn').length + 1 : null,
    rewoundTo: fields.rewoundTo ?? null,
    snaps,
    prompt: fields.prompt ?? null,
    said: fields.said ?? null,
    files: fields.kind === 'start' && !last ? [] : files,
    tokens: null
  }
  // The oldest go once there are too many (their refs too).
  const all = [...getCheckpoints(), cp]
  const extra = all.filter((c) => c.taskId === taskId).length - KEEP
  const dropped = extra > 0 ? all.filter((c) => c.taskId === taskId).slice(0, extra) : []
  setCheckpoints(all.filter((c) => !dropped.includes(c)))
  if (dropped.length) forgetCheckpoints(dropped).catch(() => {})
  changed(taskId)
  return cp
}

/** An agent session started in `cwd`: its files as they are, to go back to. */
export function sessionStarted(taskId: string, cwd: string): void {
  roots.set(taskId, cwd)
  inTurn(taskId, () => record(taskId, cwd, { kind: 'start', prompt: null, said: null, skipIfSame: true })).catch(() => {})
}

/** What the agent was asked (Claude Code's prompt hook, or a message the app sent). */
export function promptSent(taskId: string, prompt: string): void {
  if (prompt.trim()) prompts.set(taskId, prompt.trim())
}

function logTurn(taskId: string, files: Checkpoint['files'], said: string | null): void {
  try {
    activity.turn(taskId, files, said)
  } catch {
    // the turn stands without its log entry
  }
}

/**
 * The agent finished a turn: its files now, what it was asked and said,
 * and (from its transcript, once it's written) the tokens the turn took.
 */
export function turnEnded(taskId: string, info: { said: string | null; lastSent: string | null; transcript?: string | null }): void {
  onTurnEnd?.(taskId)
  const root = roots.get(taskId)
  if (!root) return info.said ? logTurn(taskId, [], info.said) : undefined
  const prompt = prompts.get(taskId) ?? info.lastSent
  prompts.delete(taskId)
  inTurn(taskId, async () => {
    const before = list(taskId).at(-1)?.at ?? 0
    const cp = await record(taskId, root, { kind: 'turn', prompt, said: info.said, skipIfSame: true })
    // For the daily summary: a turn that changed files, or that the agent reported (its last words) -
    // not a terminal that only went quiet with nothing changed (a start-up, a repaint).
    if (cp || info.said) logTurn(taskId, cp?.files ?? [], info.said)
    if (!cp || !info.transcript) return
    const transcript = info.transcript
    // The transcript gets the turn's last lines a moment later.
    setTimeout(async () => {
      try {
        const tokens = await usageBetween(transcript, before, cp.at + 1500)
        if (!Object.keys(tokens).length) return
        setCheckpoints(getCheckpoints().map((c) => (c.id === cp.id ? { ...c, tokens } : c)))
        changed(taskId)
      } catch {
        // no transcript
      }
    }, 2000)
  }).catch(() => {})
}

/** The changes a checkpoint made (from the one before it, or `from`), per file. */
export async function diff(taskId: string, id: string, fromId?: string): Promise<FileDiff[]> {
  const mine = list(taskId)
  const i = mine.findIndex((c) => c.id === id)
  if (i < 0) throw new Error('That checkpoint is gone.')
  // A rewind: what it changed - from the files it found to the ones it went back to.
  if (!fromId && mine[i].kind === 'rewind' && mine[i].rewoundTo) return diff(taskId, stateOwner(mine[i], mine).id, mine[i].id)
  const from = fromId ? mine.find((c) => c.id === fromId) : mine[i - 1]
  const fromSnaps = !from ? [] : fromId ? from.snaps : stateAfter(from, mine)
  const out: FileDiff[] = []
  for (const s of mine[i].snaps) {
    const before = fromSnaps.find((f) => f.dir === s.dir)?.sha ?? s.head
    for (const f of await diffFilesBetween(s.gitDir, before, s.sha)) out.push({ ...f, path: s.dir ? `${s.dir}/${f.path}` : f.path })
  }
  return out
}

/**
 * Puts the task's files back as they were at checkpoint `id`: files made
 * since are removed, changed ones restored. What's there first is saved as
 * a 'rewind' checkpoint (rewinding to that undoes this). Commits made since
 * stay on the branch.
 */
export function rewind(taskId: string, id: string): Promise<RewindResult> {
  return inTurn(taskId, async () => {
    const picked = list(taskId).find((c) => c.id === id)
    if (!picked) throw new Error('That checkpoint is gone.')
    // (Rewinding to a rewind goes back to the files it found: it undoes it.)
    const target = picked
    const root = roots.get(taskId) ?? commonRoot(target)
    if (!root) throw new Error('The task’s worktree isn’t there.')
    const saved = await record(taskId, root, { kind: 'rewind', prompt: null, said: null, rewoundTo: id })
    if (!saved) throw new Error('Could not save the files as they are - nothing was changed.')
    let restored = 0
    let removed = 0
    const headMoved: string[] = []
    for (const t of target.snaps) {
      const now = saved.snaps.find((s) => s.dir === t.dir)
      if (!now) continue
      const lines = (await git(now.path, ['diff', '--no-renames', '--name-status', now.sha, t.sha])).split('\n').filter(Boolean)
      const gone: string[] = []
      const back: string[] = []
      for (const l of lines) {
        const [st, p] = l.split('\t')
        if (st === 'D') gone.push(p)
        else back.push(p)
      }
      for (const p of gone) await fs.rm(join(now.path, p), { force: true })
      for (let i = 0; i < back.length; i += 100) await git(now.path, ['restore', `--source=${t.sha}`, '--worktree', '--', ...back.slice(i, i + 100)])
      restored += back.length
      removed += gone.length
      if (now.head !== t.head) headMoved.push(t.dir || basename(now.path))
    }
    // Its row says what the rewind changed.
    const files = await filesBetween(saved.snaps, target.snaps)
    setCheckpoints(getCheckpoints().map((c) => (c.id === saved.id ? { ...c, files } : c)))
    changed(taskId)
    return { checkpoint: { ...saved, files }, restored, removed, headMoved }
  })
}

/** A checkpoint's task folder, when no session has said where it is (after a restart). */
function commonRoot(c: Checkpoint): string | null {
  const s = c.snaps[0]
  if (!s || !existsSync(s.path)) return null
  return s.dir ? resolve(s.path, '..') : s.path
}

async function dropRefs(refs: { gitDir: string; ref: string }[]): Promise<void> {
  for (const r of refs) await execFileP('git', gitArgs(['--git-dir', r.gitDir, 'update-ref', '-d', r.ref]), { windowsHide: true, env: gitEnv() }).catch(() => {})
}

async function forgetCheckpoints(cps: Checkpoint[]): Promise<void> {
  await dropRefs(cps.flatMap((c) => c.snaps.map((s) => ({ gitDir: s.gitDir, ref: `refs/switchyard/cp/${c.taskId}/${c.id}` }))))
}

/** A finished or deleted task's checkpoints go, refs and all. */
export function forget(taskIds: string[]): void {
  const ids = new Set(taskIds)
  const all = getCheckpoints()
  const gone = all.filter((c) => ids.has(c.taskId))
  if (!gone.length) return
  setCheckpoints(all.filter((c) => !ids.has(c.taskId)))
  for (const id of ids) roots.delete(id)
  forgetCheckpoints(gone).catch(() => {})
}
