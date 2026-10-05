import { BrowserWindow } from 'electron'
import { statSync } from 'fs'
import { isAbsolute, join } from 'path'
import { gitAt, gitYes } from './gitEnv'
import { listWorktrees } from './git'
import { getPrefs, getProjects } from './store'
import { log } from './log'
import { IPC } from '@shared/ipc'
import type { BaseStatus } from '@shared/types'

/**
 * Keeping each project's base branch (main) current: origin is fetched in
 * the background, so the board can say "main is 3 behind origin", and Pull
 * brings the local branch up to date - a fast-forward only, never a merge,
 * in the checkout that has it out or (out nowhere) by moving the branch.
 * New tasks branch from the local base, so this is what keeps them from
 * starting on old code.
 */

const statuses = new Map<string, BaseStatus>()
let timer: NodeJS.Timeout | null = null

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.baseChanged, [...statuses.values()])
}

async function hasOrigin(repoPath: string): Promise<boolean> {
  return (await gitAt(repoPath).getRemotes().catch(() => [])).some((r) => r.name === 'origin')
}

/** When origin was last fetched (FETCH_HEAD's time), 0 if never. */
async function fetchedAt(repoPath: string): Promise<number> {
  try {
    const common = (await gitAt(repoPath).revparse(['--git-common-dir'])).trim()
    return statSync(join(isAbsolute(common) ? common : join(repoPath, common), 'FETCH_HEAD')).mtimeMs
  } catch {
    return 0
  }
}

/** How the project's base branch stands against origin (no network). */
export async function statusOf(projectId: string): Promise<BaseStatus | null> {
  const p = getProjects().find((x) => x.id === projectId)
  if (!p?.repoPath) return null
  const base = p.defaultBranch ?? 'main'
  const st: BaseStatus = { projectId, base, hasRemote: false, behind: 0, ahead: 0, fetchedAt: 0, checkedOutAt: null, error: statuses.get(projectId)?.error ?? null }
  try {
    st.hasRemote = await hasOrigin(p.repoPath)
    st.checkedOutAt = (await listWorktrees(p.repoPath)).find((w) => w.branch === base)?.path ?? null
    if (st.hasRemote) {
      st.fetchedAt = await fetchedAt(p.repoPath)
      const counts = await gitAt(p.repoPath)
        .raw(['rev-list', '--left-right', '--count', `refs/heads/${base}...refs/remotes/origin/${base}`])
        .catch(() => '')
      const [ahead, behind] = counts.trim().split(/\s+/).map(Number)
      st.ahead = ahead || 0
      st.behind = behind || 0
    }
  } catch (err) {
    log.warn('base', `Could not read ${p.name}'s ${base}`, err)
  }
  statuses.set(projectId, st)
  return st
}

/** Fetches origin for one project (or all) and says how their base branches stand. */
export async function fetchNow(projectId?: string): Promise<BaseStatus[]> {
  const projects = getProjects().filter((p) => p.repoPath && (!projectId || p.id === projectId))
  await Promise.all(
    projects.map(async (p) => {
      if (!(await hasOrigin(p.repoPath))) return
      try {
        await gitAt(p.repoPath, { network: true }).fetch(['origin', '--prune', '--progress'])
        const was = statuses.get(p.id)
        if (was) was.error = null
      } catch (err) {
        log.warn('base', `Fetching ${p.name} failed`, err)
        const msg = String((err as Error).message ?? err).trim().split('\n').pop() ?? 'fetch failed'
        statuses.set(p.id, { ...(statuses.get(p.id) ?? { projectId: p.id, base: p.defaultBranch ?? 'main', hasRemote: true, behind: 0, ahead: 0, fetchedAt: 0, checkedOutAt: null }), error: msg })
      }
      await statusOf(p.id)
      if (getPrefs().autoPullBase) await pull(p.id, true).catch(() => {})
    })
  )
  broadcast()
  return projects.map((p) => statuses.get(p.id)).filter((s): s is BaseStatus => !!s)
}

/**
 * Brings the local base branch up to origin's - fast-forward only. Out in a
 * checkout: there, and only when that checkout is clean. Out nowhere: the
 * branch is moved. A base with commits origin doesn't have is left alone.
 */
export async function pull(projectId: string, quiet = false): Promise<BaseStatus | null> {
  const p = getProjects().find((x) => x.id === projectId)
  if (!p) throw new Error('No such project')
  const st = await statusOf(projectId)
  if (!st?.hasRemote) throw new Error(`${p.name} has no origin remote.`)
  if (!st.behind) return st
  if (st.ahead) throw new Error(`${st.base} has ${st.ahead} commit${st.ahead > 1 ? 's' : ''} origin doesn't - pull it yourself (it needs a merge or rebase).`)
  const target = `refs/remotes/origin/${st.base}`
  if (st.checkedOutAt) {
    const holder = gitAt(st.checkedOutAt)
    const dirty = (await holder.status()).files.length
    if (dirty) {
      if (quiet) return st
      throw new Error(`${st.checkedOutAt} has ${dirty} uncommitted change${dirty > 1 ? 's' : ''} - commit or stash them, then pull.`)
    }
    await holder.raw(['merge', '--ff-only', target])
  } else {
    const git = gitAt(p.repoPath)
    const [local, remote] = await Promise.all([git.revparse([`refs/heads/${st.base}`]), git.revparse([target])])
    if (!(await gitYes(p.repoPath, ['merge-base', '--is-ancestor', local.trim(), remote.trim()]))) throw new Error(`${st.base} and origin/${st.base} have gone different ways - pull it yourself.`)
    await git.raw(['update-ref', '-m', 'switchyard: pull', `refs/heads/${st.base}`, remote.trim(), local.trim()])
  }
  log.info('base', `Pulled ${p.name}'s ${st.base} (${st.behind} commit${st.behind > 1 ? 's' : ''})`)
  const now = await statusOf(projectId)
  broadcast()
  return now
}

export function list(): BaseStatus[] {
  return [...statuses.values()]
}

/** Fetches a minute after start, then every `fetchMinutes` (Settings → Git; 0: never). */
export function start(): void {
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    const minutes = getPrefs().fetchMinutes
    if (!minutes) return
    timer = setTimeout(() => {
      fetchNow()
        .catch((err) => log.warn('base', 'Background fetch failed', err))
        .finally(schedule)
    }, minutes * 60_000)
  }
  setTimeout(() => {
    Promise.all(getProjects().map((p) => statusOf(p.id)))
      .then(broadcast)
      .then(() => (getPrefs().fetchMinutes ? fetchNow() : undefined))
      .catch((err) => log.warn('base', 'First fetch failed', err))
      .finally(schedule)
  }, 20_000)
}
