import type { Prefs, Project, Task } from '@shared/types'
import type { Action } from '../store/types'
import type { MenuItem } from '../components/ui'
import { deleteTaskItems, removeProject } from './taskActions'
import { revealLabel } from './keys'
import { errText } from './errors'
import { shortcut } from './shortcuts'
import { taskRoot } from './multiRepo'

type Dispatch = (action: Action) => void

/**
 * The right-click menus of a task and of a project - the same wherever the
 * task or project shows up (board, sidebar, dashboard, agents, workspace).
 */

/** Open-in-the-system items for a folder: file manager, terminal, editor, path. */
export function folderItems(path: string, dispatch: Dispatch): MenuItem[] {
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  return [
    { label: revealLabel, separatorBefore: true, onClick: () => window.api.sys.showItem(path).catch(toastErr) },
    { label: 'Open in External Terminal', onClick: () => window.api.sys.openTerminal(path).catch(toastErr) },
    { label: 'Open in Editor', onClick: () => window.api.sys.openInEditor(path).catch(toastErr) },
    { label: 'Copy Path', onClick: () => window.api.sys.copy(path) }
  ]
}

export function taskMenuItems(
  task: Task,
  project: Project | undefined,
  prefs: Prefs,
  dispatch: Dispatch,
  opts: { rename?: () => void; editDesc?: () => void; inWorkspace?: boolean; projects?: Project[] } = {}
): MenuItem[] {
  // The scratchpad: just the folder it's in.
  if (task.scratch) return [...(opts.inWorkspace ? [] : [{ label: 'Open scratchpad', onClick: () => dispatch({ type: 'OPEN_SCRATCH', projectId: task.projectId }) }]), ...folderItems(task.worktreePath ?? project?.repoPath ?? '', dispatch)]
  const startable = !task.worktreePath && (task.col === 'backlog' || task.col === 'ready')
  const open: MenuItem[] = opts.inWorkspace
    ? []
    : [
        task.worktreePath
          ? { label: 'Open workspace', onClick: () => dispatch({ type: 'OPEN_TASK', taskId: task.id }) }
          : startable
            ? { label: 'Start with agent…', shortcut: shortcut('start-task'), onClick: () => dispatch({ type: 'OPEN_START_MODAL', taskId: task.id }) }
            : { label: 'Open', onClick: () => dispatch({ type: 'OPEN_TASK', taskId: task.id }) }
      ]
  const sleep: MenuItem[] = task.sleeping
    ? [
        { label: 'Wake now', onClick: () => dispatch({ type: 'WAKE_TASK', taskId: task.id }) },
        { label: 'Don’t wake it', onClick: () => dispatch({ type: 'CANCEL_SLEEP', taskId: task.id }) }
      ]
    : []
  const queue: MenuItem[] = task.queued
    ? [{ label: 'Remove from queue', onClick: () => dispatch({ type: 'UNQUEUE_TASK', taskId: task.id }) }]
    : startable
      ? [{ label: prefs.maxAgents ? 'Add to queue' : 'Start in background', onClick: () => dispatch({ type: 'QUEUE_TASKS', taskIds: [task.id] }) }]
      : []
  const links: MenuItem[] = [
    ...(task.issue ? [{ label: `Open issue #${task.issue.number}`, onClick: () => window.api.sys.openExternal(task.issue!.url) }] : []),
    ...(task.pr ? [{ label: `Open PR #${task.pr.number ?? ''} in browser`, onClick: () => window.api.sys.openExternal(task.pr!.url) }] : [])
  ]
  const edits: MenuItem[] = [
    { label: task.pinnedAt ? 'Unpin' : 'Pin to top', onClick: () => dispatch({ type: 'PIN_TASK', taskId: task.id, pinned: !task.pinnedAt }) },
    ...(opts.rename ? [{ label: 'Rename', onClick: opts.rename }] : []),
    ...(opts.editDesc ? [{ label: 'Edit description', onClick: opts.editDesc }] : []),
    // A next step that needs this one's changes: its branch starts from this one's (one in the project folder has none).
    ...(task.col !== 'done' && !task.inPlace
      ? [
          {
            label: 'New task building on this',
            onClick: () => {
              dispatch({ type: 'NAV', view: 'board', projectId: task.projectId })
              dispatch({ type: 'BEGIN_ADD_TASK', after: task.id })
            }
          }
        ]
      : [])
  ]
  const copies: MenuItem[] = [
    { label: 'Copy key', onClick: () => window.api.sys.copy(task.key) },
    ...(task.branch ? [{ label: 'Copy branch name', onClick: () => window.api.sys.copy(task.branch!) }] : [])
  ]
  return [
    ...open,
    ...sleep,
    ...queue,
    ...links,
    ...sep(edits),
    ...sep(copies),
    ...(task.worktreePath ? folderItems(taskRoot(task)!, dispatch) : []),
    ...deleteTaskItems(task, project, dispatch, opts.projects)
  ]
}

export function projectMenuItems(project: Project, tasks: Task[], dispatch: Dispatch, opts: { github?: boolean; muted?: string[] } = {}): MenuItem[] {
  const muted = opts.muted?.includes(project.id)
  return [
    { label: 'Open board', onClick: () => dispatch({ type: 'NAV', view: 'board', projectId: project.id }) },
    { label: 'Open scratchpad', onClick: () => dispatch({ type: 'OPEN_SCRATCH', projectId: project.id }) },
    {
      label: 'New task',
      onClick: () => {
        dispatch({ type: 'NAV', view: 'board', projectId: project.id })
        dispatch({ type: 'BEGIN_ADD_TASK' })
      }
    },
    ...(opts.github ? [{ label: 'Import GitHub issues…', onClick: () => dispatch({ type: 'OPEN_ISSUES', projectId: project.id }) }] : []),
    { label: 'Project settings', shortcut: shortcut('project-settings'), onClick: () => dispatch({ type: 'OPEN_SETTINGS', section: `project:${project.id}` }) },
    ...(opts.muted
      ? [
          {
            label: muted ? 'Unmute notifications' : 'Mute notifications',
            onClick: () => {
              const next = muted ? opts.muted!.filter((id) => id !== project.id) : [...opts.muted!, project.id]
              dispatch({ type: 'SET_PREFS', patch: { mutedProjects: next } })
              dispatch({ type: 'TOAST', text: muted ? `${project.name} notifies again.` : `${project.name} is muted - no notifications from its tasks.` })
            }
          }
        ]
      : []),
    ...folderItems(project.repoPath, dispatch),
    { label: 'Remove project…', danger: true, separatorBefore: true, onClick: () => removeProject(project, tasks, dispatch) }
  ]
}

/** A group that starts after a separator (when it has anything). */
function sep(items: MenuItem[]): MenuItem[] {
  return items.map((it, i) => (i === 0 ? { ...it, separatorBefore: true } : it))
}
