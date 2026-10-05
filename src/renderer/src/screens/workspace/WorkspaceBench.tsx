import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { statusColor, statusLabel } from '../../lib/status'
import { agentShort } from '../../lib/derive'
import { fileIcon } from '../../lib/fileLang'
import { revealLabel } from '../../lib/keys'
import { errText } from '../../lib/errors'
import { pastePathsInto } from '../../components/TerminalView'
import { agentSessionId } from '../../lib/agentControl'
import { checkoutsOf, taskRoot } from '../../lib/multiRepo'
import { baseOf } from '../../lib/stack'
import { useWorkspaceRequest } from '../../lib/workspaceBus'
import { activate, closeTab, focusGroup, groupsOf, splitGroup, type TabId, type ViewId, type Zone } from '../../lib/wsLayout'
import { addShell, closeShell, getLayout, renameShell, setLayout, showInWorkspace, syncShells, useBars, useLayout, useShells, wsOpen } from '../../lib/wsStore'
import type { MenuItem } from '../../components/ui'
import type { Project, ShellOption, Task } from '@shared/types'
import { EditorArea, type AddItem, type TabMeta } from './layout/EditorArea'
import { ActivityStrip, SidePanel, VIEW_LABEL } from './layout/SideBars'
import { PanelHeader, type PanelChrome } from './layout/PanelHeader'
import { FilesProvider, useFilesMaybe } from './files/FilesContext'
import { ExplorerView } from './files/ExplorerView'
import { SearchView } from './files/SearchView'
import { FileEditor } from './files/FileEditor'
import { ChangesProvider, useChangesMaybe } from './changes/ChangesContext'
import { ChangesView } from './changes/ChangesView'
import { DiffTab } from './changes/DiffTab'
import { TaskView } from './terminal/TaskView'
import { SessionsView } from './terminal/SessionsView'
import { ActivityView } from './terminal/ActivityView'
import { AgentTab, OutputTab, ShellTab } from './terminal/TerminalTabs'
import { WorkspacePreview, previewPortOf } from './WorkspacePreview'
import { WorkspaceNotes } from './WorkspaceNotes'
import { WorkspaceTimeline } from './WorkspaceTimeline'

// The last request (wsIntent) a workspace carried out - each is done once.
let appliedIntent = 0

/**
 * The task's workbench (VS Code's): activity bars and side bars on both
 * sides, editor groups between them. Its files and changes are shared by
 * the side bars and the tabs that show them.
 */
export function WorkspaceBench({ task, project }: { task: Task; project: Project }): React.JSX.Element {
  const { state } = useAppStore()
  const root = project.repoPath && task.worktreePath ? taskRoot(task) : null
  const bench = <Bench task={task} project={project} />
  if (!root) return bench
  // A task in several repositories: its folder, with each repository's base branch for the changes.
  const bases = task.taskDir ? Object.fromEntries(checkoutsOf(task, state.projects).map((c) => [c.dir, baseOf(task, c.project)])) : undefined
  return (
    <FilesProvider task={task} root={root} baseBranch={baseOf(task, project)} bases={bases}>
      <ChangesProvider task={task} project={project} root={root}>
        {bench}
      </ChangesProvider>
    </FilesProvider>
  )
}

function Bench({ task, project }: { task: Task; project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const layout = useLayout(task.id)
  const bars = useBars()
  const files = useFilesMaybe()
  const changes = useChangesMaybe()
  const shells = useShells(task.id)
  const root = taskRoot(task) ?? undefined
  const [profiles, setProfiles] = useState<ShellOption[]>([])
  const [renaming, setRenaming] = useState<{ id: TabId; value: string } | null>(null)
  const agent = agentShort(task.agentKind)

  // The shells the main process has for this task (after a reload, or coming back).
  useEffect(() => {
    syncShells(task.id)
  }, [task.id])
  useEffect(() => {
    window.api.sys.shells().then(setProfiles)
  }, [])

  // Asked from elsewhere (the board's "review changes", Worktrees' "Browse files"): done once.
  const [firstDiff, setFirstDiff] = useState(false)
  useEffect(() => {
    const i = state.wsIntent
    if (!i || i.n <= appliedIntent) return
    appliedIntent = i.n
    showInWorkspace(task.id, i.tab)
    if (i.tab === 'changes') setFirstDiff(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.wsIntent?.n])
  // The changes asked for: the first file's diff too, unless one is open.
  useEffect(() => {
    if (!firstDiff || !changes?.files) return
    setFirstDiff(false)
    if (groupsOf(getLayout(task.id).root).some((g) => g.tabs.some((t) => t.startsWith('diff:')))) return
    const first = changes.ordered[0]
    if (first) wsOpen(task.id, `diff:${first.path}`)
    // (ordered follows files.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDiff, changes?.files, task.id])
  // Ctrl+Shift+F.
  useWorkspaceRequest('search', task.id, () => files?.openSearch())

  const groups = groupsOf(layout.root)
  const focused = groups.find((g) => g.g === layout.focus)
  const showing = focused?.a ?? ''

  const meta = (id: TabId): TabMeta | null => {
    if (id === 'agent') return { label: agent || 'Agent', ic: '◆', icColor: 'var(--c-blue)', dot: task.agentKind ? statusColor(task.st) : undefined, tip: task.agentKind ? `${agent} session · ${statusLabel(task) || 'stopped'}` : 'No agent on this task' }
    if (id === 'setup') return { label: 'setup', ic: '›', icColor: 'var(--t3)', tip: 'The launch setup’s output' }
    if (id === 'tests') {
      const t = task.lastTest
      return { label: 'tests', ic: '›', icColor: 'var(--t3)', dot: !t ? undefined : t.status === 'running' ? 'var(--c-amber)' : t.status === 'passed' ? 'var(--c-green)' : 'var(--c-red)', tip: 'The tests’ output' }
    }
    if (id.startsWith('shell:')) {
      const s = shells.find((x) => x.id === id.slice(6))
      return { label: s?.name ?? 'shell', ic: '›', icColor: 'var(--t3)', tip: `Terminal · ${s?.cwd ?? root ?? ''} - double-click to rename` }
    }
    if (id.startsWith('file:')) {
      const path = id.slice(5)
      const name = path.split('/').pop() ?? path
      const [ic, icColor] = fileIcon(name)
      return { label: name, ic, icColor, dot: files?.isDirty(path) ? 'var(--t1)' : undefined, tip: path }
    }
    if (id.startsWith('diff:')) {
      const path = id.slice(5)
      return { label: path.split('/').pop() ?? path, sub: 'diff', ic: '±', icColor: 'var(--c-amber)', italic: true, tip: `Changes · ${path}` }
    }
    if (id === 'preview') {
      const port = previewPortOf(task.id)
      return { label: 'Preview', sub: port ? `:${port}` : undefined, ic: '◎', icColor: 'var(--c-green)', tip: 'Preview of this worktree' }
    }
    if (id === 'notes') return { label: 'Notes', ic: '¶', icColor: 'var(--t2)', tip: 'Notes linked to this task' }
    if (id === 'timeline') return { label: 'Timeline', ic: '↺', icColor: 'var(--t2)', tip: 'The agent’s turns - and undoing them' }
    return null
  }

  const noFolder = <Placeholder text="This task has no worktree yet." />
  const render = (id: TabId, gid: string, visible: boolean): React.ReactNode => {
    if (id === 'agent') return <AgentTab task={task} visible={visible} />
    if (id === 'setup' || id === 'tests') return <OutputTab task={task} kind={id} visible={visible} />
    if (id.startsWith('shell:')) return <ShellTab task={task} project={project} id={id.slice(6)} visible={visible} />
    if (id.startsWith('file:')) return files ? <FileEditor path={id.slice(5)} visible={visible} /> : noFolder
    if (id.startsWith('diff:')) return changes ? <DiffTab path={id.slice(5)} gid={gid} /> : noFolder
    if (id === 'preview') return <WorkspacePreview task={task} project={project} />
    if (id === 'notes') return <WorkspaceNotes task={task} />
    if (id === 'timeline') return <WorkspaceTimeline task={task} active={visible} />
    return null
  }

  /** Closing a tab in a group; a shell's process stops with it. */
  const close = (id: TabId, gid: string): void => {
    if (id.startsWith('shell:')) return closeShell(task.id, id.slice(6))
    setLayout(task.id, (L) => closeTab(L, id, gid))
  }

  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const tabMenu = (id: TabId, gid: string): MenuItem[] => {
    const g = groups.find((x) => x.g === gid)
    const tabs = g?.tabs ?? []
    const i = tabs.indexOf(id)
    const splitTo = (zone: 'right' | 'bottom'): void => setLayout(task.id, (L) => splitGroup(activate(L, gid, id), gid, zone) ?? L)
    const items: MenuItem[] = [
      { label: 'Close', onClick: () => close(id, gid) },
      { label: 'Close Others', disabled: tabs.length < 2, onClick: () => tabs.filter((t) => t !== id).forEach((t) => close(t, gid)) },
      { label: 'Close to the Right', disabled: i === tabs.length - 1, onClick: () => tabs.slice(i + 1).forEach((t) => close(t, gid)) },
      { label: 'Close All', onClick: () => tabs.forEach((t) => close(t, gid)) },
      { label: 'Split Right', separatorBefore: true, onClick: () => splitTo('right') },
      { label: 'Split Down', onClick: () => splitTo('bottom') }
    ]
    if (id.startsWith('shell:')) {
      const s = shells.find((x) => x.id === id.slice(6))
      items.push({ label: 'Rename…', separatorBefore: true, onClick: () => setRenaming({ id, value: s?.name ?? '' }) })
    }
    if (files && (id.startsWith('file:') || id.startsWith('diff:'))) {
      const path = id.slice(5)
      items.push(
        ...(id.startsWith('diff:') ? [{ label: 'Open File', separatorBefore: true, onClick: () => wsOpen(task.id, `file:${path}`, gid) }] : [{ label: 'Open Changes', separatorBefore: true, onClick: () => wsOpen(task.id, `diff:${path}`, gid) }]),
        { label: 'Copy Path', separatorBefore: true, onClick: () => window.api.sys.copy(files.abs(path)) },
        { label: 'Copy Relative Path', onClick: () => window.api.sys.copy(path) },
        { label: 'Reveal in Explorer View', separatorBefore: true, onClick: () => files.reveal(path) },
        { label: revealLabel, onClick: () => window.api.sys.showItem(files.abs(path)).catch(toastErr) }
      )
    }
    return items
  }

  const newShellIn = (gid: string, profile?: ShellOption): void => {
    setLayout(task.id, (L) => focusGroup(L, gid))
    addShell(task.id, { profile, taskRoot: root })
  }
  const addItems = (gid: string): AddItem[] => [
    { label: `${agent || 'Agent'} session`, glyph: '◆', glyphColor: 'var(--c-blue)', onClick: () => wsOpen(task.id, 'agent', gid) },
    { label: 'New terminal', glyph: '›', glyphColor: 'var(--t2)', onClick: () => newShellIn(gid) },
    ...profiles.map((p, i) => ({ label: `New terminal · ${p.label}`, glyph: '›', glyphColor: 'var(--t4)', extra: true, separatorBefore: i === 0, onClick: () => newShellIn(gid, p) })),
    { label: 'Preview', glyph: '◎', glyphColor: 'var(--c-green)', separatorBefore: true, onClick: () => wsOpen(task.id, 'preview', gid) },
    { label: 'Notes', glyph: '¶', glyphColor: 'var(--t2)', onClick: () => wsOpen(task.id, 'notes', gid) },
    { label: 'Timeline', glyph: '↺', glyphColor: 'var(--t2)', onClick: () => wsOpen(task.id, 'timeline', gid) }
  ]

  const view = (id: ViewId, chrome: PanelChrome): React.ReactNode => {
    switch (id) {
      case 'task':
        return <TaskView task={task} project={project} chrome={chrome} />
      case 'explorer':
        return files ? <ExplorerView chrome={chrome} activePath={showing.startsWith('file:') ? showing.slice(5) : null} /> : <NoFolderView id={id} chrome={chrome} />
      case 'search':
        return files ? <SearchView chrome={chrome} /> : <NoFolderView id={id} chrome={chrome} />
      case 'changes':
        return changes && root ? <ChangesView chrome={chrome} root={root} activeDiff={showing.startsWith('diff:') ? showing.slice(5) : null} /> : <NoFolderView id={id} chrome={chrome} />
      case 'sessions':
        return <SessionsView task={task} layout={layout} chrome={chrome} />
      case 'activity':
        return <ActivityView task={task} chrome={chrome} />
    }
  }

  const badges: Partial<Record<ViewId, number>> = { changes: changes?.files?.length ?? 0 }
  const zen = state.zen
  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', position: 'relative' }}>
      {zen ? null : (
        <>
          <ActivityStrip side="L" bars={bars} badges={badges} />
          <SidePanel side="L" bars={bars}>
            {(chrome) => view(bars.open.L!, chrome)}
          </SidePanel>
        </>
      )}
      <EditorArea
        taskId={task.id}
        layout={layout}
        meta={meta}
        render={render}
        close={close}
        addItems={addItems}
        tabMenu={tabMenu}
        splitEmpty={(gid: string, zone: Exclude<Zone, 'center'>) => addShell(task.id, { taskRoot: root, beside: { gid, zone } })}
        typePaths={(id, paths) => pastePathsInto(id === 'agent' ? agentSessionId(task.id) : id.slice(6), paths)}
        rename={{
          id: renaming?.id ?? '',
          value: renaming?.value ?? null,
          start: (id) => setRenaming({ id, value: shells.find((s) => `shell:${s.id}` === id)?.name ?? '' }),
          onChange: (value) => setRenaming((r) => (r ? { ...r, value } : r)),
          onDone: (save) => {
            if (save && renaming && renaming.value.trim()) renameShell(task.id, renaming.id.slice(6), renaming.value.trim())
            setRenaming(null)
          }
        }}
      />
      {zen ? null : (
        <>
          <SidePanel side="R" bars={bars}>
            {(chrome) => view(bars.open.R!, chrome)}
          </SidePanel>
          <ActivityStrip side="R" bars={bars} badges={badges} />
        </>
      )}
    </div>
  )
}

function NoFolderView({ id, chrome }: { id: ViewId; chrome: PanelChrome }): React.JSX.Element {
  return (
    <>
      <PanelHeader title={VIEW_LABEL[id]} chrome={chrome} />
      <div style={{ padding: '6px 18px', font: '12.5px/1.5 var(--font-ui)', color: 'var(--t4)' }}>This task has no worktree yet - its files show here once it starts.</div>
    </>
  )
}

function Placeholder({ text }: { text: string }): React.JSX.Element {
  return <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t4)', fontSize: 13 }}>{text}</div>
}
