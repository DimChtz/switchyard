import { useCallback, useEffect, useState } from 'react'
import { nextTaskKey } from './derive'
import { errText } from './errors'
import type { Action } from '../store/types'
import type { AgentKind, BoardColumn, OutsideItem, OutsideSession, Project, Task } from '@shared/types'

/**
 * Bringing in work done outside Switchyard (see main's outside service): a
 * worktree or branch becomes a task holding it - its agent's conversation
 * resumed from where it was - and a conversation in the main checkout
 * becomes a task to start.
 */

type Dispatch = (action: Action) => void

// Items put aside with "Hide" (this computer only).
const HIDDEN = 'switchyard.outsideHidden'
function hiddenIds(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HIDDEN) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function hideOutside(id: string): void {
  try {
    localStorage.setItem(HIDDEN, JSON.stringify([...hiddenIds().filter((x) => x !== id), id].slice(-500)))
  } catch {
    // not kept
  }
}
export function unhideAll(): void {
  try {
    localStorage.removeItem(HIDDEN)
  } catch {
    // nothing kept
  }
}

// Scans, by project, for a minute.
const cache = new Map<string, { at: number; items: OutsideItem[] }>()
const listeners = new Set<() => void>()
export function rescanOutside(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
  listeners.forEach((l) => l())
}

/** The project's outside work (hidden items left out, unless `all`); null while it's looked for. */
export function useOutside(projectId: string | null | undefined, opts: { all?: boolean; tasks: Task[] }): { items: OutsideItem[] | null; hidden: number; refresh: () => void } {
  const [items, setItems] = useState<OutsideItem[] | null>(projectId ? (cache.get(projectId)?.items ?? null) : null)
  const [round, setRound] = useState(0)
  const refresh = useCallback(() => {
    if (projectId) cache.delete(projectId)
    setRound((r) => r + 1)
  }, [projectId])
  useEffect(() => {
    const l = (): void => setRound((r) => r + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  useEffect(() => {
    if (!projectId) return setItems(null)
    const hit = cache.get(projectId)
    if (hit && Date.now() - hit.at < 60_000) return setItems(hit.items)
    let live = true
    window.api
      .outside(projectId)
      .then((found) => {
        cache.set(projectId, { at: Date.now(), items: found })
        if (live) setItems(found)
      })
      .catch(() => live && setItems([]))
    return () => {
      live = false
    }
  }, [projectId, round, opts.tasks.length])
  const hidden = new Set(hiddenIds())
  const free = items ? items.filter((i) => !holder(i, opts.tasks)) : null
  const shown = free && !opts.all ? free.filter((i) => !hidden.has(i.id)) : free
  return { items: shown, hidden: free ? free.filter((i) => hidden.has(i.id)).length : 0, refresh }
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The task already holding the item (one brought in a moment ago, before the scan knows). */
export function holder(item: OutsideItem, tasks: Task[]): Task | undefined {
  return tasks.find(
    (t) =>
      t.outside === item.id ||
      (t.col !== 'done' &&
        ((item.path && t.worktreePath && norm(t.worktreePath) === norm(item.path)) ||
          (item.kind === 'branch' && t.branch === item.branch && (t.projectId === item.projectId || t.repos?.includes(item.projectId))) ||
          (!!t.session?.id && item.sessions.some((s) => s.id === t.session!.id) && item.kind !== 'branch')))
  )
}

/** "feature/add-login" → "Add login". */
export function titleFromBranch(branch: string): string {
  const last = branch.split('/').pop() ?? branch
  const words = last.replace(/^[A-Z]+-\d+[-_]?/, '').replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : branch
}

function firstLine(text: string, max = 80): string {
  const t = text.split(/(?<=[.?!])\s|\n/)[0].trim()
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t
}

/** Its newest conversation. */
export function sessionOf(item: OutsideItem): OutsideSession | undefined {
  return item.sessions[0]
}

/** A title for the task: what its agent was asked, else its last commit, else its branch. */
export function suggestTitle(item: OutsideItem): string {
  const s = sessionOf(item)
  if (item.kind === 'session' && s?.first) return firstLine(s.first)
  if (item.subject && item.kind === 'branch') return firstLine(item.subject)
  if (s?.first) return firstLine(s.first)
  if (item.branch) return titleFromBranch(item.branch)
  return item.subject ? firstLine(item.subject) : 'Untitled work'
}

/** Its agent: the one whose conversation it has, else the project's default. */
export function suggestAgent(item: OutsideItem, fallback: AgentKind): AgentKind {
  return sessionOf(item)?.agentKind ?? fallback
}

/** Where it goes on the board: committed work with nothing left over is ready to look at. */
export function suggestColumn(item: OutsideItem): BoardColumn {
  if (item.kind === 'session') return 'backlog'
  return item.ahead && !item.dirty && !item.sessions.length ? 'review' : 'progress'
}

/** The conversation as a description, for a task that starts over from it. */
export function sessionBrief(s: OutsideSession): string {
  const who = s.agentKind === 'codex' ? 'Codex' : 'Claude Code'
  const when = new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  return [`From a ${who} conversation in the main checkout (${when}${s.branch ? `, on ${s.branch}` : ''}).`, s.first ? `\n**Asked:** ${s.first}` : '', s.last ? `\n**Its last answer:** ${s.last}` : ''].join('\n').trim()
}

/**
 * Brings the item in as a task. A branch first gets a worktree (and the
 * project's copied files); a worktree is taken as it is. Resolves the new
 * task, or null (with a toast) when it couldn't.
 */
export async function bringIn(
  item: OutsideItem,
  opts: { title: string; agentKind: AgentKind; col: BoardColumn },
  ctx: { project: Project; tasks: Task[]; dispatch: Dispatch }
): Promise<Task | null> {
  const { project, dispatch } = ctx
  const already = holder(item, ctx.tasks)
  if (already) {
    dispatch({ type: 'TOAST', text: `${already.key} already holds it.` })
    return null
  }
  const key = nextTaskKey(ctx.tasks, project)
  const now = Date.now()
  const s = sessionOf(item)
  const title = opts.title.trim() || suggestTitle(item)
  const base: Task = {
    id: key,
    key,
    projectId: project.id,
    title,
    outside: item.id,
    col: opts.col,
    agentKind: null,
    st: null,
    worktreeId: null,
    worktreePath: null,
    branch: null,
    ask: null,
    doneNote: null,
    firstMessage: null,
    createdAt: now,
    startedAt: null,
    lastActivityAt: now
  }
  try {
    if (item.kind === 'session') {
      const task: Task = { ...base, desc: s ? sessionBrief(s) : undefined, col: opts.col === 'ready' ? 'ready' : 'backlog', agentKind: opts.agentKind }
      dispatch({ type: 'ADD_TASK', task })
      dispatch({ type: 'TOAST', text: `${key} added from the conversation - start it when you're ready.` })
      return task
    }
    let path = item.path ?? null
    const branch = item.branch ?? null
    if (!branch) throw new Error('It has no branch (a detached checkout) - check out a branch in it first.')
    if (item.kind === 'branch') {
      path = await window.api.git.suggestWorktreePath(project.repoPath, branch)
      await window.api.git.addWorktree(project.repoPath, path, branch)
      if (project.copyFiles?.length) await window.api.git.copyIntoWorktree(project.repoPath, path, project.copyFiles).catch(() => [])
    }
    const col = opts.col === 'review' ? 'review' : 'progress'
    // Its conversation, to resume exactly it (the agent's own resume otherwise).
    const session = s && s.agentKind === opts.agentKind ? { id: s.id, transcript: s.path } : null
    const task: Task = {
      ...base,
      col,
      desc: s?.first ?? undefined,
      agentKind: opts.agentKind,
      st: col === 'review' ? 'done' : 'paused',
      worktreePath: path,
      branch,
      startedAt: item.lastCommitAt || s?.at || now,
      session
    }
    dispatch({ type: 'ADD_TASK', task })
    dispatch({ type: 'TOAST', text: `${key} holds ${branch} now${session ? ` - Resume picks up its ${s!.agentKind === 'codex' ? 'Codex' : 'Claude Code'} conversation` : ''}.`, tone: 'done' })
    return task
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not bring it in: ${errText(err)}` })
    return null
  } finally {
    rescanOutside(project.id)
  }
}
