import { useCallback, useEffect, useMemo, useState } from 'react'
import { toggleNoticeCenter } from './notices'
import { focusBoardSearch } from './boardFilter'
import { useAppStore } from '../store/AppStore'
import { blockedTasks } from './derive'
import { createNote, starterBody } from './notes'
import type { EditorOption, MenuEntry, MenuModel, MenuRole } from '@shared/types'
import { errText } from './errors'
import { menuShortcut } from './shortcuts'
import { defaultScope } from './quickOpen'
import { requestWorkspace } from './workspaceBus'
import { addShell, showInWorkspace, wsOpen, wsShowView } from './wsStore'
import { toggleSidebar } from './sidebarMini'
import { splitFocused } from '../screens/workspace/layout/LayoutButtons'
import { notesCommand } from '../components/notes/NotesPane'

import { isMac, keyLabel } from './keys'
import { prefsFor } from './projectPrefs'
import { taskRoot } from './multiRepo'
import { canGo } from '../store/history'
import { isPluginCommand, pluginCommands, runPluginCommand, usePlugins } from './plugins'

export { isMac, keyLabel }

const REVEAL_IN = isMac ? 'Finder' : window.electron.process.platform === 'win32' ? 'Explorer' : 'file manager'

const SEP: MenuEntry = { type: 'separator' }
const role = (r: MenuRole, label: string, key?: string): MenuEntry => ({ id: r, label, key, role: r })

/**
 * App commands: what the title bar menus, the macOS menu bar and the
 * keyboard shortcuts run. Returns the menu model (with each item's enabled
 * state for the current screen) and `run` to carry out a command by id.
 */
export function useCommands(): { menus: MenuModel[]; run: (id: string) => void } {
  const { state, dispatch } = useAppStore()
  const [editors, setEditors] = useState<EditorOption[]>([])

  useEffect(() => {
    window.api.sys.editors().then(setEditors)
  }, [])

  const task = state.view === 'workspace' ? state.tasks.find((t) => t.id === state.taskId) : undefined
  const worktree = task?.worktreePath ? task : undefined
  const focused = task ?? (state.view === 'board' ? state.tasks.find((t) => t.id === state.boardFocus) : undefined)
  const canDesc = !!focused
  const project = state.projects.find((p) => p.id === state.projectId) ?? state.projects[0]
  // (A project can pick its own editor.)
  const editor = editors.find((e) => e.bin === prefsFor(state, task?.projectId ?? project?.id).editor) ?? editors[0]
  // (Their commands are in the Plugins menu.)
  const plugins = usePlugins()
  const canBack = canGo(state, -1)
  const canForward = canGo(state, 1)

  // Keys come from the bindings in effect (keybindings.json over the defaults).
  const k = menuShortcut
  const menus = useMemo<MenuModel[]>(
    () => [
      {
        label: 'File',
        items: [
          { id: 'new-task', label: 'New task', key: k('new-task'), enabled: !!project },
          { id: 'new-project', label: 'New project…', key: k('new-project') },
          { id: 'outside-work', label: 'Bring in outside work…', key: k('outside-work'), enabled: !!project },
          { id: 'open-scratch', label: 'Open scratchpad', enabled: !!project?.repoPath },
          { id: 'new-note', label: 'New note', key: k('new-note') },
          { id: 'open-project', label: 'Open project…', key: k('open-project'), enabled: state.projects.length > 0 },
          SEP,
          { id: 'project-settings', label: 'Project settings', key: k('project-settings'), enabled: !!project },
          { id: 'preferences', label: 'Preferences…', key: k('preferences') },
          { id: 'open-settings-json', label: 'Open settings.json', key: k('open-settings-json') },
          { id: 'keyboard-shortcuts', label: 'Keyboard shortcuts', key: k('keyboard-shortcuts') },
          { id: 'open-keybindings-json', label: 'Open keybindings.json', key: k('open-keybindings-json') },
          SEP,
          { id: 'open-editor', label: editor ? `Open in ${editor.label}` : 'Open in editor', key: k('open-editor'), enabled: !!editor && (!!worktree || !!project) },
          { id: 'reveal-worktree', label: `Reveal worktree in ${REVEAL_IN}`, key: k('reveal-worktree'), enabled: !!worktree },
          SEP,
          { id: 'close-workspace', label: 'Close workspace', key: k('close-workspace'), enabled: !!task },
          ...(isMac ? [] : [SEP, role('quit', 'Exit')])
        ]
      },
      {
        label: 'Edit',
        items: [
          role('undo', 'Undo', '⌘Z'),
          role('redo', 'Redo', '⇧⌘Z'),
          SEP,
          role('cut', 'Cut', '⌘X'),
          role('copy', 'Copy', '⌘C'),
          role('paste', 'Paste', '⌘V'),
          role('selectAll', 'Select all', '⌘A'),
          SEP,
          { id: 'find', label: 'Find…', key: k('find') },
          { id: 'quick-open', label: 'Go to file…', key: k('quick-open'), enabled: state.projects.length > 0 },
          SEP,
          { id: 'edit-desc', label: 'Edit task description', key: k('edit-desc'), enabled: canDesc },
          { id: 'copy-branch', label: 'Copy branch name', key: k('copy-branch'), enabled: !!worktree?.branch }
        ]
      },
      {
        label: 'View',
        items: [
          { id: 'go-back', label: 'Back', key: k('go-back'), enabled: canBack },
          { id: 'go-forward', label: 'Forward', key: k('go-forward'), enabled: canForward },
          SEP,
          { id: 'nav-dashboard', label: 'Projects', key: k('nav-dashboard') },
          { id: 'nav-agents', label: 'Agents', key: k('nav-agents') },
          { id: 'nav-worktrees', label: 'Worktrees', key: k('nav-worktrees') },
          { id: 'nav-notes', label: 'Notes', key: k('nav-notes') },
          { id: 'nav-usage', label: 'Usage', key: k('nav-usage') },
          { id: 'nav-team', label: 'Team', key: k('nav-team') },
          { id: 'nav-inbox', label: 'Inbox', key: k('nav-inbox') },
          { id: 'nav-summary', label: 'Summary', key: k('nav-summary') },
          { id: 'nav-map', label: 'Map', key: k('nav-map'), enabled: state.projects.length > 0 },
          { id: 'notifications', label: 'Notifications', key: k('notifications') },
          { id: 'next-blocked', label: 'Next blocked agent', key: k('next-blocked') },
          { id: 'toggle-zen', label: state.zen ? 'Leave Zen mode' : 'Zen mode', key: k('toggle-zen') },
          { id: 'toggle-sidebar', label: 'Toggle sidebar', key: k('toggle-sidebar') },
          SEP,
          role('zoomIn', 'Zoom in', '⌘='),
          role('zoomOut', 'Zoom out', '⌘-'),
          role('resetZoom', 'Actual size', '⌘0'),
          role('togglefullscreen', 'Toggle full screen'),
          SEP,
          role('reload', 'Reload window'),
          role('toggleDevTools', 'Toggle developer tools', isMac ? '⌥⌘I' : '⇧⌘I')
        ]
      },
      {
        label: 'Plugins',
        items: [
          ...pluginCommands().map((c): MenuEntry => ({ id: c.id, label: c.title, key: k(c.id) })),
          ...(pluginCommands().length ? [SEP] : []),
          { id: 'manage-plugins', label: 'Manage plugins…' },
          { id: 'open-plugins-folder', label: 'Open plugins folder' }
        ]
      },
      {
        label: 'Help',
        items: [
          { id: 'check-updates', label: 'Check for updates…' },
          { id: 'open-logs', label: 'Open logs folder' },
          ...(isMac ? [] : [SEP, role('about', 'About Switchyard')])
        ]
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, state.projects.length, editor, worktree, task, canDesc, state.keybindings, canBack, canForward, state.zen, plugins]
  )

  // Keep the macOS menu bar (and native shortcuts) in step.
  useEffect(() => {
    window.api.menu.set(menus)
  }, [menus])

  const run = useCallback(
    (id: string): void => {
      const entry = menus.flatMap((m) => m.items).find((i) => i.type !== 'separator' && i.id === id)
      if (entry && entry.type !== 'separator') {
        if (entry.enabled === false) return
        if (entry.role) return window.api.menu.role(entry.role)
      }
      const dialogOpen = !!(state.palette || state.start || state.addProjectOpen || state.issuesFor || state.filePreview)
      if (id === 'find') return dispatch({ type: 'TOGGLE_PALETTE' })
      if (id === 'quick-open') {
        // The open task's worktree (its branch), else the project's main checkout.
        const scope = state.palette?.mode === 'files' ? state.palette.scope : defaultScope(state)
        if (!scope) return dispatch({ type: 'TOAST', text: 'Add a project first - Go to file searches its files.' })
        return dispatch({ type: 'OPEN_FILE_SEARCH', scope })
      }
      if (dialogOpen) return
      switch (id) {
        case 'new-task': {
          if (!project) return
          if (state.view !== 'board' || state.projectId !== project.id) dispatch({ type: 'NAV', view: 'board', projectId: project.id })
          return dispatch({ type: 'BEGIN_ADD_TASK' })
        }
        case 'new-project':
          return dispatch({ type: 'OPEN_ADD_PROJECT' })
        case 'outside-work':
          return project && dispatch({ type: 'OPEN_OUTSIDE', projectId: project.id })
        case 'open-scratch':
          return project && dispatch({ type: 'OPEN_SCRATCH', projectId: project.id })
        case 'open-project':
          return dispatch({ type: 'OPEN_PALETTE', query: 'Open board' })
        case 'project-settings':
          return project ? dispatch({ type: 'OPEN_SETTINGS', section: `project:${project.id}` }) : undefined
        case 'preferences':
          return dispatch({ type: 'OPEN_SETTINGS', section: 'general' })
        case 'open-settings-json':
          window.api.settings.openUserFile().catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        case 'keyboard-shortcuts':
          return dispatch({ type: 'OPEN_SETTINGS', section: 'keys' })
        case 'open-keybindings-json':
          window.api.keybindings.openFile().catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        case 'open-editor': {
          const path = (worktree && taskRoot(worktree)) ?? project?.repoPath
          if (!path) return
          window.api.sys
            .openInEditor(path)
            .then((label) => dispatch({ type: 'TOAST', text: `Opened ${worktree ? worktree.branch : project?.name} in ${label}` }))
            .catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        }
        case 'reveal-worktree':
          if (worktree) window.api.sys.reveal(taskRoot(worktree)!).catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        case 'close-workspace':
          if (!task) return
          dispatch({ type: 'NAV', view: 'board', projectId: task.projectId })
          return dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })
        case 'edit-desc':
          if (!focused) return
          return dispatch({ type: 'OPEN_TASK_SHEET', taskId: focused.id })
        case 'copy-branch':
          if (!worktree?.branch) return
          window.api.sys.copy(worktree.branch)
          return dispatch({ type: 'TOAST', text: `Copied ${worktree.branch}` })
        case 'manage-plugins':
          return dispatch({ type: 'OPEN_SETTINGS', section: 'plugins' })
        case 'open-plugins-folder':
          window.api.plugins.openFolder().catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        case 'toggle-zen':
          return dispatch({ type: 'SET_ZEN', on: !state.zen })
        case 'toggle-sidebar':
          // (Zen mode hides it; this brings it back as well.)
          if (state.zen) dispatch({ type: 'SET_ZEN', on: false })
          else toggleSidebar()
          return
        case 'go-back':
          return dispatch({ type: 'GO', dir: -1 })
        case 'go-forward':
          return dispatch({ type: 'GO', dir: 1 })
        case 'nav-dashboard':
          return dispatch({ type: 'NAV', view: 'dashboard' })
        case 'nav-agents':
          return dispatch({ type: 'NAV', view: 'agents' })
        case 'nav-worktrees':
          return dispatch({ type: 'NAV', view: 'worktrees' })
        case 'nav-notes':
          return dispatch({ type: 'OPEN_NOTE', id: null })
        case 'nav-usage':
          return dispatch({ type: 'NAV', view: 'usage' })
        case 'nav-team':
          return dispatch({ type: 'NAV', view: 'team' })
        case 'nav-inbox':
          return dispatch({ type: 'NAV', view: 'inbox' })
        case 'nav-summary':
          return dispatch({ type: 'NAV', view: 'summary' })
        case 'nav-map':
          return dispatch({ type: 'NAV', view: 'map' })
        case 'notifications':
          return toggleNoticeCenter()
        case 'open-logs':
          window.api.log.openDir().catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
          return
        case 'check-updates':
          window.api.updates
            .check()
            .then((r) => dispatch({ type: 'TOAST', text: r.message }))
            .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not check for updates: ${errText(err)}` }))
          return
        case 'board-search':
          return focusBoardSearch()
        case 'new-note': {
          // In a task's workspace it's that task's note; elsewhere the current project's.
          const t = state.view === 'workspace' ? task : undefined
          createNote(dispatch, { body: starterBody(t ? `${t.title} - notes` : ''), projectId: t?.projectId ?? state.projectId, taskId: t?.id ?? null, pinned: false }).then(
            (note) => note && dispatch({ type: 'OPEN_NOTE', id: note.id })
          )
          return
        }
        case 'start-task': {
          const t = state.view === 'board' ? state.tasks.find((x) => x.id === state.boardFocus) : undefined
          if (t && (t.col === 'backlog' || t.col === 'ready')) dispatch({ type: 'OPEN_START_MODAL', taskId: t.id })
          return
        }
        case 'ws-terminal':
        case 'ws-files':
        case 'ws-preview':
        case 'ws-changes':
        case 'ws-notes':
          if (state.view === 'workspace' && state.taskId) showInWorkspace(state.taskId, id.slice(3) as 'terminal' | 'files' | 'preview' | 'changes' | 'notes')
          return
        case 'ws-split-right':
        case 'ws-split-down':
          if (state.view === 'workspace' && task) splitFocused(task, id === 'ws-split-right' ? 'right' : 'bottom')
          return
        case 'ws-new-terminal':
          if (state.view === 'workspace' && task) addShell(task.id, { taskRoot: taskRoot(task) ?? undefined })
          return
        case 'notes-new':
        case 'notes-search':
          if (state.view === 'notes') notesCommand(id === 'notes-new' ? 'new' : 'search')
          return
        case 'search-files':
          if (state.view !== 'workspace' || !state.taskId) return
          wsShowView('search')
          return requestWorkspace('search', state.taskId, {})
        case 'ws-message':
          if (state.view !== 'workspace') return
          if (state.taskId) wsOpen(state.taskId, 'agent')
          // Typing goes straight into the agent's terminal.
          setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-ws-tab="agent"] .xterm-helper-textarea')?.focus(), 0)
          return
        case 'agent-approve':
        case 'agent-deny':
        case 'agent-retry': {
          // In a workspace: its task. On Agents: the oldest one waiting for this.
          const answer: 'yes' | 'no' | 'retry' = id === 'agent-approve' ? 'yes' : id === 'agent-deny' ? 'no' : 'retry'
          const fits = (t: (typeof state.tasks)[number]): boolean => (answer === 'retry' ? t.st === 'failed' : t.st === 'waiting' && t.askKind === 'permission')
          const target = state.view === 'workspace' ? state.tasks.filter((t) => t.id === state.taskId).find(fits) : blockedTasks(state).find(fits)
          if (target) dispatch({ type: 'ANSWER_TASK', taskId: target.id, answer })
          return
        }
        case 'agent-open': {
          const oldest = blockedTasks(state)[0]
          if (oldest) dispatch({ type: 'OPEN_TASK', taskId: oldest.id })
          return
        }
        default:
          if (isPluginCommand(id)) runPluginCommand(id, state, dispatch)
          return
        case 'next-blocked': {
          const blocked = blockedTasks(state)
          if (blocked.length === 0) return dispatch({ type: 'TOAST', text: 'No agents are waiting for you.' })
          const idx = blocked.findIndex((t) => t.id === state.taskId)
          return dispatch({ type: 'OPEN_TASK', taskId: blocked[(idx + 1) % blocked.length].id })
        }
      }
    },
    [menus, state, dispatch, project, worktree, task, focused]
  )

  return { menus, run }
}
