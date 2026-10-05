import React from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { statusColor } from '../lib/status'
import { agentShort, liveTasks } from '../lib/derive'
import { shortcut } from '../lib/shortcuts'
import { NoticeBell } from './NoticeCenter'

function AgentChip({ taskId }: { taskId: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const task = state.tasks.find((t) => t.id === taskId)!
  return (
    <span
      onClick={() => dispatch({ type: 'OPEN_TASK', taskId })}
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: hover ? 'var(--t1)' : 'var(--t2)',
        cursor: 'pointer'
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(task.st) }} />
      {task.key} · {agentShort(task.agentKind)}
    </span>
  )
}

export function StatusBar(): React.JSX.Element {
  const { state } = useAppStore()
  const live = liveTasks(state)

  const queued = state.tasks.filter((t) => t.queued).length
  let ctx = `${live.filter((t) => t.st === 'working').length} working · ${
    live.filter((t) => t.st === 'waiting' || t.st === 'failed').length
  } need you${queued ? ` · ${queued} queued` : ''}`

  if (state.view === 'workspace' && state.taskId) {
    const task = state.tasks.find((t) => t.id === state.taskId)
    if (task?.branch) ctx = task.branch
  } else if (state.view === 'board' && state.projectId) {
    const project = state.projects.find((p) => p.id === state.projectId)
    if (project) ctx = `${project.name} · ${project.defaultBranch ?? 'main'}`
  }

  return (
    <div
      style={{
        height: 26,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 14px',
        background: 'var(--bg-chrome)',
        borderTop: '1px solid var(--bd-1)',
        fontSize: 12
      }}
    >
      {/* The running agents (a label only when there are some to label). */}
      {live.length ? <span style={{ color: 'var(--t4)' }}>agents</span> : null}
      <div style={{ display: 'flex', gap: 12 }}>
        {live.slice(0, 6).map((t) => (
          <AgentChip key={t.id} taskId={t.id} />
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ color: 'var(--t2)' }}>{ctx}</span>
      {shortcut('next-blocked') ? <span style={{ color: 'var(--t5)' }}>{shortcut('next-blocked')} next blocked</span> : null}
      <NoticeBell />
    </div>
  )
}
