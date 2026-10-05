import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { clock, statusColor, statusLabel, timeAgo, wakeAt } from '../lib/status'
import { checksMessage, prSummary, reviewMessage } from '@shared/pr'
import { agentShort } from '../lib/derive'
import { WorkspaceBench } from './workspace/WorkspaceBench'
import { Button, IconButton, Menu, confirm, type MenuAnchor } from '../components/ui'
import { taskMenuItems } from '../lib/menus'
import { attachRepo, commitMessageFor, finishGone, finishWithPr, freshPr, mergeTask, openPullRequest, pushTask, recreateWorktree, reviewReady, taskDirty } from '../lib/taskActions'
import { checkoutsOf, repoDir, reposOf } from '../lib/multiRepo'
import { useHover } from '../lib/useHover'
import type { Project, PullRequest, RemoteInfo, Task } from '@shared/types'
import { prefsFor } from '../lib/projectPrefs'
import { ConflictsLine } from '../components/Conflicts'
import { AlertAction, AlertLine } from '../components/AlertLine'
import { conflictsOf, useConflicts } from '../lib/conflicts'
import { baseOf } from '../lib/stack'
import { liveParent } from '@shared/stack'
import { errText } from '../lib/errors'
import { COLUMN_LABEL } from '@shared/constants'
import { LayoutButtons } from './workspace/layout/LayoutButtons'

export function Workspace(): React.JSX.Element | null {
  const { state } = useAppStore()
  const task = state.tasks.find((t) => t.id === state.taskId)
  if (!task) return null
  const project = state.projects.find((p) => p.id === task.projectId)!
  return <WorkspaceBody key={task.id} task={task} project={project} />
}

function WorkspaceBody({ task, project }: { task: Task; project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [unpushed, setUnpushed] = useState(0)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  // Repositories: the task's (home first), and the ones it can take in too.
  const [repoMenu, setRepoMenu] = useState<MenuAnchor | null>(null)
  const repoProjects = reposOf(task)
    .map((id) => state.projects.find((p) => p.id === id))
    .filter((p): p is Project => !!p)
  const attachable = state.projects.filter((p) => p.repoPath && !repoProjects.some((r) => r.id === p.id))
  const [renaming, setRenaming] = useState<string | null>(null)
  const base = baseOf(task, project)
  const hasWorktree = !!(task.worktreePath && task.branch)

  useEffect(() => {
    window.api.git.remoteInfo(project.repoPath).then(setRemote)
  }, [project.repoPath])

  // The open pull request's state (merged or closed on GitHub) and what
  // hasn't been pushed to it yet.
  useEffect(() => {
    if (!task.pr || !task.worktreePath || !task.branch) return
    let cancelled = false
    const check = async (): Promise<void> => {
      const [pr, n] = await Promise.all([
        window.api.git.prStatus(task.worktreePath!, task.pr!.url),
        window.api.git.unpushed(task.worktreePath!, task.branch!, base)
      ])
      if (cancelled) return
      setUnpushed(n)
      if (pr && pr.state !== task.pr!.state) dispatch({ type: 'SET_TASK_PR', taskId: task.id, pr: { url: pr.url, number: pr.number, state: pr.state } })
    }
    check()
    const t = setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.pr?.url, task.pr?.state, task.worktreePath, task.branch, task.lastActivityAt, busy, base])

  // The other repositories' pull requests: merged or closed on GitHub too.
  const repoPrKey = Object.entries(task.repoPrs ?? {})
    .map(([id, p]) => `${id}:${p.url}:${p.state}`)
    .join('|')
  useEffect(() => {
    const prs = Object.entries(task.repoPrs ?? {})
    if (!prs.length) return
    let cancelled = false
    const check = async (): Promise<void> => {
      for (const [repoId, pr] of prs) {
        const c = checkoutsOf(task, state.projects).find((x) => x.project.id === repoId)
        if (!c?.path) continue
        const now = await window.api.git.prStatus(c.path, pr.url).catch(() => null)
        if (!cancelled && now && now.state !== pr.state) dispatch({ type: 'SET_TASK_REPO_PR', taskId: task.id, repoId, pr: { url: now.url, number: now.number, state: now.state } })
      }
    }
    check()
    const t = setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPrKey, task.lastActivityAt])

  const run = useCallback(
    async (action: 'merge' | 'pr' | 'push'): Promise<void> => {
      if (busy || !task.worktreePath) return
      // Only commits get merged, pushed or put in a pull request - leftover
      // changes are committed first, once that's been confirmed.
      const dirty = await taskDirty(task, state.projects)
      const commitFirst = dirty > 0
      if (commitFirst) {
        const what = action === 'merge' ? `merged into ${base}` : action === 'pr' ? 'pushed and put in a pull request' : 'pushed'
        const ok = await confirm({
          title: `Commit ${dirty} change${dirty > 1 ? 's' : ''} first?`,
          body: `Only commits are ${what}. The uncommitted changes are committed as “${commitMessageFor(task)}”.`,
          confirmLabel: action === 'merge' ? 'Commit & merge' : action === 'pr' ? 'Commit & open PR' : 'Commit & push'
        })
        if (!ok) return
      }
      setBusy(action)
      try {
        if (action === 'merge') await mergeTask(task, project, prefsFor(state, project.id), dispatch, commitFirst, state.projects)
        else if (action === 'pr') await openPullRequest(task, project, dispatch, commitFirst, state.projects)
        else await pushTask(task, dispatch, commitFirst, state.projects)
      } finally {
        setBusy(null)
      }
    },
    [busy, task, project, state, dispatch, base]
  )

  const primary = useCallback((): void => {
    // Its pull request was merged on GitHub (in Review or still In Progress): it closes out.
    if (hasWorktree && task.pr?.state === 'MERGED' && (task.col === 'progress' || task.col === 'review')) {
      setBusy('finish')
      finishWithPr(task, project, dispatch, state.projects).finally(() => setBusy(null))
      return
    }
    if (task.col === 'progress') {
      reviewReady(task).then((ok) => ok && dispatch({ type: 'PRIMARY_ACTION', taskId: task.id }))
      return
    }
    if (task.col === 'review') {
      if (!hasWorktree) return dispatch({ type: 'TOAST', text: 'This task has no worktree to merge.' })
      if (!task.pr) {
        run('merge')
        return
      }
      // Merged on GitHub since the last look: no merging here as well.
      const go = async (): Promise<void> => {
        setBusy('finish')
        const pr = await freshPr(task, dispatch)
        if (pr?.state === 'MERGED') await finishWithPr({ ...task, pr }, project, dispatch, state.projects)
        setBusy(null)
        if (pr?.state !== 'MERGED') await run('merge')
      }
      go().catch(() => setBusy(null))
      return
    }
    if (task.col === 'backlog' || task.col === 'ready') dispatch({ type: 'PRIMARY_ACTION', taskId: task.id })
  }, [task, project, dispatch, hasWorktree, run, state.projects])

  // ⇧⌘R Move to Review, ⇧⌘M Merge & finish - as the button hints say.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || state.start || state.palette || state.filePreview) return
      const k = e.key.toLowerCase()
      // (Not once its PR is merged: the button finishes the task then, and these keys don't say that.)
      if (task.pr?.state !== 'MERGED' && ((k === 'r' && task.col === 'progress') || (k === 'm' && task.col === 'review'))) {
        e.preventDefault()
        primary()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [primary, task.col, task.pr?.state, state.start, state.palette, state.filePreview])

  const merged = task.pr?.state === 'MERGED'
  const primaryLabel =
    busy === 'merge'
        ? 'Merging…'
        : busy === 'finish'
          ? 'Finishing…'
          : merged && hasWorktree && (task.col === 'progress' || task.col === 'review')
            ? 'Finish · PR merged'
            : task.col === 'progress'
              ? 'Move to Review'
              : task.col === 'review'
                ? 'Merge & finish'
                : task.col === 'done'
                  ? null
                  : 'Start with agent'
  const primaryKey = busy || merged ? undefined : task.col === 'progress' ? '⇧⌘R' : task.col === 'review' ? '⇧⌘M' : undefined

  // Pull request: for a pushed-able task branch on a remote.
  const canPr = !!remote && hasWorktree && (task.col === 'review' || task.col === 'progress')
  const prLabel = busy === 'pr' ? 'Opening PR…' : 'Open PR'
  const pushLabel = busy === 'push' ? 'Pushing…' : `Push ${unpushed}`

  const menuItems = taskMenuItems(task, project, prefsFor(state, task.projectId), dispatch, {
    projects: state.projects,
    inWorkspace: true,
    rename: () => setRenaming(task.title),
    editDesc: () => dispatch({ type: 'OPEN_TASK_SHEET', taskId: task.id })
  })

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Zen mode keeps only the editor groups. */}
      <div style={{ height: 48, flex: 'none', display: state.zen ? 'none' : 'flex', alignItems: 'center', gap: 10, padding: '0 20px', borderBottom: '1px solid var(--bd-1)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '0 1 auto', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ fontSize: 13, color: 'var(--t3)', flex: 'none' }}>{repoProjects.map((p) => p.name).join(' + ')}</span>
          <span style={{ color: 'var(--bd-5)', flex: 'none' }}>/</span>
          <span style={{ fontSize: 13, color: 'var(--t3)', flex: 'none' }}>{COLUMN_LABEL[task.col]}</span>
          <span style={{ color: 'var(--bd-5)', flex: 'none' }}>/</span>
          {renaming !== null ? (
            <RenameInput
              value={renaming}
              onChange={setRenaming}
              onDone={(save) => {
                if (save) dispatch({ type: 'RENAME_TASK', taskId: task.id, title: renaming })
                setRenaming(null)
              }}
            />
          ) : (
            <span
              onDoubleClick={() => setRenaming(task.title)}
              title={`${task.title} - double-click to rename`}
              style={{ font: '500 13px var(--font-ui)', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 40, flex: '0 1 auto' }}
            >
              {task.title}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6, flex: 'none' }}>
          {repoProjects.length > 1
            ? repoProjects.map((p) => (
                <span
                  key={p.id}
                  title={p.id === project.id ? `${p.name} · home repo` : `${p.name} · attached - same branch, ./${repoDir(p)} in the task folder`}
                  style={{ height: 20, padding: '0 7px', borderRadius: 4, display: 'flex', alignItems: 'center', font: '11.5px var(--font-mono)', color: 'var(--t2)', background: 'var(--bg-panel)', border: '1px solid var(--bd-3)', boxSizing: 'border-box', whiteSpace: 'nowrap' }}
                >
                  {p.name}
                </span>
              ))
            : null}
          {attachable.length ? (
            <DashedChip
              title="Attach another repo to this task"
              onClick={(e) => {
                const el = e.currentTarget
                setRepoMenu((m) => (m ? null : { el }))
              }}
            >
              + repo
            </DashedChip>
          ) : null}
          <IconButton
            title="Task actions"
            onClick={(e) => {
              const el = e.currentTarget
              setMenu((m) => (m ? null : { el }))
            }}
          >
            ⋯
          </IconButton>
        </div>
        <div style={{ flex: 1, minWidth: 8 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', minWidth: 0, flex: '0 100 auto', overflow: 'hidden' }}>
          {task.branch ? (
            <span title={task.branch} style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ⎇ {task.branch}
            </span>
          ) : null}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: task.agentKind ? statusColor(task.st) : 'var(--t3)', flex: 'none' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: task.agentKind ? statusColor(task.st) : 'var(--t4)' }} />
            {task.agentKind ? `${agentShort(task.agentKind)} · ${statusLabel(task) || 'stopped'}` : 'No agent'}
          </span>
        </span>
        <LayoutButtons task={task} />
        {task.st === 'working' ? (
          <Button onClick={() => dispatch({ type: 'PAUSE_TASK', taskId: task.id })}>Pause agent</Button>
        ) : task.st === 'paused' ? (
          <Button onClick={() => dispatch({ type: 'RESUME_TASK', taskId: task.id })}>Resume agent</Button>
        ) : null}
        {task.pr ? (
          <>
            <Button onClick={() => window.api.sys.openExternal(task.pr!.url)} title={task.pr.url}>
              PR {task.pr.number ? `#${task.pr.number}` : ''}
              <span style={{ font: '11px var(--font-mono)', color: prColor(task.pr.state) }}>{(task.pr.state ?? 'open').toLowerCase()} ↗</span>
            </Button>
            {Object.entries(task.repoPrs ?? {}).map(([repoId, pr]) => (
              <Button key={repoId} onClick={() => window.api.sys.openExternal(pr.url)} title={pr.url}>
                {state.projects.find((p) => p.id === repoId)?.name ?? repoId} {pr.number ? `#${pr.number}` : ''}
                <span style={{ font: '11px var(--font-mono)', color: prColor(pr.state) }}>{(pr.state ?? 'open').toLowerCase()} ↗</span>
              </Button>
            ))}
            {task.pr.state === 'OPEN' && unpushed > 0 ? <Button onClick={() => run('push')}>{pushLabel}</Button> : null}
          </>
        ) : canPr && remote?.github ? (
          <Button onClick={() => run('pr')} title={`Push ${task.branch} and open a pull request into ${base}`}>
            {prLabel}
          </Button>
        ) : canPr ? (
          <Button onClick={() => run('push')} title={`Push ${task.branch} to origin`}>
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </Button>
        ) : null}
        {primaryLabel ? (
          <Button variant="primary" hint={primaryKey} disabled={!!busy} onClick={primary}>
            {primaryLabel}
          </Button>
        ) : null}
      </div>

      {state.zen ? null : <TaskAlerts task={task} />}

      <WorkspaceBench task={task} project={project} />
      {menu ? <Menu anchor={menu} items={menuItems} onClose={() => setMenu(null)} /> : null}
      {repoMenu ? (
        <Menu
          anchor={repoMenu}
          width={340}
          intro={
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)' }}>Attach a repo to {task.key}</span>
              <span>
                {task.branch
                  ? `Adds ${task.branch} in that repo as a worktree next to this one, in the task's folder. ${task.agentKind ? agentShort(task.agentKind) : 'The agent'} sees it as a sibling folder in the same session; the card shows on both boards.`
                  : 'It gets a worktree on the same branch when the task starts, and the card shows on both boards.'}
              </span>
            </span>
          }
          items={attachable.map((p) => ({ label: p.name, sub: [p.lang, p.defaultBranch].filter(Boolean).join(' · '), onClick: () => attachRepo(task, p, state.projects, prefsFor(state, task.projectId), dispatch) }))}
          onClose={() => setRepoMenu(null)}
        />
      ) : null}
    </div>
  )
}

/** The dashed "+ repo" chip. */
function DashedChip({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent<HTMLSpanElement>) => void; children: React.ReactNode }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      onClick={onClick}
      title={title}
      {...hoverProps}
      style={{
        height: 20,
        padding: '0 7px',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        font: '11.5px var(--font-ui)',
        color: hover ? 'var(--t1)' : 'var(--t3)',
        border: `1px dashed ${hover ? 'var(--bd-6)' : 'var(--bd-4)'}`,
        boxSizing: 'border-box',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  )
}

function prColor(state: PullRequest['state']): string {
  return state === 'MERGED' ? 'var(--c-green)' : state === 'CLOSED' ? 'var(--c-red)' : 'var(--c-blue)'
}

export function RenameInput({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: (save: boolean) => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onDone(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(true)
        if (e.key === 'Escape') onDone(false)
      }}
      style={{
        font: '500 13px var(--font-ui)',
        color: 'var(--t1)',
        background: 'var(--bg-panel-3)',
        border: '1px solid color-mix(in srgb, var(--c-blue) 60%, transparent)',
        borderRadius: 4,
        padding: '3px 6px',
        outline: 'none',
        minWidth: 240
      }}
    />
  )
}

/**
 * What needs attention about the task, under its header - one line each,
 * with what to do about it: clashing with another task, asleep at a usage
 * limit. Nothing to say: no strip.
 */
function TaskAlerts({ task }: { task: Task }): React.JSX.Element | null {
  const { dispatch } = useAppStore()
  const conflicts = conflictsOf(useConflicts(), task.id)
  const lines: React.ReactNode[] = []
  const [gone, recheckGone] = useWorktreeGone(task)
  if (gone) lines.push(<GoneLine key="gone" task={task} onRecreated={recheckGone} />)
  if (conflicts.length) lines.push(<ConflictsLine key="conflicts" task={task} />)
  if (task.sleeping) {
    const s = task.sleeping
    lines.push(
      <AlertLine key="limit" color="var(--c-blue)" icon="◷" title={s.reason}>
        Usage limit · {s.until ? `sleeps until ${clock(s.until)}` : `tries again at ${clock(wakeAt(s))}`}
        <AlertAction onClick={() => dispatch({ type: 'WAKE_TASK', taskId: task.id })}>wake now</AlertAction>
        <AlertAction onClick={() => dispatch({ type: 'CANCEL_SLEEP', taskId: task.id })}>don’t wake</AlertAction>
      </AlertLine>
    )
  }
  const [behind, recheck] = useParentAhead(task)
  if (behind) lines.push(<StackLine key="stack" task={task} behind={behind} onUpdated={recheck} />)
  if (task.pr && task.pr.state !== 'MERGED' && task.pr.state !== 'CLOSED') lines.push(<PrLine key="pr" task={task} />)
  if (!lines.length) return null
  return <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-panel)' }}>{lines}</div>
}

/** The task's worktree folder was deleted outside Switchyard (checked on opening, and when the window comes back to front). */
function useWorktreeGone(task: Task): [boolean, () => void] {
  const [gone, setGone] = useState(false)
  const [n, setN] = useState(0)
  const path = task.worktreePath
  useEffect(() => {
    setGone(false)
    if (!path || task.col === 'done') return
    let cancelled = false
    const check = (): void => {
      window.api.git
        .isCheckout(path)
        .then((ok) => !cancelled && setGone(!ok))
        .catch(() => {})
    }
    check()
    window.addEventListener('focus', check)
    return () => {
      cancelled = true
      window.removeEventListener('focus', check)
    }
  }, [path, task.col, n])
  return [gone, () => setN((x) => x + 1)]
}

/** No worktree any more: its work can't go on here - finish the task, or check the branch out again. */
function GoneLine({ task, onRecreated }: { task: Task; onRecreated: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [busy, setBusy] = useState(false)
  const project = state.projects.find((p) => p.id === task.projectId)
  const act = (work: (p: Project) => Promise<boolean>): void => {
    if (busy || !project) return
    setBusy(true)
    work(project).finally(() => setBusy(false))
  }
  return (
    <AlertLine color="var(--c-red)" icon="⚠" title={task.worktreePath ?? undefined}>
      This task&apos;s worktree folder isn&apos;t there any more{task.pr?.state === 'MERGED' ? ` · PR #${task.pr.number ?? ''} is merged` : ''}
      <AlertAction onClick={() => act((p) => finishGone(task, p, dispatch, state.projects))}>{busy ? 'working…' : 'finish task'}</AlertAction>
      {task.pr?.state === 'MERGED' ? null : <AlertAction onClick={() => act((p) => recreateWorktree(task, p, dispatch).then((ok) => (ok && onRecreated(), ok)))}>recreate worktree</AlertAction>}
    </AlertLine>
  )
}

// When each task's review comments last went to its agent (this run): only newer ones go next time.
const reviewSent = new Map<string, number>()

/**
 * The pull request loop: its CI checks and reviews as GitHub has them
 * (read every two minutes, and when the workspace opens) - and failing
 * checks or review comments go to the agent with one click.
 */
function PrLine({ task }: { task: Task }): React.JSX.Element | null {
  const { dispatch } = useAppStore()
  const [loading, setLoading] = useState(false)
  const d = task.prDetails
  const refresh = useCallback((): void => {
    if (!task.pr || !task.worktreePath) return
    setLoading(true)
    window.api.git
      .prDetails(task.worktreePath, task.pr.url)
      .then((details) => details && dispatch({ type: 'SET_PR_DETAILS', taskId: task.id, details }))
      .finally(() => setLoading(false))
  }, [task.pr, task.worktreePath, task.id, dispatch])
  useEffect(refresh, [task.pr?.url]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null
  const sum = prSummary(d)
  const color = sum.tone === 'fail' ? 'var(--c-red)' : sum.tone === 'pending' ? 'var(--c-amber)' : sum.tone === 'pass' ? 'var(--c-green)' : 'var(--t3)'
  const checks = checksMessage(d)
  const since = reviewSent.get(task.id) ?? 0
  const review = reviewMessage(d, since)
  const fresh = d.comments.filter((c) => c.at > since).length
  const agent = agentShort(task.agentKind) || 'the agent'
  return (
    <AlertLine color={color} icon="⇅" title={`Pull request #${d.number} - checked ${timeAgo(d.at)}`}>
      PR #{d.number} · {sum.text}
      {d.comments.length ? ` · ${d.comments.length} comment${d.comments.length > 1 ? 's' : ''}` : ''}
      {checks && task.agentKind ? (
        <AlertAction onClick={() => dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: checks, toast: `Sent the failing checks to ${agent}.` })}>send failures to {agent}</AlertAction>
      ) : null}
      {review && task.agentKind ? (
        <AlertAction
          onClick={() => {
            reviewSent.set(task.id, Math.max(...d.comments.map((c) => c.at)))
            dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text: review, toast: `Sent ${fresh} review comment${fresh === 1 ? '' : 's'} to ${agent}.` })
          }}
        >
          send {fresh} comment{fresh === 1 ? '' : 's'} to {agent}
        </AlertAction>
      ) : null}
      <AlertAction onClick={() => window.api.sys.openExternal(`${d.url}/checks`)}>checks ↗</AlertAction>
      <AlertAction onClick={() => !loading && refresh()}>{loading ? 'checking…' : 'refresh'}</AlertAction>
    </AlertLine>
  )
}

/** How many commits the task it builds on has that its branch hasn't (checked now and then). */
function useParentAhead(task: Task): [number, () => void] {
  const { state } = useAppStore()
  const project = state.projects.find((p) => p.id === task.projectId)
  const parent = project ? liveParent(task, project.id, state.tasks) : undefined
  const [n, setN] = useState(0)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!parent?.branch || !task.worktreePath || !project) return setN(0)
    let live = true
    const check = (): void => {
      window.api.git
        .worktreeStatus(task.worktreePath!, parent.branch!)
        .then((s) => live && setN(s.behind))
        .catch(() => live && setN(0))
    }
    check()
    const t = setInterval(check, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [task.worktreePath, task.lastActivityAt, parent?.branch, parent?.lastActivityAt, project, round])
  return [n, () => setRound((r) => r + 1)]
}

/**
 * The task it builds on has moved on: bring its commits in (rebase or
 * merge, per Settings) - or ask the agent to, when it's working or they
 * clash.
 */
function StackLine({ task, behind, onUpdated }: { task: Task; behind: number; onUpdated: () => void }): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const [busy, setBusy] = useState(false)
  const [clash, setClash] = useState<string[] | null>(null)
  const project = state.projects.find((p) => p.id === task.projectId)
  const parent = project ? liveParent(task, project.id, state.tasks) : undefined
  if (!parent?.branch || !project || !task.worktreePath) return null
  const agent = agentShort(task.agentKind) || 'the agent'
  const merge = prefsFor(state, project.id).syncMode === 'merge'
  const how = merge ? `merge ${parent.branch} into your branch` : `rebase your branch onto ${parent.branch}`
  const running = task.st === 'working' || task.st === 'waiting'
  const ask = (): void =>
    dispatch({
      type: 'MESSAGE_AGENT',
      taskId: task.id,
      text: `${parent.key} (branch ${parent.branch}), which this task builds on, has ${behind} new commit${behind === 1 ? '' : 's'}. Please ${how}${clash?.length ? `, resolve the conflicts in ${clash.join(', ')}` : ' and resolve any conflicts'}, and commit.`,
      toast: `Asked ${agent} to bring in ${parent.key}'s commits.`
    })
  const update = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.git.rebase(task.worktreePath!, parent.branch!)
      setClash(null)
      const done = `${merge ? 'Merged' : 'Rebased onto'} ${parent.key}'s latest - ${behind} commit${behind === 1 ? '' : 's'}`
      // Files may have changed under the agent: it's told.
      if (running)
        dispatch({
          type: 'MESSAGE_AGENT',
          taskId: task.id,
          text: `I brought ${parent.key}'s ${behind} new commit${behind === 1 ? '' : 's'} into your branch (${merge ? 'merged' : 'rebased'}). Re-read the files you're working on before you change them.`,
          toast: `${done}; told ${agent}.`
        })
      else dispatch({ type: 'TOAST', text: `${done}.` })
      onUpdated()
    } catch (err) {
      const msg = errText(err)
      if (msg.startsWith('CONFLICT:')) setClash(msg.slice('CONFLICT:'.length).split('\n').filter(Boolean))
      else dispatch({ type: 'TOAST', text: `Could not update from ${parent.key}: ${msg}` })
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertLine color="var(--c-blue)" icon="↳" title={`${task.key} builds on ${parent.key} · ${parent.title}`}>
      {clash ? `${parent.key}'s new commits clash with this branch in ${clash.slice(0, 3).join(', ')}${clash.length > 3 ? ` +${clash.length - 3}` : ''} - nothing changed` : `${parent.key} has ${behind} new commit${behind === 1 ? '' : 's'} this branch doesn't`}
      {!clash && task.st !== 'working' ? <AlertAction onClick={() => !busy && update()}>{busy ? 'updating…' : 'update'}</AlertAction> : null}
      {task.agentKind ? <AlertAction onClick={ask}>ask {agent} to {clash ? 'resolve it' : 'do it'}</AlertAction> : null}
    </AlertLine>
  )
}
