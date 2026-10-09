import React, { useEffect } from 'react'
import { cardVisible, inBoardOrder, pinnedFirst } from './lib/boardFilter'
import { AppStoreProvider, useAppStore } from './store/AppStore'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toast } from './components/Toast'
import { CommandPalette } from './components/CommandPalette'
import { FilePreview } from './components/FilePreview'
import { StartTaskModal } from './components/StartTaskModal'
import { NewProjectModal } from './components/NewProjectModal'
import { IssuesModal } from './components/IssuesModal'
import { TaskSheet } from './components/TaskSheet'
import { OutsideModal } from './components/OutsideWork'
import { ArchiveModal } from './components/Archive'
import { PluginInstallDialog } from './components/PluginInstall'
import { ConfirmHost, TextContextMenu, TooltipHost } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Settings } from './screens/Settings'
import { useCommands } from './lib/commands'
import { bindings, shortcut } from './lib/shortcuts'
import { eventChord, matchBinding } from '@shared/keybindings'
import { Dashboard } from './screens/Dashboard'
import { Board } from './screens/Board'
import { Agents } from './screens/Agents'
import { Worktrees } from './screens/Worktrees'
import { Workspace } from './screens/Workspace'
import { Notes } from './screens/Notes'
import { Usage } from './screens/Usage'
import { Team } from './screens/Team'
import { Inbox } from './screens/Inbox'
import { Summary } from './screens/Summary'
import { RepoMap } from './screens/RepoMap'
import { PullRequests } from './screens/PullRequests'
import { useSummaryAnnouncement } from './lib/activity'
import { AGENTS, COLUMN_ORDER } from '@shared/constants'
import { inProject } from './lib/multiRepo'
import { useThemePref, useThemes } from './lib/theme'
import { useSpendAlerts } from './lib/usage'
import { addNotice } from './lib/notices'
import { formatCost } from '@shared/usage'

const VIEW_NAME: Partial<Record<string, string>> = {
  dashboard: 'Projects',
  board: 'the board',
  agents: 'Agents',
  worktrees: 'Worktrees',
  workspace: "this task's workspace",
  settings: 'Settings',
  notes: 'Notes',
  usage: 'Usage',
  team: 'Team',
  inbox: 'the Inbox',
  summary: 'the Summary',
  map: 'the Map'
}

function isTyping(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

function Shell(): React.JSX.Element {
  const { state, dispatch } = useAppStore()

  // Agent spending past an alert or a project's budget (Settings → Agents → Spending).
  useSpendAlerts(state.prefs, (a) => {
    const when = { day: 'today', week: 'this week', month: 'this month' }[a.period]
    const project = a.projectId ? (state.projects.find((p) => p.id === a.projectId)?.name ?? a.projectId) : null
    const title = project ? `${project} reached its budget` : `${{ day: 'Daily', week: 'Weekly', month: 'Monthly' }[a.period]} spending alert`
    const text = project
      ? `${project}'s agents have used ${formatCost(a.cost)} ${when} - its budget is ${formatCost(a.limit)}`
      : `Agents have used ${formatCost(a.cost)} ${when} - past your ${formatCost(a.limit)} alert`
    dispatch({ type: 'TOAST', text })
    if (state.prefs.noticeKinds.includes('spend')) addNotice({ kind: 'spend', taskId: '', taskKey: '', taskTitle: '', projectId: a.projectId ?? '', text: title, detail: `${text} (at API prices).` })
    if (!document.hasFocus()) window.api.sys.notify(title, `${text}.`, null)
  })

  // The day's summary, at its time (Settings → General).
  useSummaryAnnouncement(state.prefs, () => {
    dispatch({ type: 'TOAST', text: `Your daily summary is ready - Summary in the sidebar${shortcut('nav-summary') ? ` (${shortcut('nav-summary')})` : ''}.` })
    if (!document.hasFocus()) window.api.sys.notify('Your daily summary is ready', 'What the agents did, what needs you and what’s next.', null)
  })

  // The theme follows the preference; a theme file with a problem says so.
  useThemePref(state.prefs.theme)
  const { problems } = useThemes()
  const problemKey = problems.join('\n')
  useEffect(() => {
    if (problems.length) dispatch({ type: 'TOAST', text: `Theme: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''} - see Settings → Appearance` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemKey])

  const { menus, run } = useCommands()

  // The macOS menu bar (and native menu shortcuts) run the same commands.
  useEffect(() => window.api.menu.onCommand(run), [run])

  // A mouse's back and forward buttons.
  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      run(e.button === 3 ? 'go-back' : 'go-forward')
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [run])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const meta = e.metaKey || e.ctrlKey

      // The New project and Import issues dialogs, and the task sheet, handle their own keys.
      if (state.addProjectOpen || state.issuesFor || state.taskSheet || state.outsideFor || state.archiveFor) return

      // Shortcuts: keybindings.json over the defaults (Settings → Keyboard shortcuts).
      const chord = eventChord(e)
      if (chord) {
        const typing = isTyping()
        const dialogOpen = !!(state.palette || state.start || state.filePreview)
        const ctx = {
          [state.view]: true,
          terminalFocus: !!(e.target as HTMLElement | null)?.closest?.('.xterm'),
          inputFocus: typing,
          dialogOpen
        }
        // A key without Ctrl/Cmd/Alt types into a field - never a shortcut there.
        const plain = !chord.ctrl && !chord.meta && !chord.alt
        const command = plain && typing ? null : matchBinding(bindings(), chord, ctx)
        // With the palette, Start modal or a preview open only Find and Go to file work; the rest is theirs.
        if (command && (!dialogOpen || command === 'find' || command === 'quick-open')) {
          e.preventDefault()
          return run(command)
        }
      }

      if (e.key === 'Escape') {
        if (state.palette) return dispatch({ type: 'CLOSE_PALETTE' })
        if (state.filePreview) return dispatch({ type: 'CLOSE_FILE_PREVIEW' })
        if (state.start) {
          if (state.start.phase === 'launch') dispatch({ type: 'BACKGROUND_START' })
          else dispatch({ type: 'CLOSE_START_MODAL' })
          return
        }
        if (state.addingTask) return dispatch({ type: 'CANCEL_ADD_TASK' })
        ;(document.activeElement as HTMLElement)?.blur?.()
        return
      }

      if (state.start && !state.palette && state.start.phase === 'config') {
        // 1-3 pick from the agents turned on in Settings, as listed.
        const agents = AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind))
        const n = Number(e.key)
        if (!isTyping() && n >= 1 && n <= agents.length) return dispatch({ type: 'SET_START_AGENT', agentKind: agents[n - 1].kind })
        if (e.key === 'Enter' && (meta || !isTyping())) {
          e.preventDefault()
          return dispatch({ type: 'LAUNCH_START' })
        }
        return
      }

      if (state.palette || state.start || state.filePreview) return

      // The board's arrow keys (and hjkl) below; Ctrl+C and friends aren't them.
      if (meta || e.altKey) return
      if (isTyping()) return

      if (state.view === 'board') {
        // The cards the search, filters and folded lanes leave, as the board lists them.
        const tasks = inBoardOrder(pinnedFirst(state.tasks.filter((t) => inProject(t, state.projectId) && cardVisible(t.id))))
        const colOf = (id: string | null): number => {
          const t = tasks.find((x) => x.id === id)
          return t ? COLUMN_ORDER.indexOf(t.col) : -1
        }
        if (e.key === 'Enter') {
          const t = tasks.find((x) => x.id === state.boardFocus)
          if (!t) return
          if (t.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: t.id })
          else if (t.col === 'backlog' || t.col === 'ready') dispatch({ type: 'OPEN_START_MODAL', taskId: t.id })
          return
        }
        const dir = { ArrowLeft: -1, h: -1, H: -1, ArrowRight: 1, l: 1, L: 1 }[e.key]
        const vdir = { ArrowUp: -1, k: -1, K: -1, ArrowDown: 1, j: 1, J: 1 }[e.key]
        if (dir !== undefined) {
          const col = colOf(state.boardFocus)
          const targetCol = COLUMN_ORDER[Math.min(4, Math.max(0, col + dir))]
          const first = tasks.find((t) => t.col === targetCol)
          if (first) dispatch({ type: 'SET_BOARD_FOCUS', id: first.id })
          return
        }
        if (vdir !== undefined && state.boardFocus) {
          const t = tasks.find((x) => x.id === state.boardFocus)
          if (!t) return
          const inCol = tasks.filter((x) => x.col === t.col)
          const idx = inCol.findIndex((x) => x.id === t.id)
          const nextIdx = Math.min(inCol.length - 1, Math.max(0, idx + vdir))
          dispatch({ type: 'SET_BOARD_FOCUS', id: inCol[nextIdx].id })
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, dispatch, run])

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        minWidth: 1100,
        minHeight: 680,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-app)',
        color: 'var(--t1)',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <TitleBar menus={menus} run={run} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {state.zen ? null : <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ErrorBoundary what={VIEW_NAME[state.view] ?? 'this view'} resetKey={`${state.view}:${state.taskId ?? ''}:${state.projectId ?? ''}`}>
          {state.view === 'dashboard' ? <Dashboard /> : null}
          {state.view === 'board' ? <Board /> : null}
          {state.view === 'agents' ? <Agents /> : null}
          {state.view === 'worktrees' ? <Worktrees /> : null}
          {state.view === 'workspace' ? <Workspace /> : null}
          {state.view === 'settings' ? <Settings /> : null}
          {state.view === 'notes' ? <Notes /> : null}
          {state.view === 'usage' ? <Usage /> : null}
          {state.view === 'team' ? <Team /> : null}
          {state.view === 'inbox' ? <Inbox /> : null}
          {state.view === 'summary' ? <Summary /> : null}
          {state.view === 'map' ? <RepoMap /> : null}
          {state.view === 'prs' ? <PullRequests /> : null}
          </ErrorBoundary>
        </div>
      </div>
      {state.zen ? <ZenExit onExit={() => dispatch({ type: 'SET_ZEN', on: false })} /> : <StatusBar />}
      <CommandPalette menus={menus} run={run} />
      <FilePreview />
      <StartTaskModal />
      <NewProjectModal />
      <IssuesModal />
      <TaskSheet />
      <OutsideModal />
      <ArchiveModal />
      <PluginInstallDialog />
      <ConfirmHost />
      <TextContextMenu />
      <Toast />
      <TooltipHost />
    </div>
  )
}

/**
 * Zen mode's way out: a small chip in the bottom-right corner (Escape is
 * the terminal's - an agent uses it to stop).
 */
function ZenExit({ onExit }: { onExit: () => void }): React.JSX.Element {
  const [hover, setHover] = React.useState(false)
  const key = shortcut('toggle-zen')
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onExit}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        right: 14,
        bottom: 12,
        zIndex: 40,
        height: 24,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 6,
        border: '1px solid var(--bd-3)',
        background: 'var(--bg-menu)',
        color: hover ? 'var(--t1)' : 'var(--t3)',
        font: '11.5px var(--font-ui)',
        opacity: hover ? 1 : 0.6,
        cursor: 'pointer',
        transition: 'opacity .12s'
      }}
    >
      Leave Zen mode
      {key ? <span style={{ font: '10.5px var(--font-mono)', color: 'var(--t4)' }}>{key}</span> : null}
    </button>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppStoreProvider>
      <Shell />
    </AppStoreProvider>
  )
}
