import React, { useEffect, useMemo, useState } from 'react'
import { plural } from '../lib/summary'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { statusColor, timeAgo } from '../lib/status'
import { agentShort, tasksForProject, staleWorktrees } from '../lib/derive'
import { useRealWorktrees } from '../lib/realGit'
import { askText } from '../lib/agentControl'
import type { AgentKind, Task } from '@shared/types'
import { AGENTS } from '@shared/constants'
import { Button, useContextMenu } from '../components/ui'
import { projectMenuItems } from '../lib/menus'
import { shortcut } from '../lib/shortcuts'

function NeedsCard({ task }: { task: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const project = state.projects.find((p) => p.id === task.projectId)!
  const border = task.st === 'failed' ? 'color-mix(in srgb, var(--c-red) 40%, transparent)' : 'color-mix(in srgb, var(--c-amber) 40%, transparent)'
  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })}
      {...hoverProps}
      style={{
        background: hover ? 'var(--bg-panel-2)' : 'var(--bg-panel)',
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: "12px var(--font-mono)" }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(task.st) }} />
        <span style={{ color: statusColor(task.st) }}>
          {agentShort(task.agentKind)} · {task.st === 'failed' ? 'failed' : 'needs you'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--t4)' }}>{timeAgo(task.lastActivityAt)}</span>
      </div>
      <div style={{ font: "500 14px var(--font-ui)" }}>
        {task.title} <span style={{ color: 'var(--t3)', fontWeight: 400 }}>· {project.name}</span>
      </div>
      <div style={{ font: "12.5px/1.45 var(--font-ui)", color: 'var(--t2)' }}>
        {askText(task)}
      </div>
    </div>
  )
}

function ProjectRow({ projectId, worktreeCount }: { projectId: string; worktreeCount: number }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const project = state.projects.find((p) => p.id === projectId)!
  const tasks = tasksForProject(state, projectId)
  const live = tasks.filter((t) => t.st === 'working' || t.st === 'waiting' || t.st === 'failed')
  const open = tasks.filter((t) => t.col !== 'done')
  const needs = tasks.filter((t) => t.st === 'waiting' || t.st === 'failed')
  const latest = tasks.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
  const ctx = useContextMenu(() => projectMenuItems(project, state.tasks, dispatch, { muted: state.prefs.mutedProjects }))

  return (
    <div
      onClick={() => dispatch({ type: 'NAV', view: 'board', projectId })}
      onContextMenu={ctx.onContextMenu}
      {...hoverProps}
      style={{
        display: 'grid',
        gridTemplateColumns: '2.2fr 0.9fr 0.8fr 1.1fr 3fr',
        gap: 20,
        alignItems: 'center',
        padding: '0 16px',
        height: 62,
        borderBottom: '1px solid var(--bd-row)',
        cursor: 'pointer',
        background: hover ? 'var(--bg-panel-3)' : 'transparent'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: "500 14px var(--font-ui)", color: needs.length ? 'var(--c-amber)' : 'var(--t1)' }}>
          {project.name}
        </span>
        <span
          style={{
            font: "12px var(--font-mono)",
            color: 'var(--t3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {project.repo} · {project.lang}
        </span>
      </div>
      <div style={{ font: "13px var(--font-mono)", color: 'var(--t2)' }}>
        <span style={{ color: live.length ? 'var(--c-green)' : 'var(--t2)' }}>{live.length}</span> active{' '}
        <span style={{ color: 'var(--t4)' }}>/ {open.length}</span>
      </div>
      <div style={{ font: "13px var(--font-mono)", color: 'var(--t2)' }}>{worktreeCount}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {live.map((t) => (
            <span key={t.id} style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(t.st) }} />
          ))}
        </div>
        {needs.length ? (
          <span style={{ font: "500 12px var(--font-mono)", color: 'var(--c-amber)' }}>{needs.length}</span>
        ) : live.length === 0 ? (
          <span style={{ font: "12px var(--font-mono)", color: 'var(--t4)' }}>idle</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', minWidth: 0 }}>
        <span
          style={{
            font: '13px var(--font-ui)',
            color: 'var(--t2)',
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {latest ? latest.title : 'No activity yet'}
        </span>
        {latest ? (
          <span style={{ font: "12px var(--font-mono)", color: 'var(--t4)', flex: 'none' }}>
            {timeAgo(latest.lastActivityAt)}
          </span>
        ) : null}
      </div>
      {ctx.menu}
    </div>
  )
}

export function Dashboard(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [jumpHover, jumpHoverProps] = useHover()
  const { data: allWorktrees } = useRealWorktrees(state.projects, state.tasks, 0)
  const stale = useMemo(() => staleWorktrees(allWorktrees, state.prefs.staleDays), [allWorktrees, state.prefs.staleDays])
  const needs = state.tasks
    .filter((t) => t.st === 'waiting' || t.st === 'failed')
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    .slice(0, 3)
  const totalAgents = state.tasks.filter((t) => t.st === 'working' || t.st === 'waiting' || t.st === 'failed').length
  const totalWorktrees = allWorktrees.length

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '28px 36px', gap: 28, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ font: "600 20px var(--font-ui)", letterSpacing: '-0.01em' }}>Projects</div>
        <div style={{ font: "12.5px var(--font-mono)", color: 'var(--t3)' }}>
          {plural(state.projects.length, 'repo')} · {plural(totalAgents, 'agent')} · {plural(totalWorktrees, 'worktree')}
        </div>
        <div style={{ flex: 1 }} />
        <div
          onClick={() => dispatch({ type: 'TOGGLE_PALETTE' })}
          {...jumpHoverProps}
          style={{
            height: 28,
            padding: '0 12px',
            border: `1px solid ${jumpHover ? 'var(--bd-5)' : 'var(--bd-3)'}`,
            borderRadius: 5,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 12.5,
            color: jumpHover ? 'var(--t1)' : 'var(--t2)',
            cursor: 'pointer'
          }}
        >
          Jump to… <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)' }}>{shortcut('find')}</span>
        </div>
      </div>

      {state.projects.length === 0 ? <Welcome /> : null}

      <div style={{ display: state.projects.length ? 'flex' : 'none', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ font: "500 13px var(--font-ui)", color: 'var(--c-amber)' }}>Needs you</span>
          <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>oldest first</span>
        </div>
        {needs.length === 0 ? (
          <div style={{ border: '1px solid var(--bd-2)', borderRadius: 6, padding: '14px 16px', font: '13px var(--font-ui)', color: 'var(--t3)' }}>
            Nothing is blocked. Agents are working or finished.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
            {needs.map((t) => (
              <NeedsCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: state.projects.length ? 'flex' : 'none', flexDirection: 'column' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2.2fr 0.9fr 0.8fr 1.1fr 3fr',
            gap: 20,
            padding: '0 16px 8px',
            font: "500 11px var(--font-mono)",
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--t4)',
            borderBottom: '1px solid var(--bd-1)'
          }}
        >
          <span>Project</span>
          <span>Tasks</span>
          <span>Worktrees</span>
          <span>Agents</span>
          <span>Recent activity</span>
        </div>
        {state.projects.map((p) => (
          <ProjectRow key={p.id} projectId={p.id} worktreeCount={allWorktrees.filter((w) => w.projectId === p.id).length} />
        ))}

      </div>

      <div style={{ flex: 1 }} />

      {stale.length > 0 ? (
        <div
          onClick={() => dispatch({ type: 'NAV', view: 'worktrees' })}
          style={{ display: 'flex', gap: 16, font: "12px var(--font-mono)", color: 'var(--t3)', cursor: 'pointer' }}
        >
          <span>{plural(stale.length, 'worktree')} to clean up → Worktrees</span>
        </div>
      ) : null}
    </div>
  )
}

/** The first run: what Switchyard is, the three steps to a running agent, and which agent CLIs it found. */
function Welcome(): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [installed, setInstalled] = useState<Partial<Record<AgentKind, boolean>> | null>(null)
  useEffect(() => {
    window.api.agents.detectInstalled().then(setInstalled).catch(() => setInstalled({}))
  }, [])
  const found = AGENTS.filter((a) => installed?.[a.kind])
  const steps: [string, string][] = [
    ['Add a repository', 'A local git repository, or a URL to clone. Switchyard reads its language, branch and commands.'],
    ['Write tasks on its board', `One card per piece of work${shortcut('new-task') ? ` (${shortcut('new-task')} on the board)` : ''} - a title, and a description the agent gets as its first message.`],
    ['Start an agent', 'Each task gets its own worktree and branch, so several agents work at once without stepping on each other. You review the changes and merge.']
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760, paddingTop: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ font: '600 24px var(--font-ui)', letterSpacing: '-0.015em' }}>Welcome to Switchyard</div>
        <div style={{ font: '14px/1.55 var(--font-ui)', color: 'var(--t3)', maxWidth: 620 }}>
          Run coding agents - Claude Code, Codex, Gemini and others - on many tasks in parallel, each in its own git worktree, and keep track of what needs you.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
        {steps.map(([title, body], i) => (
          <div key={title} style={{ border: '1px solid var(--bd-2)', borderRadius: 8, background: 'var(--bg-panel-2)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: '11px var(--font-mono)', color: i === 0 ? 'var(--c-blue)' : 'var(--t4)' }}>{i + 1}</span>
            <span style={{ font: '500 13.5px var(--font-ui)', color: 'var(--t1)' }}>{title}</span>
            <span style={{ font: '12.5px/1.5 var(--font-ui)', color: 'var(--t3)' }}>{body}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Button variant="primary" size="lg" hint={shortcut('new-project')} onClick={() => dispatch({ type: 'OPEN_ADD_PROJECT' })}>
          Add your first project
        </Button>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t4)' }}>
          {installed === null
            ? 'Looking for agent CLIs…'
            : found.length
              ? `Found on this computer: ${found.map((a) => a.name).join(', ')}`
              : 'No agent CLI found on this computer yet - install one (e.g. Claude Code: npm install -g @anthropic-ai/claude-code), then start a task.'}
        </span>
      </div>
    </div>
  )
}
