import React, { useEffect, useRef, useState } from 'react'
import type { AgentStatus, Project, Task } from '@shared/types'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { needsYou, statusColor } from '../lib/status'
import { liveTasks, tasksForProject, agentShort } from '../lib/derive'
import { IconButton, useContextMenu } from './ui'
import { folderItems, projectMenuItems, taskMenuItems } from '../lib/menus'
import { scratchId } from '@shared/scratch'
import { inParens, shortcut } from '../lib/shortcuts'
import { prefsFor } from '../lib/projectPrefs'
import { useInboxItems } from '../lib/inbox'
import { summaryUnseen, useActivity } from '../lib/activity'
import { toggleSidebar, useSidebarMini } from '../lib/sidebarMini'

const NAV_ICONS: Record<string, React.JSX.Element> = {
  projects: (
    <>
      <rect x="1.8" y="1.8" width="4.2" height="4.2" rx="1" />
      <rect x="8" y="1.8" width="4.2" height="4.2" rx="1" />
      <rect x="1.8" y="8" width="4.2" height="4.2" rx="1" />
      <rect x="8" y="8" width="4.2" height="4.2" rx="1" />
    </>
  ),
  agents: (
    <>
      <rect x="1.5" y="2.2" width="11" height="9.6" rx="1.4" />
      <path d="m4.2 5.6 1.8 1.4-1.8 1.4M7.4 9h2.4" />
    </>
  ),
  worktrees: (
    <>
      <circle cx="4" cy="3" r="1.3" />
      <circle cx="4" cy="11" r="1.3" />
      <circle cx="10.5" cy="4.6" r="1.3" />
      <path d="M4 4.3v5.4M10.5 5.9c0 2.4-2.2 2.9-4.4 3.3-.9.2-1.6.5-2 1" />
    </>
  ),
  usage: (
    <>
      <path d="M1.8 12.2h10.4" />
      <path d="M3.4 12.2V8.4M6.2 12.2V4.6M9 12.2V7M11.8 12.2V2.6" />
    </>
  ),
  inbox: (
    <>
      <path d="M1.8 8.2 3.4 2.6a.9.9 0 0 1 .9-.7h5.4a.9.9 0 0 1 .9.7l1.6 5.6v3a.8.8 0 0 1-.8.8H2.6a.8.8 0 0 1-.8-.8z" />
      <path d="M1.8 8.2h3l.8 1.4h2.8l.8-1.4h3" />
    </>
  ),
  team: (
    <>
      <path d="M2 3.2h6.6a.8.8 0 0 1 .8.8v3.4a.8.8 0 0 1-.8.8H5.2L3 10V8.2H2a.8.8 0 0 1-.8-.8V4a.8.8 0 0 1 .8-.8z" />
      <path d="M10.6 5.6h1.4a.8.8 0 0 1 .8.8v3.2a.8.8 0 0 1-.8.8h-.8v1.6L9.2 10.4H7" />
    </>
  ),
  prs: (
    <>
      <circle cx="3.6" cy="3.2" r="1.5" />
      <circle cx="3.6" cy="10.8" r="1.5" />
      <circle cx="10.4" cy="10.8" r="1.5" />
      <path d="M3.6 4.7v4.6M10.4 9.3V6.4a2 2 0 0 0-2-2H6.2" />
      <path d="M7.6 3.1 6.1 4.4l1.5 1.3" />
    </>
  ),
  map: (
    <>
      <rect x="1.6" y="1.6" width="10.8" height="10.8" rx="1.2" />
      <path d="M6.4 1.6v10.8M6.4 7.4h6M9.4 7.4v5" />
    </>
  ),
  summary: (
    <>
      <path d="M1.5 10.4h11M3.2 12.4h7.6" />
      <path d="M3.6 10.4a3.4 3.4 0 0 1 6.8 0" />
      <path d="M7 3.2v1.4M2.8 5.4l1 1M11.2 5.4l-1 1" />
    </>
  ),
  notes: (
    <>
      <path d="M3.5 1.5h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <path d="M4.8 4.6h4.4M4.8 7h4.4M4.8 9.4h2.6" />
    </>
  )
}

function NavIcon({ name }: { name: keyof typeof NAV_ICONS }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
      {NAV_ICONS[name]}
    </svg>
  )
}

function NavRow({
  icon,
  label,
  shortcut,
  active,
  badge,
  dot,
  onClick
}: {
  icon: keyof typeof NAV_ICONS
  label: string
  shortcut: string
  active: boolean
  badge?: number
  /** Something new to look at. */
  dot?: string
  onClick: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 28,
        padding: '0 10px',
        borderRadius: 5,
        background: active ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : hover ? 'color-mix(in srgb, var(--ov) 5%, transparent)' : 'transparent',
        color: active ? 'var(--t1)' : 'var(--t2)',
        fontSize: 13,
        cursor: 'pointer'
      }}
    >
      <span style={{ display: 'flex', color: active ? 'var(--t1)' : 'var(--t3)' }}>
        <NavIcon name={icon} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {dot ? <span title={dot} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c-blue)' }} /> : null}
      {badge ? (
        <span
          style={{
            font: "600 10.5px/16px var(--font-mono)",
            color: 'var(--bg-chrome)',
            background: 'var(--c-amber)',
            borderRadius: 3,
            padding: '0 5px'
          }}
        >
          {badge}
        </span>
      ) : null}
      <span style={{ font: "11px var(--font-mono)", color: 'var(--t5)' }}>{shortcut}</span>
    </div>
  )
}

const ST_ORDER: Record<NonNullable<AgentStatus>, number> = { failed: 0, waiting: 1, working: 2, paused: 3, done: 4 }

/** The project's tasks in progress, and any others with an agent (in review), the ones needing you first. */
function agentTasks(tasks: Task[]): Task[] {
  // (A paused agent - or one stopped by a restart - is still in progress.)
  const rank = (t: Task): number => (t.st ? ST_ORDER[t.st] : ST_ORDER.paused)
  return tasks.filter((t) => t.col === 'progress' || (t.agentKind && t.st)).sort((a, b) => rank(a) - rank(b))
}

function ProjectRow({ projectId }: { projectId: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const project = state.projects.find((p) => p.id === projectId)!
  const tasks = tasksForProject(state, projectId)
  const live = agentTasks(tasks)
  const active = state.view === 'board' && state.projectId === projectId
  const worst = live[0]
  const ctx = useContextMenu(() => projectMenuItems(project, state.tasks, dispatch, { muted: state.prefs.mutedProjects }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {ctx.menu}
      <div
        onClick={() => dispatch({ type: 'NAV', view: 'board', projectId })}
        onContextMenu={ctx.onContextMenu}
        {...hoverProps}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          height: 28,
          padding: '0 10px',
          borderRadius: 5,
          background: active ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : hover ? 'color-mix(in srgb, var(--ov) 5%, transparent)' : 'transparent',
          color: active ? 'var(--t1)' : 'var(--t2)',
          fontSize: 13,
          cursor: 'pointer'
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: worst ? statusColor(worst.st) : 'var(--bd-4)',
            flex: 'none'
          }}
        />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.name}
        </span>
        <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)' }}>{tasks.length}</span>
      </div>
      <div
        style={{
          margin: '2px 0 6px 13px',
          borderLeft: '1px solid var(--bd-1)',
          paddingLeft: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 1
        }}
      >
        {project.repoPath ? <ScratchRow project={project} /> : null}
        {live.map((t) => (
          <TaskRow key={t.id} taskId={t.id} />
        ))}
      </div>
    </div>
  )
}

/** The project's scratchpad: terminals, agents and files in its own folder, outside any task. */
function ScratchRow({ project }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const task = state.tasks.find((t) => t.id === scratchId(project.id))
  const active = state.view === 'workspace' && state.taskId === scratchId(project.id)
  const live = !!task?.agentKind && (task.st === 'working' || task.st === 'waiting' || task.st === 'failed')
  const ctx = useContextMenu(() => (task ? taskMenuItems(task, project, prefsFor(state, project.id), dispatch, { projects: state.projects }) : folderItems(project.repoPath, dispatch)))
  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_SCRATCH', projectId: project.id })}
      onContextMenu={ctx.onContextMenu}
      title={`Terminals, agents and files in ${project.repoPath} - outside any task`}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 8px',
        borderRadius: 5,
        background: active ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : hover ? 'color-mix(in srgb, var(--ov) 5%, transparent)' : 'transparent',
        color: active ? 'var(--t1)' : 'var(--t3)',
        fontSize: 12.5,
        cursor: 'pointer'
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 1.5, border: `1px solid ${live ? statusColor(task!.st) : 'var(--bd-5)'}`, background: live ? statusColor(task!.st) : 'transparent', flex: 'none', boxSizing: 'border-box' }} />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Scratchpad</span>
      {task?.agentKind ? <span style={{ font: '10.5px var(--font-mono)', color: live ? statusColor(task.st) : 'var(--t4)' }}>{agentShort(task.agentKind)}</span> : null}
      {ctx.menu}
    </div>
  )
}

function TaskRow({ taskId }: { taskId: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const task = state.tasks.find((t) => t.id === taskId)!
  const active = state.view === 'workspace' && state.taskId === taskId
  const ctx = useContextMenu(() => taskMenuItems(task, state.projects.find((p) => p.id === task.projectId), prefsFor(state, task.projectId), dispatch, { projects: state.projects }))
  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_TASK', taskId })}
      onContextMenu={ctx.onContextMenu}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 8px',
        borderRadius: 5,
        background: active ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : hover ? 'color-mix(in srgb, var(--ov) 5%, transparent)' : 'transparent',
        color: active ? 'var(--t1)' : 'var(--t2)',
        fontSize: 12.5,
        cursor: 'pointer'
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(task.st), flex: 'none' }} />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {task.title}
      </span>
      <span style={{ font: "10.5px var(--font-mono)", color: statusColor(task.st) }}>
        {task.st === 'done' ? '✓' : agentShort(task.agentKind)}
      </span>
      {ctx.menu}
    </div>
  )
}

type NavItem = { icon: keyof typeof NAV_ICONS; label: string; key: string; active: boolean; badge?: number; dot?: string; onClick: () => void }

function useNav(): NavItem[] {
  const { state, dispatch } = useAppStore()
  const needsCount = liveTasks(state).filter(needsYou).length
  // What waits on you, everywhere (the Inbox).
  const inboxCount = useInboxItems().length
  const activity = useActivity()
  const v = state.view
  const nav = (icon: NavItem['icon'], label: string, view: typeof v, more: Partial<NavItem> = {}): NavItem => ({
    icon,
    label,
    key: shortcut(`nav-${icon === 'projects' ? 'dashboard' : icon}`),
    active: v === view,
    onClick: () => dispatch({ type: 'NAV', view }),
    ...more
  })
  return [
    nav('projects', 'Projects', 'dashboard'),
    nav('agents', 'Agents', 'agents', { badge: needsCount || undefined }),
    nav('worktrees', 'Worktrees', 'worktrees'),
    nav('prs', 'Pull requests', 'prs'),
    nav('notes', 'Notes', 'notes', { onClick: () => dispatch({ type: 'OPEN_NOTE', id: null }) }),
    nav('usage', 'Usage', 'usage'),
    nav('team', 'Team', 'team'),
    nav('inbox', 'Inbox', 'inbox', { badge: inboxCount || undefined }),
    nav('summary', 'Summary', 'summary', { dot: summaryUnseen(activity, state.prefs, Date.now()) ? 'Today’s summary is ready' : undefined }),
    nav('map', 'Map', 'map')
  ]
}

function useUser(): { user: string | null; codeHome: string } {
  const { state } = useAppStore()
  const [user, setUser] = useState<string | null>(null)
  const [cloneDir, setCloneDir] = useState('')
  useEffect(() => {
    window.api.repos.userName().then(setUser)
  }, [])
  // Where projects live (the clone folder follows them), shown home-relative.
  useEffect(() => {
    window.api.repos.cloneDir().then(setCloneDir)
  }, [state.projects.length, state.prefs.cloneDir])
  const home = window.api.sys.homeDir
  return { user, codeHome: cloneDir.toLowerCase().startsWith(home.toLowerCase()) ? '~' + cloneDir.slice(home.length).replace(/\\/g, '/') : cloneDir }
}

const SIDEBAR_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
    <path d="M5 2v10" />
  </svg>
)

export function Sidebar(): React.JSX.Element {
  const mini = useSidebarMini()
  return mini ? <MiniSidebar /> : <FullSidebar />
}

function FullSidebar(): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [searchHover, searchHoverProps] = useHover()
  const [footHover, footHoverProps] = useHover()
  const { user, codeHome } = useUser()
  const nav = useNav()

  return (
    <div
      style={{
        width: 232,
        flex: 'none',
        background: 'var(--bg-chrome)',
        borderRight: '1px solid var(--bd-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        color: 'var(--t2)'
      }}
    >
      <div style={{ padding: '10px 10px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })}
          {...searchHoverProps}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 30,
            padding: '0 10px',
            border: `1px solid ${searchHover ? 'var(--bd-5)' : 'var(--bd-2)'}`,
            borderRadius: 6,
            background: 'var(--bg-panel-3)',
            color: 'var(--t3)',
            fontSize: 12.5,
            cursor: 'pointer'
          }}
        >
          <span style={{ flex: 1 }}>Search or run…</span>
          <span style={{ font: "11px var(--font-mono)" }}>{shortcut('find')}</span>
        </div>
        <RailButton w={30} title={`Collapse sidebar${inParens('toggle-sidebar')}`} onClick={toggleSidebar}>
          {SIDEBAR_ICON}
        </RailButton>
      </div>
      <div style={{ padding: '4px 8px 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {nav.map((n) => (
          <NavRow key={n.icon} icon={n.icon} label={n.label} shortcut={n.key} active={n.active} badge={n.badge} dot={n.dot} onClick={n.onClick} />
        ))}
      </div>
      <ProjectsHeading padding="8px 18px 6px" />
      <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <ProjectList />
      </div>
      <div
        style={{
          borderTop: '1px solid var(--bd-1)',
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12.5,
          cursor: 'pointer',
          background: footHover ? 'color-mix(in srgb, var(--ov) 3%, transparent)' : 'transparent'
        }}
        onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: 'general' })}
        {...footHoverProps}
        title="Preferences"
      >
        <Avatar user={user} />
        <span style={{ flex: 1, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(user?.split(' ')[0] ?? 'you').toLowerCase()} · {codeHome}
        </span>
        <span style={{ font: "11px var(--font-mono)", color: 'var(--t5)' }}>{shortcut('preferences')}</span>
      </div>
    </div>
  )
}

function ProjectsHeading({ padding }: { padding: string }): React.JSX.Element {
  const { dispatch } = useAppStore()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding,
        font: "500 11px var(--font-mono)",
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--t4)'
      }}
    >
      <span style={{ flex: 1 }}>Projects</span>
      <AddProjectButton onClick={() => dispatch({ type: 'OPEN_ADD_PROJECT' })} />
    </div>
  )
}

function ProjectList(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  return (
    <>
      {state.projects.map((p) => (
        <ProjectRow key={p.id} projectId={p.id} />
      ))}
      {state.projects.length === 0 ? (
        <span onClick={() => dispatch({ type: 'OPEN_ADD_PROJECT' })} style={{ padding: '4px 10px', font: '12.5px/1.5 var(--font-ui)', color: 'var(--t4)', cursor: 'pointer' }}>
          None yet - <span style={{ color: 'var(--c-blue)' }}>add a repository</span>
        </span>
      ) : null}
    </>
  )
}

function Avatar({ user }: { user: string | null }): React.JSX.Element {
  return (
    <span style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'var(--bd-2)', color: 'var(--t2)', font: "600 10.5px/22px var(--font-ui)", textAlign: 'center' }}>
      {initials(user)}
    </span>
  )
}

/** A square icon button on the rail (and the collapse button beside the search box). */
function RailButton({
  w = 34,
  h = 30,
  title,
  active,
  onClick,
  style,
  children
}: {
  w?: number
  h?: number
  title: string
  active?: boolean
  onClick: () => void
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      onClick={onClick}
      title={title}
      {...hoverProps}
      style={{
        width: w,
        height: h,
        flex: 'none',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        background: hover ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : active ? 'color-mix(in srgb, var(--ov) 7%, transparent)' : 'transparent',
        color: hover || active ? 'var(--t1)' : 'var(--t3)',
        ...style
      }}
    >
      {children}
    </span>
  )
}

/** The collapsed sidebar: a rail of icons; hovering the projects shows them (and their agents' tasks) beside it. */
function MiniSidebar(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const { user } = useUser()
  const nav = useNav()
  const [footHover, footHoverProps] = useHover()
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null)
  const projectsRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const popIn = (): void => {
    window.clearTimeout(closeTimer.current)
    const r = projectsRef.current?.getBoundingClientRect()
    if (r && !pop) setPop({ left: r.right - 6, top: r.top - 6 })
  }
  const popOut = (): void => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setPop(null), 180)
  }

  return (
    <div
      style={{
        width: 52,
        flex: 'none',
        background: 'var(--bg-chrome)',
        borderRight: '1px solid var(--bd-1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: 0,
        color: 'var(--t2)',
        padding: '10px 0 0',
        gap: 2,
        position: 'relative',
        zIndex: 12
      }}
    >
      <RailButton title={`Expand sidebar${inParens('toggle-sidebar')}`} onClick={toggleSidebar}>
        {SIDEBAR_ICON}
      </RailButton>
      <RailButton title={`Search or run${inParens('find')}`} onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })} style={{ marginBottom: 6 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3.5 3.5" />
        </svg>
      </RailButton>
      {nav.map((n) => (
        <RailButton key={n.icon} h={32} title={`${n.label}${n.key ? ` (${n.key})` : ''}`} active={n.active} onClick={n.onClick}>
          <NavIcon name={n.icon} />
          {n.badge ? (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 1,
                minWidth: 14,
                height: 14,
                boxSizing: 'border-box',
                padding: '0 3px',
                borderRadius: 7,
                background: 'var(--c-amber)',
                color: 'var(--bg-chrome)',
                font: "600 9.5px/14px var(--font-mono)",
                textAlign: 'center',
                boxShadow: '0 0 0 2px var(--bg-chrome)'
              }}
            >
              {n.badge > 99 ? '99+' : n.badge}
            </span>
          ) : n.dot ? (
            <span title={n.dot} style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--c-blue)', boxShadow: '0 0 0 2px var(--bg-chrome)' }} />
          ) : null}
        </RailButton>
      ))}
      <div style={{ width: 24, height: 1, flex: 'none', background: 'var(--bd-1)', margin: '8px 0' }} />
      {/* The rest of the rail (scrolls when there are many) - only the icons themselves open the list. */}
      <div style={{ flex: 1, minHeight: 0, width: '100%', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none' }}>
        <div ref={projectsRef} onMouseEnter={state.projects.length ? popIn : undefined} onMouseLeave={popOut} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%' }}>
          {state.projects.map((p) => (
            <MiniProject key={p.id} projectId={p.id} />
          ))}
          {state.projects.length === 0 ? (
            <RailButton title="New project" onClick={() => dispatch({ type: 'OPEN_ADD_PROJECT' })} style={{ fontSize: 15 }}>
              +
            </RailButton>
          ) : null}
        </div>
      </div>
      {pop && state.projects.length > 0 ? (
        <div
          onMouseEnter={popIn}
          onMouseLeave={popOut}
          style={{ position: 'fixed', left: pop.left, top: pop.top, paddingLeft: 6, zIndex: 900 }}
        >
          <div
            style={{
              width: 260,
              maxHeight: `min(520px, calc(100vh - ${pop.top + 12}px))`,
              overflow: 'auto',
              boxSizing: 'border-box',
              background: 'var(--bg-menu)',
              border: '1px solid var(--bd-4)',
              borderRadius: 8,
              boxShadow: '0 16px 40px color-mix(in srgb, var(--sh) 55%, transparent)',
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 1
            }}
          >
            <ProjectsHeading padding="4px 10px 6px" />
            <ProjectList />
          </div>
        </div>
      ) : null}
      <span
        onClick={() => dispatch({ type: 'OPEN_SETTINGS', section: 'general' })}
        title={`Preferences${inParens('preferences')}`}
        {...footHoverProps}
        style={{
          width: 52,
          height: 46,
          flex: 'none',
          borderTop: '1px solid var(--bd-1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: footHover ? 'color-mix(in srgb, var(--ov) 3%, transparent)' : 'transparent'
        }}
      >
        <Avatar user={user} />
      </span>
    </div>
  )
}

function MiniProject({ projectId }: { projectId: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const project = state.projects.find((p) => p.id === projectId)!
  const worst = agentTasks(tasksForProject(state, projectId))[0]
  const ini = project.name
    .split(/[-_ .]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
  return (
    <RailButton
      title={project.name}
      active={state.projectId === projectId}
      onClick={() => dispatch({ type: 'NAV', view: 'board', projectId })}
      style={{ font: "600 11px var(--font-mono)", textTransform: 'uppercase' }}
    >
      {ini}
      <span style={{ position: 'absolute', bottom: 4, right: 5, width: 6, height: 6, borderRadius: '50%', background: worst ? statusColor(worst.st) : 'var(--bd-4)', boxShadow: '0 0 0 2px var(--bg-chrome)' }} />
    </RailButton>
  )
}

function initials(name: string | null): string {
  if (!name) return '·'
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function AddProjectButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <IconButton size={18} title={`New project${inParens('new-project')}`} onClick={onClick} style={{ fontSize: 15, color: 'var(--t3)' }}>
      +
    </IconButton>
  )
}
