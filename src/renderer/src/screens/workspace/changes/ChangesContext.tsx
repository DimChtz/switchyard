import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { agentShort } from '../../../lib/derive'
import { errText } from '../../../lib/errors'
import { commitMessageFor, pushTask } from '../../../lib/taskActions'
import { hunkAt, hunkLabel } from '../../../lib/diffView'
import { commentMessage, followUpMessage, inOrder, nextRefs, reviewMessage } from '../../../lib/review'
import { confirm } from '../../../components/ui'
import { checkoutsOf, splitRepoPath } from '../../../lib/multiRepo'
import { baseOf } from '../../../lib/stack'
import type { DiffScope, FileDiff, Project, ReviewComment, Task } from '@shared/types'

/** Each task's scope while the app runs (the Changes view comes and goes with the side bar). */
const scopes = new Map<string, DiffScope>()

export interface Commit {
  hash: string
  message: string
  date: string
}

export interface ChangesApi {
  task: Task
  base: string
  /** The task's folder (files' paths are from here). */
  root: string
  /** What the files are compared with: the base, origin's copy of the branch, or the last commit. */
  scope: DiffScope
  setScope: (s: DiffScope) => void
  /** The scope in a few words ("vs main", "not pushed yet"…). */
  scopeNote: string
  /** The changed files in the scope (null while they're read). */
  files: FileDiff[] | null
  /** Them in the order the Changes list shows them: folder by folder, the top folder's first. */
  ordered: FileDiff[]
  refresh: () => void
  viewed: Record<string, boolean>
  toggleViewed: (path: string) => void
  comments: ReviewComment[]
  addComment: (c: ReviewComment, sendNow: boolean) => Promise<void>
  patchComment: (id: string, patch: Partial<ReviewComment>) => void
  removeComment: (id: string) => void
  replyTo: (c: ReviewComment, text: string) => void
  resolveAll: (path: string) => void
  openSent: (path: string) => number
  /** The review: comments not sent yet, its overall note. */
  pending: ReviewComment[]
  summary: string
  setSummary: (s: string) => void
  sendReview: () => void
  discardReview: () => void
  commitMsg: string
  setCommitMsg: (s: string) => void
  committing: boolean
  commit: (push?: boolean) => void
  /** Uncommitted files left out of the next commit (all of them go in otherwise). */
  excluded: Set<string>
  toggleExcluded: (path: string) => void
  discard: (path: string) => void
  /** The file back to how it is where the diff starts (its changes undone, uncommitted). */
  revertFile: (f: FileDiff) => void
  /** One hunk of a file undone in the worktree. `at`: its "@@" line. */
  revertHunk: (f: FileDiff, at: number) => void
  /** An image's old or new side, as a data URL (null when that side has none). */
  image: (f: FileDiff, side: 'old' | 'new') => Promise<string | null>
  /** Whitespace-only changes left out (then hunks can't be reverted: they aren't what's in the file). */
  ignoreSpace: boolean
  /** The branch's own commits, newest first. */
  commits: Commit[]
  /** The agent's name, or "the agent". */
  agent: string
}

const Ctx = createContext<ChangesApi | null>(null)

/** The changes, when the task has a worktree (null when it hasn't). */
export function useChangesMaybe(): ChangesApi | null {
  return useContext(Ctx)
}

export function useChanges(): ChangesApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useChanges outside ChangesProvider')
  return c
}

/** The task's changes: its files' diffs against the base, viewed marks, review comments, commits. */
export function ChangesProvider({ task, project, root, children }: { task: Task; project: Project; root: string; children: React.ReactNode }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  // Each repository's worktree; in a task folder, a file's path starts with its repository's folder.
  const checkouts = checkoutsOf(task, state.projects).filter((c) => c.path)
  const checkoutsKey = checkouts.map((c) => c.path).join('|')
  const inRepo = (path: string): { path: string; rel: string } | null => {
    const hit = splitRepoPath(task, state.projects, path)
    return hit?.checkout.path ? { path: hit.checkout.path, rel: hit.rel } : null
  }
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [viewed, setViewed] = useState<Record<string, boolean>>({})
  const [comments, setComments] = useState<ReviewComment[]>([])
  const [summary, setSummary] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commits, setCommits] = useState<Commit[]>([])
  const base = baseOf(task, project)
  const [scope, setScopeState] = useState<DiffScope>(() => scopes.get(task.id) ?? 'branch')
  const setScope = (s: DiffScope): void => {
    scopes.set(task.id, s)
    setScopeState(s)
  }
  useEffect(() => setScopeState(scopes.get(task.id) ?? 'branch'), [task.id])
  const scopeNote =
    typeof scope === 'object' ? `in ${scope.commit.slice(0, 7)}` : scope === 'uncommitted' ? 'not committed yet' : scope === 'unpushed' ? 'not pushed yet' : `vs ${base}`
  const ignoreSpace = !!state.prefs.diffIgnoreSpace
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const viewedKeys = useRef(new Map<string, string>())

  const refresh = (): void => {
    // (A commit is the home repository's: the others have nothing in it.)
    const from = typeof scope === 'object' ? checkouts.slice(0, 1) : checkouts
    Promise.all(
      from.map((c) =>
        window.api.git
          .diffFiles(c.path!, baseOf(task, c.project), scope, { ignoreSpace })
          .then((list) => (c.dir ? list.map((d) => ({ ...d, path: `${c.dir}/${d.path}` })) : list))
          .catch(() => [] as FileDiff[])
      )
    ).then(async (lists) => {
      const f = lists.flat()
      setFiles(f)
      // Viewed holds only while the file's changes are what you looked at (as on GitHub).
      const marks = await window.api.store.getViewedFiles(task.id)
      const now = new Map(f.map((d) => [d.path, diffSignature(d)]))
      setViewed(Object.fromEntries(marks.map((k) => splitMark(k)).filter(([p, sig]) => now.get(p) === sig).map(([p]) => [p, true])))
      viewedKeys.current = new Map(marks.map((k) => [splitMark(k)[0], k]))
    })
    window.api.store.getComments().then((all) => setComments(all.filter((c) => c.taskId === task.id)))
    // The branch's own commits (the home repository's).
    const home = checkouts[0]
    if (home?.path)
      window.api.git
        .worktreeStatus(home.path, baseOf(task, home.project))
        .then((s) => (s.ahead ? window.api.git.log(home.path!, Math.min(s.ahead, 50)) : []))
        .then(setCommits)
        .catch(() => setCommits([]))
  }

  // Live: the agent's edits and commits show up as they happen.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.fs.watch(root, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => refreshRef.current(), 700)
    })
    // A commit in a worktree changes nothing under it - its turn ending says so.
    const offTurn = window.api.checkpoints.onChanged((id) => id === task.id && refreshRef.current())
    return () => {
      off()
      offTurn()
      if (timer) clearTimeout(timer)
    }
  }, [root, task.id])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, checkoutsKey, base, task.id, typeof scope === 'object' ? scope.commit : scope, ignoreSpace])

  // The agent answered comments: their threads have it.
  useEffect(
    () =>
      window.api.store.onCommentsChanged((ch) => {
        if (ch.taskId === task.id) window.api.store.getComments().then((all) => setComments(all.filter((c) => c.taskId === task.id)))
      }),
    [task.id]
  )

  const toggleViewed = (path: string): void => {
    const next = !viewed[path]
    setViewed((v) => ({ ...v, [path]: next }))
    const was = viewedKeys.current.get(path)
    if (was) window.api.store.setFileViewed(task.id, was, false)
    const file = (files ?? []).find((f) => f.path === path)
    if (next && file) {
      const key = `${path}\u0000${diffSignature(file)}`
      viewedKeys.current.set(path, key)
      window.api.store.setFileViewed(task.id, key, true)
    } else viewedKeys.current.delete(path)
  }

  const uncommitted = (files ?? []).filter((f) => f.uncommitted)
  const toggleExcluded = (path: string): void =>
    setExcluded((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const commit = async (push = false): Promise<void> => {
    const picked = uncommitted.filter((f) => !excluded.has(f.path))
    if (committing || picked.length === 0) return
    setCommitting(true)
    try {
      const message = commitMessageFor(task)
      // Each repository with uncommitted changes gets the commit: all of them, or just the picked files.
      const repos = new Map<string, string[]>()
      for (const f of picked) {
        const r = inRepo(f.path)
        if (!r) continue
        repos.set(r.path, [...(repos.get(r.path) ?? []), r.rel, ...(f.oldPath ? [inRepo(f.oldPath)?.rel ?? f.oldPath] : [])])
      }
      const all = picked.length === uncommitted.length
      const shas: string[] = []
      for (const [path, rels] of repos) shas.push(all ? await window.api.git.commitAll(path, commitMsg.trim() || message) : await window.api.git.commitFiles(path, rels, commitMsg.trim() || message))
      setCommitMsg('')
      setExcluded(new Set())
      dispatch({
        type: 'TOAST',
        text: `Committed ${picked.length} file${picked.length > 1 ? 's' : ''} · ${shas.map((s) => s.slice(0, 7)).join(', ')}${repos.size > 1 ? ` (${repos.size} repos)` : ''}`
      })
      if (push) await pushTask(task, dispatch, false, state.projects)
      refresh()
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not commit: ${errText(err)}` })
    } finally {
      setCommitting(false)
    }
  }

  const revertFile = async (f: FileDiff): Promise<void> => {
    const r = inRepo(f.path)
    if (!r) return
    const name = f.path.split('/').pop()
    const since = typeof scope === 'object' ? `before ${scope.commit.slice(0, 7)}` : scope === 'branch' ? `on ${base}` : scope === 'unpushed' ? 'on origin' : 'in the last commit'
    const ok = await confirm({
      title: `Undo the changes to ${name}?`,
      body:
        f.status === 'added'
          ? `It's new, so it's deleted. ${f.uncommitted ? 'Its uncommitted changes can’t be brought back.' : 'Committed work stays in the history; the deletion is a change to commit.'}`
          : `It goes back to how it is ${since}. ${f.uncommitted ? 'Its uncommitted changes can’t be brought back.' : 'Committed work stays in the history; the undo is a change to commit.'}`,
      detail: f.path,
      confirmLabel: 'Undo changes',
      danger: true
    })
    if (!ok) return
    try {
      const c = checkouts.find((x) => x.path === r.path)
      await window.api.git.revertFile(r.path, baseOf(task, c?.project ?? project), scope, r.rel, f.oldPath ? (inRepo(f.oldPath)?.rel ?? undefined) : undefined)
      dispatch({ type: 'TOAST', text: `Undid the changes to ${name}.` })
      refresh()
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not undo: ${errText(err)}` })
    }
  }

  const revertHunk = async (f: FileDiff, at: number): Promise<void> => {
    const r = inRepo(f.path)
    if (!r) return
    try {
      await window.api.git.revertHunk(r.path, r.rel, hunkAt(f.lines, at), f.oldPath ? (inRepo(f.oldPath)?.rel ?? undefined) : undefined)
      dispatch({ type: 'TOAST', text: `Undid ${hunkLabel(f.lines[at].text).where} of ${f.path.split('/').pop()}.` })
      refresh()
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not undo the change: ${errText(err)}` })
    }
  }

  const image = (f: FileDiff, side: 'old' | 'new'): Promise<string | null> => {
    const r = inRepo(f.path)
    if (!r) return Promise.resolve(null)
    const c = checkouts.find((x) => x.path === r.path)
    return window.api.git.diffImage(r.path, baseOf(task, c?.project ?? project), scope, r.rel, side, f.oldPath ? (inRepo(f.oldPath)?.rel ?? undefined) : undefined).catch(() => null)
  }

  const discard = async (path: string): Promise<void> => {
    const ok = await confirm({
      title: `Discard the changes to ${path.split('/').pop()}?`,
      body: 'Its uncommitted changes are thrown away; a new file is deleted. This can’t be undone.',
      detail: path,
      confirmLabel: 'Discard changes',
      danger: true
    })
    if (!ok) return
    try {
      const r = inRepo(path)
      if (!r) throw new Error('not in one of the task’s repositories')
      await window.api.git.discardFile(r.path, r.rel)
      dispatch({ type: 'TOAST', text: `Discarded changes to ${path}` })
      refresh()
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not discard: ${errText(err)}` })
    }
  }

  const agent = agentShort(task.agentKind) || 'the agent'

  /** A comment on the diff: into the review (sent with it), or to the agent now. */
  const addComment = (comment: ReviewComment, sendNow: boolean): Promise<void> => {
    const c = sendNow ? { ...comment, ref: nextRefs(comments, 1)[0] } : comment
    return window.api.store.addComment(c).then(() => {
      setComments((cs) => [...cs, c])
      if (sendNow) dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: commentMessage(c), toast: `Comment sent to ${agent}.` })
    })
  }

  const pending = comments.filter((c) => c.pending)
  /** The pending comments and the overall note, as one message. */
  const sendReview = (): void => {
    // Numbered in the order the message lists them, after the ones sent before.
    const refs = nextRefs(comments, pending.length)
    const numbered = inOrder(pending).map((c, i) => ({ ...c, ref: refs[i] }))
    const text = reviewMessage(numbered, summary)
    if (!text) return
    const now = Date.now()
    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text, toast: `Review sent to ${agent}${pending.length ? ` - ${pending.length} comment${pending.length === 1 ? '' : 's'}` : ''}.` })
    const patches = numbered.map((c) => ({ id: c.id, patch: { pending: false, sentAt: now, ref: c.ref, awaiting: true } }))
    const by = new Map(patches.map((p) => [p.id, p.patch]))
    window.api.store.updateComments(patches)
    setComments((cs) => cs.map((c) => (by.has(c.id) ? { ...c, ...by.get(c.id) } : c)))
    setSummary('')
  }
  const discardReview = async (): Promise<void> => {
    const ok = await confirm({
      title: `Discard the review's ${pending.length} comment${pending.length === 1 ? '' : 's'}?`,
      body: 'They haven’t been sent; they’re deleted.',
      confirmLabel: 'Discard',
      danger: true
    })
    if (!ok) return
    for (const c of pending) window.api.store.deleteComment(c.id)
    setComments((cs) => cs.filter((c) => !c.pending))
    setSummary('')
  }

  /** Changes a comment (its text while it's in the review; resolved or not once sent). */
  const patchComment = (id: string, patch: Partial<ReviewComment>): void => {
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    window.api.store.updateComments([{ id, patch }]).catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not save the comment: ${errText(err)}` }))
  }
  /** A follow-up on a sent comment, to the agent - it answers in the thread. */
  const replyTo = (c: ReviewComment, text: string): void => {
    const ref = c.ref ?? nextRefs(comments, 1)[0]
    patchComment(c.id, { ref, awaiting: true, thread: [...(c.thread ?? []), { from: 'you', text, at: Date.now() }] })
    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: followUpMessage({ ...c, ref }, text), toast: `Sent to ${agent}.` })
  }
  /** Every sent comment on the file still open: resolved. */
  const resolveAll = (path: string): void => {
    const open = comments.filter((c) => c.path === path && !c.pending && !c.resolved)
    if (!open.length) return
    const ids = new Set(open.map((c) => c.id))
    setComments((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, resolved: true } : c)))
    window.api.store.updateComments(open.map((c) => ({ id: c.id, patch: { resolved: true } }))).catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not save the comments: ${errText(err)}` }))
  }
  const removeComment = (id: string): void => {
    window.api.store.deleteComment(id)
    setComments((c) => c.filter((x) => x.id !== id))
  }

  const api: ChangesApi = {
    task,
    base,
    root,
    scope,
    setScope,
    scopeNote,
    files,
    ordered: inListOrder(files ?? []),
    refresh,
    viewed,
    toggleViewed,
    comments,
    addComment,
    patchComment,
    removeComment,
    replyTo,
    resolveAll,
    openSent: (path) => comments.filter((c) => c.path === path && !c.pending && !c.resolved).length,
    pending,
    summary,
    setSummary,
    sendReview,
    discardReview,
    commitMsg,
    setCommitMsg,
    committing,
    commit,
    excluded,
    toggleExcluded,
    discard,
    revertFile,
    revertHunk,
    image,
    ignoreSpace,
    commits,
    agent
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/** Files folder by folder (the top folder's first), by name within each. */
export function inListOrder(files: FileDiff[]): FileDiff[] {
  const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  return [...files].sort((a, b) => {
    const da = dirOf(a.path)
    const db = dirOf(b.path)
    if (da !== db) return !da ? -1 : !db ? 1 : da.localeCompare(db)
    return a.path.localeCompare(b.path)
  })
}

/** What a file's changes are, in short: a Viewed mark holds while this stays the same. */
function diffSignature(f: FileDiff): string {
  let h = 5381
  for (const l of f.lines) {
    const s = l.kind + l.text
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `${f.status}:${f.added}:${f.deleted}:${(h >>> 0).toString(36)}`
}

/** A stored Viewed mark: "path\0signature" (older marks: just the path). */
function splitMark(k: string): [string, string] {
  const i = k.indexOf('\u0000')
  return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)]
}
