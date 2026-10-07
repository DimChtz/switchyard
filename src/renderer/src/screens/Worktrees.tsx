import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { killTaskSessions } from '../lib/agentControl'
import { useHover } from '../lib/useHover'
import { statusColor, timeAgo } from '../lib/status'
import { agentShort, nextTaskKey, staleWorktrees, type WorktreeRow } from '../lib/derive'
import { titleFromBranch } from '../lib/outside'
import { useRealWorktrees } from '../lib/realGit'
import { errText } from '../lib/errors'
import { keyLabel, revealLabel } from '../lib/keys'
import { addShell } from '../lib/wsStore'
import { Button, Menu, confirm, type MenuItem } from '../components/ui'
import type { Action } from '../store/types'
import type { Project, Task } from '@shared/types'
import { prefsFor } from '../lib/projectPrefs'
import { isMulti, reposOf, taskRoot } from '../lib/multiRepo'

/** Asks (Settings → Git: confirm before removing), then removes the worktree's folder; its branch stays. */
async function removeWorktree(wt: WorktreeRow, task: Task | null, project: Project, askFirst: boolean, dispatch: (a: Action) => void): Promise<boolean> {
  // One of the other repositories of a task in several: only that repository leaves the task.
  const attached = !!task && task.projectId !== project.id
  if (attached && task) {
    if (askFirst) {
      const ok = await confirm({
        title: `Remove ${project.name} from ${task.key}?`,
        body: `Its worktree of ${wt.branch} is deleted from disk${wt.dirty ? `, with ${wt.dirty} uncommitted change${wt.dirty > 1 ? 's' : ''}` : ''}; the branch is kept. The task goes on in its other repositories.`,
        detail: wt.path,
        confirmLabel: 'Remove worktree',
        danger: true
      })
      if (!ok) return false
    }
    try {
      await window.api.git.removeWorktree(project.repoPath, wt.path, false)
      dispatch({ type: 'SET_TASK_REPOS', taskId: task.id, repos: (task.repos ?? []).filter((r) => r !== project.id) })
      dispatch({ type: 'TOAST', text: `Removed ${project.name} from ${task.key}.` })
      dispatch({ type: 'SELECT_WORKTREE', id: null })
      return true
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not remove worktree: ${errText(err)}` })
      return false
    }
  }
  if (askFirst) {
    const ok = await confirm({
      title: `Remove the worktree of ${wt.branch}?`,
      body: `Its folder is deleted from disk${wt.dirty ? `, with ${wt.dirty} uncommitted change${wt.dirty > 1 ? 's' : ''}` : ''}; the branch is kept.${task && task.col !== 'done' ? ` ${task.key} goes back to Ready.` : ''}`,
      detail: wt.path,
      confirmLabel: 'Remove worktree',
      danger: true
    })
    if (!ok) return false
  }
  try {
    if (task) await killTaskSessions(task.id)
    await window.api.git.removeWorktree(project.repoPath, wt.path, false)
    if (task) dispatch({ type: 'DETACH_WORKTREE', taskId: task.id })
    dispatch({ type: 'TOAST', text: task && task.col !== 'done' ? `Worktree removed - ${task.key} is back in Ready (branch kept).` : 'Worktree removed.' })
    dispatch({ type: 'SELECT_WORKTREE', id: null })
    return true
  } catch (err) {
    dispatch({ type: 'TOAST', text: `Could not remove worktree: ${errText(err)}` })
    return false
  }
}

/**
 * A worktree no task holds, as a new task: it's made (named after its
 * branch) and the Start dialog opens with this worktree picked - the task
 * takes it over as it is, on its branch.
 */
function startHere(wt: WorktreeRow, project: Project, tasks: Task[], dispatch: (a: Action) => void): void {
  const key = nextTaskKey(tasks, project)
  const now = Date.now()
  dispatch({
    type: 'ADD_TASK',
    task: { id: key, key, projectId: project.id, title: titleFromBranch(wt.branch), desc: '', col: 'ready', agentKind: null, st: null, worktreeId: null, worktreePath: null, branch: null, ask: null, doneNote: null, firstMessage: null, createdAt: now, startedAt: null, lastActivityAt: now }
  })
  dispatch({ type: 'OPEN_START_MODAL', taskId: key })
  dispatch({ type: 'SET_START_OPTIONS', patch: { existingWorktree: wt.path } })
  dispatch({ type: 'SET_START_BRANCH', branch: wt.branch })
}

/** A shell in the worktree: a new tab in the task's workspace, else the system terminal. */
function openTerminalIn(wt: WorktreeRow, task: Task | null, dispatch: (a: Action) => void): void {
  if (task) {
    addShell(task.id, { taskRoot: taskRoot(task) ?? undefined })
    dispatch({ type: 'OPEN_TASK', taskId: task.id })
  } else {
    window.api.sys.openTerminal(wt.path).catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
  }
}

function Row({ wt, onChanged }: { wt: WorktreeRow; onChanged: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const task = state.tasks.find((t) => t.id === wt.taskId) ?? null
  const project = state.projects.find((p) => p.id === wt.projectId)
  const selected = state.wtSelected === wt.id
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })

  const menuItems: MenuItem[] = [
    ...(task
      ? [
          { label: 'Open workspace', onClick: () => dispatch({ type: 'OPEN_TASK', taskId: task.id }) },
          { label: 'Browse files', onClick: () => dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'files' }) }
        ]
      : project && wt.branch
        ? [{ label: 'Start a task here…', onClick: () => startHere(wt, project, state.tasks, dispatch) }]
        : []),
    { label: task ? 'Open terminal here' : 'Open in terminal', shortcut: keyLabel('⌘T'), onClick: () => openTerminalIn(wt, task, dispatch) },
    { label: revealLabel, separatorBefore: true, onClick: () => window.api.sys.showItem(wt.path).catch(toastErr) },
    { label: 'Open in Editor', onClick: () => window.api.sys.openInEditor(wt.path).catch(toastErr) },
    { label: 'Copy path', separatorBefore: true, onClick: () => window.api.sys.copy(wt.path) },
    { label: 'Copy branch name', onClick: () => window.api.sys.copy(wt.branch) },
    {
      label: 'Remove worktree…',
      danger: true,
      separatorBefore: true,
      disabled: task?.st === 'working',
      onClick: () => project && removeWorktree(wt, task, project, true, dispatch).then((ok) => ok && onChanged())
    }
  ]

  return (
    <div
      onClick={() => dispatch({ type: 'SELECT_WORKTREE', id: wt.id })}
      onDoubleClick={() => task && dispatch({ type: 'OPEN_TASK', taskId: task.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        dispatch({ type: 'SELECT_WORKTREE', id: wt.id })
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      {...hoverProps}
      style={{
        display: 'grid',
        gridTemplateColumns: '2.3fr 1.5fr 1.2fr 0.8fr 0.9fr 0.6fr',
        gap: 16,
        alignItems: 'center',
        minHeight: 48,
        padding: '0 12px',
        borderRadius: 5,
        background: selected ? 'var(--bg-panel-3)' : hover ? 'var(--bg-panel)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px var(--bd-4)' : 'inset 0 0 0 1px transparent',
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: "12.5px var(--font-mono)", color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {wt.branch}
        </span>
        {/* Cut at the start, not the end: the folder's own name is what tells them apart. */}
        <span title={wt.path} style={{ font: "11.5px var(--font-mono)", color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>
          <bdi>{wt.path}</bdi>
        </span>
      </div>
      <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {task ? task.title : 'no linked task'}
        {task && isMulti(task)
          ? ` · ${reposOf(task)
              .filter((r) => r !== wt.projectId)
              .map((r) => `+${state.projects.find((p) => p.id === r)?.name ?? r}`)
              .join(', ')}`
          : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: '12.5px var(--font-ui)', color: 'var(--t2)' }}>
        {task ? (
          <>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(task.st), flex: 'none' }} />
            {agentShort(task.agentKind)}
          </>
        ) : (
          <span style={{ color: 'var(--t4)' }}>no agent</span>
        )}
      </span>
      <span style={{ font: "12px var(--font-mono)", color: 'var(--t2)' }}>
        ↑{wt.ahead} <span style={{ color: wt.behind ? 'var(--c-amber)' : 'var(--t4)' }}>↓{wt.behind}</span>
      </span>
      <span style={{ font: "12px var(--font-mono)", color: wt.dirty ? 'var(--t2)' : 'var(--t4)' }}>
        {wt.dirty ? `${wt.dirty} modified` : 'clean'}
      </span>
      <span style={{ font: "12px var(--font-mono)", color: 'var(--t4)', textAlign: 'right' }}>{timeAgo(wt.lastActivityAt)}</span>
      {menu ? <Menu anchor={menu} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}

function DetailPanel({ worktrees, onChanged }: { worktrees: WorktreeRow[]; onChanged: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const wt = worktrees.find((w) => w.id === state.wtSelected)
  const [syncing, setSyncing] = useState(false)
  const [conflict, setConflict] = useState<string[] | null>(null)
  useEffect(() => {
    setConflict(null)
  }, [wt?.path])
  const task = wt ? state.tasks.find((t) => t.id === wt.taskId) ?? null : null

  const openTerminal = (): void => {
    if (wt) openTerminalIn(wt, task, dispatch)
  }

  // The shortcuts shown next to the actions: ↵ open, ⌘T terminal, F files, ⌘⌫ remove.
  const keysRef = React.useRef<(e: KeyboardEvent) => void>(() => {})
  keysRef.current = (e: KeyboardEvent): void => {
    if (!wt || state.palette || state.start || state.addProjectOpen || state.filePreview) return
    const el = document.activeElement as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    const meta = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (!meta && e.key === 'Enter' && task) {
      e.preventDefault()
      dispatch({ type: 'OPEN_TASK', taskId: task.id })
    } else if (meta && !e.shiftKey && k === 't') {
      e.preventDefault()
      openTerminal()
    } else if (!meta && !e.altKey && k === 'f' && task) {
      e.preventDefault()
      dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'files' })
    } else if (meta && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault()
      removeRef.current()
    }
  }
  const removeRef = React.useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keysRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!wt) {
    return (
      <div style={{ borderLeft: '1px solid var(--bd-1)', padding: '22px 20px', color: 'var(--t4)', fontSize: 13, background: 'var(--bg-panel-2)' }}>
        Select a worktree to see details.
      </div>
    )
  }

  const project = state.projects.find((p) => p.id === wt.projectId)!
  const busy = task?.st === 'working'
  const base = wt.base

  const prefs = prefsFor(state, project.id)
  const merge = prefs.syncMode === 'merge'
  const showBehind = !!task && prefs.warnBehind && wt.behind >= 10
  const remove = async (): Promise<void> => {
    if (await removeWorktree(wt, task, project, prefs.confirmRemove, dispatch)) onChanged()
  }
  removeRef.current = busy ? () => {} : remove

  // Brings the branch up to date with the base. On conflicts nothing
  // changes; the agent can be asked to do it and resolve them.
  const sync = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setConflict(null)
    try {
      await window.api.git.rebase(wt.path, base)
      dispatch({ type: 'TOAST', text: merge ? `Merged ${base} into ${wt.branch}.` : `Rebased ${wt.branch} onto ${base}.` })
      onChanged()
    } catch (err) {
      const msg = errText(err)
      if (msg.startsWith('CONFLICT:')) setConflict(msg.slice('CONFLICT:'.length).split('\n').filter(Boolean))
      else dispatch({ type: 'TOAST', text: `${merge ? 'Merge' : 'Rebase'} failed: ${msg}` })
    } finally {
      setSyncing(false)
    }
  }

  const askAgent = (files?: string[]): void => {
    if (!task) return
    const what = merge ? `merge ${base} into this branch` : `rebase this branch onto ${base}`
    dispatch({
      type: 'MESSAGE_AGENT',
      taskId: task.id,
      text: `Please ${what} and resolve the conflicts${files?.length ? ` (in ${files.join(', ')})` : ''}. Commit when done.`,
      toast: `Asked ${agentShort(task.agentKind)} to ${merge ? 'merge' : 'rebase'}.`
    })
    dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'terminal' })
  }

  return (
    <div style={{ borderLeft: '1px solid var(--bd-1)', padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 20, overflow: 'auto', background: 'var(--bg-panel-2)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>{task ? task.key : project.name}</div>
        <div style={{ font: "500 14px var(--font-mono)", color: 'var(--t1)', overflowWrap: 'anywhere' }}>{wt.branch}</div>
        {task ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, font: '12.5px var(--font-ui)', color: statusColor(task.st) }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(task.st) }} />
            {agentShort(task.agentKind)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ font: '12.5px var(--font-ui)', color: 'var(--t4)' }}>No task linked to this worktree.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" variant="primary" onClick={() => startHere(wt, project, state.tasks, dispatch)} title="A new task that takes this worktree over as it is, on its branch - the Start dialog opens with it picked">
                Start a task here…
              </Button>
              <Button size="sm" onClick={() => dispatch({ type: 'OPEN_OUTSIDE', projectId: project.id })} title="Make it a task on the board - with its agent's conversation, if it has one">
                Bring in as a task…
              </Button>
            </div>
          </div>
        )}
      </div>

      {showBehind && task ? (
        <div style={{ border: '1px solid color-mix(in srgb, var(--c-amber) 30%, transparent)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: '13px/1.45 var(--font-ui)', color: 'var(--t1)' }}>
            {base} has moved {wt.behind} commits ahead of this branch.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button variant="primary" size="sm" onClick={() => askAgent()}>
              Ask {agentShort(task.agentKind)} to {merge ? `merge ${base}` : 'rebase'}
            </Button>
            <Button size="sm" onClick={sync}>
              {merge ? 'Merge myself' : 'Rebase myself'}
            </Button>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div style={{ border: '1px solid color-mix(in srgb, var(--c-red) 40%, transparent)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: '13px/1.45 var(--font-ui)', color: 'var(--t1)' }}>
            {merge ? `Merging ${base}` : `Rebasing onto ${base}`} conflicts in {conflict.length} file{conflict.length > 1 ? 's' : ''}. Nothing was changed.
          </div>
          <div style={{ font: "11.5px/1.5 var(--font-mono)", color: 'var(--c-red)', overflowWrap: 'anywhere' }}>{conflict.slice(0, 6).join(' · ')}</div>
          {task?.agentKind ? (
            <Button variant="primary" size="sm" onClick={() => askAgent(conflict)} style={{ alignSelf: 'flex-start' }}>
              Ask {agentShort(task.agentKind)} to resolve them
            </Button>
          ) : (
            <div style={{ font: '12px var(--font-ui)', color: 'var(--t3)' }}>Resolve them in a terminal in the worktree.</div>
          )}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 9, columnGap: 10, font: "12px var(--font-mono)", alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)' }}>Path</span>
        <span style={{ color: 'var(--t2)', overflowWrap: 'anywhere' }}>{wt.path}</span>
        <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)' }}>Base</span>
        <span style={{ color: 'var(--t2)' }}>{project.repo} · {base}</span>
        <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)' }}>vs {base}</span>
        <span style={{ color: 'var(--t2)' }}>↑{wt.ahead} ↓{wt.behind}</span>
        <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)' }}>Changes</span>
        <span style={{ color: 'var(--t2)' }}>{wt.dirty} modified</span>
        {task ? (
          <>
            <span style={{ fontFamily: 'var(--font-ui)', color: 'var(--t4)' }}>Created</span>
            <span style={{ color: 'var(--t2)' }}>{timeAgo(task.startedAt ?? task.createdAt)} ago</span>
          </>
        ) : null}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {task ? <ActionRow label="Open workspace" hint="↵" onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })} /> : null}
        <ActionRow label={task ? 'Open terminal here' : 'Open in terminal'} hint={keyLabel('⌘T')} onClick={openTerminal} />
        {task ? (
          <ActionRow label="Browse files" hint="F" onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id, tab: 'files' })} />
        ) : (
          <>
            <ActionRow label="Open in editor" hint="" onClick={() => window.api.sys.openInEditor(wt.path).catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))} />
            <ActionRow label={revealLabel} hint="" onClick={() => window.api.sys.showItem(wt.path).catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))} />
          </>
        )}
        {wt.behind > 0 && !showBehind ? (
          <ActionRow label={syncing ? 'Syncing…' : `${merge ? 'Merge' : 'Rebase onto'} ${base} (${wt.behind} behind)`} hint="" disabled={syncing || wt.dirty > 0} onClick={sync} />
        ) : null}
        <ActionRow label="Remove worktree" hint={keyLabel('⌘⌫')} danger disabled={busy} onClick={remove} />
        <div style={{ font: "11.5px/1.45 var(--font-ui)", color: 'var(--t4)', marginTop: 6 }}>
          Removing a worktree deletes its files on disk; its branch is kept. {task && task.col !== 'done' ? `${task.key} goes back to Ready.` : ''}
        </div>
      </div>
    </div>
  )
}

function ActionRow({
  label,
  hint,
  onClick,
  danger,
  disabled
}: {
  label: string
  hint: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={disabled ? undefined : onClick}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 30,
        padding: '0 8px',
        margin: '0 -8px',
        borderRadius: 5,
        font: '13px var(--font-ui)',
        color: disabled ? 'var(--t5)' : danger ? 'var(--c-red)' : 'var(--t1)',
        cursor: disabled ? 'default' : 'pointer',
        background: hover && !disabled ? 'color-mix(in srgb, var(--ov) 5%, transparent)' : 'transparent'
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)' }}>{hint}</span>
    </div>
  )
}

export function Worktrees(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [refreshKey, setRefreshKey] = useState(0)
  const { data: worktrees, loading } = useRealWorktrees(state.projects, state.tasks, refreshKey)
  const stale = useMemo(() => staleWorktrees(worktrees, state.prefs.staleDays), [worktrees, state.prefs.staleDays])
  const clean = stale.filter((w) => w.dirty === 0)

  // Automatic cleanup (Settings → Git) ran in the background.
  useEffect(() => window.api.git.onPruned(() => setRefreshKey((k) => k + 1)), [])

  // The folder goes; the branch too only when it has nothing of its own.
  const pruneOne = async (wt: WorktreeRow, quiet = false): Promise<void> => {
    const project = state.projects.find((p) => p.id === wt.projectId)
    if (!project) return
    // Uncommitted changes are only thrown away once that's confirmed.
    if (wt.dirty > 0) {
      const ok = await confirm({
        title: `Discard ${wt.dirty} uncommitted change${wt.dirty > 1 ? 's' : ''}?`,
        body: `Pruning deletes the worktree of ${wt.branch}, and its uncommitted work with it. The branch is kept.`,
        detail: wt.path,
        confirmLabel: 'Discard and prune',
        danger: true
      })
      if (!ok) return
    }
    try {
      if (wt.ahead === 0 && wt.dirty === 0) await window.api.git.discardWorktree(project.repoPath, wt.path, wt.branch)
      else await window.api.git.removeWorktree(project.repoPath, wt.path, wt.dirty > 0)
      if (!quiet) dispatch({ type: 'TOAST', text: `Pruned ${wt.branch}${wt.ahead > 0 ? ' · branch kept' : ''}.` })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not prune ${wt.branch}: ${errText(err)}` })
    }
  }

  const pruneAll = async (): Promise<void> => {
    for (const wt of clean) await pruneOne(wt, true)
    dispatch({ type: 'TOAST', text: `Pruned ${clean.length} worktree${clean.length === 1 ? '' : 's'}.` })
  }

  const byProject = new Map<string, WorktreeRow[]>()
  for (const wt of worktrees) {
    const arr = byProject.get(wt.projectId) ?? []
    arr.push(wt)
    byProject.set(wt.projectId, arr)
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 312px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 28px', gap: 16, minWidth: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ font: "600 20px var(--font-ui)", letterSpacing: '-0.01em' }}>Worktrees</div>
          <div style={{ font: "12.5px var(--font-mono)", color: 'var(--t3)' }}>
            {worktrees.length} on disk · {state.prefs.worktreeRoot || '.worktrees/ in each repo'}
            {loading ? ' · refreshing…' : ''}
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2.3fr 1.5fr 1.2fr 0.8fr 0.9fr 0.6fr',
            gap: 16,
            padding: '0 12px 8px',
            font: "500 11px var(--font-mono)",
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--t4)',
            borderBottom: '1px solid var(--bd-1)'
          }}
        >
          <span>Branch · path</span>
          <span>Task</span>
          <span>Agent</span>
          <span>vs base</span>
          <span>Working tree</span>
          <span style={{ textAlign: 'right' }}>Last</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -8 }}>
          {[...byProject.entries()].map(([projectId, rows]) => {
            const project = state.projects.find((p) => p.id === projectId)!
            return (
              <div key={projectId} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32, padding: '0 12px', font: '500 12.5px var(--font-ui)', color: 'var(--t2)' }}>
                  <span>{project.name}</span>
                  <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t4)' }}>{rows.length} worktree{rows.length === 1 ? '' : 's'}</span>
                </div>
                {rows.map((r) => (
                  <Row key={r.id} wt={r} onChanged={() => setRefreshKey((k) => k + 1)} />
                ))}
              </div>
            )
          })}
          {worktrees.length === 0 ? (
            <div style={{ padding: '20px 12px', color: 'var(--t4)', fontSize: 13, lineHeight: 1.55 }}>
              No worktrees yet. Each task you start gets its own - a separate checkout on its own branch, so agents never step on each other or on your work.
            </div>
          ) : null}
        </div>

        {stale.length > 0 ? (
          <div style={{ marginTop: 4, border: '1px solid var(--bd-3)', borderRadius: 6, background: 'var(--bg-panel-3)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--bd-1)' }}>
              <span style={{ font: "500 13px var(--font-ui)", color: 'var(--t1)' }}>Clean up</span>
              <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>
                {stale.length} stale · no task, nothing new or untouched for {state.prefs.staleDays}+ days
              </span>
              <div style={{ flex: 1 }} />
              <Button size="sm" onClick={pruneAll} title={clean.length < stale.length ? 'Worktrees with uncommitted changes are left for you to prune one by one' : undefined}>
                {clean.length === stale.length ? 'Prune all' : `Prune ${clean.length} clean`}
              </Button>
            </div>
            {stale.map((s) => {
              const project = state.projects.find((p) => p.id === s.projectId)!
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '2.3fr 3.2fr auto', gap: 16, alignItems: 'center', height: 44, padding: '0 12px', borderTop: '1px solid var(--bd-row)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ font: "12.5px var(--font-mono)", color: 'var(--t2)' }}>{s.branch}</span>
                    <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {project.name} · {s.path}
                    </span>
                  </div>
                  <span style={{ font: '12.5px var(--font-ui)', color: s.dirty ? 'var(--c-amber)' : 'var(--t3)' }}>{s.reason}</span>
                  <Button variant="ghost" size="sm" tone={s.dirty ? 'danger' : undefined} onClick={() => pruneOne(s)}>
                    {s.dirty ? 'Discard & prune…' : 'Prune'}
                  </Button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
      <DetailPanel worktrees={worktrees} onChanged={() => setRefreshKey((k) => k + 1)} />
    </div>
  )
}
