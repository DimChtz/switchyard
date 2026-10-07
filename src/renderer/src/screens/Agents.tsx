import React from 'react'
import { inParens } from '../lib/shortcuts'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { statusColor, timeAgo, TEST_COLOR, TEST_LABEL } from '../lib/status'
import { blockedTasks, workingTasks, doneTasks, agentShort, busyAgents, queuedTasks } from '../lib/derive'
import { usePtyTail } from '../lib/ptyTail'
import { askText } from '../lib/agentControl'
import type { Task } from '@shared/types'
import { whereLabel } from '@shared/scratch'
import { Button, useContextMenu } from '../components/ui'
import { taskMenuItems } from '../lib/menus'
import { shortcut } from '../lib/shortcuts'
import { prefsFor } from '../lib/projectPrefs'

const FILTERS: { id: AppFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs', label: 'Needs you' },
  { id: 'working', label: 'Working' },
  { id: 'done', label: 'Done' }
]

type AppFilter = 'all' | 'needs' | 'working' | 'done'

/** "Y/N approve oldest · R send failure back · O open · Ctrl+J next", with the keys in effect. */
function keysLine(): string {
  const k = (id: string): string => shortcut(id)
  const yn = [k('agent-approve'), k('agent-deny')].filter(Boolean).join('/')
  return [yn && `${yn} approve oldest`, k('agent-retry') && `${k('agent-retry')} send failure back`, k('agent-open') && `${k('agent-open')} open`, k('next-blocked') && `${k('next-blocked')} next`]
    .filter(Boolean)
    .join(' · ')
}

function BlockedCard({ task }: { task: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const project = state.projects.find((p) => p.id === task.projectId)!
  const border = task.st === 'failed' ? 'color-mix(in srgb, var(--c-red) 40%, transparent)' : 'color-mix(in srgb, var(--c-amber) 40%, transparent)'
  const lines = usePtyTail(`agent-${task.id}`, 5)
  const ctx = useContextMenu(() => taskMenuItems(task, project, prefsFor(state, task.projectId), dispatch, { projects: state.projects }))

  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })}
      onContextMenu={ctx.onContextMenu}
      style={{
        background: 'var(--bg-panel)',
        border: `1px solid ${border}`,
        borderRadius: 7,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer'
      }}
    >
      <div style={{ padding: '12px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: "12px var(--font-mono)" }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(task.st) }} />
          <span style={{ color: 'var(--t1)' }}>{agentShort(task.agentKind)}</span>
          <span style={{ color: statusColor(task.st) }}>{task.st === 'failed' ? 'failed' : 'waiting'}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--t4)' }}>{timeAgo(task.lastActivityAt)}</span>
        </div>
        <div style={{ font: '500 14.5px var(--font-ui)' }}>{task.title}</div>
        <div style={{ font: "11.5px var(--font-mono)", color: 'var(--t3)' }}>
          {project.name} · {whereLabel(task)}
        </div>
      </div>
      <div
        style={{
          background: 'var(--bg-console)',
          borderTop: '1px solid var(--bd-1)',
          borderBottom: '1px solid var(--bd-1)',
          padding: '10px 14px',
          font: "11.5px/18px var(--font-mono)",
          height: 110,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        <PreviewLines lines={lines} />
        {ctx.menu}
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: '13px/1.45 var(--font-ui)', color: 'var(--t1)' }}>
          {askText(task)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {task.st === 'waiting' && task.askKind === 'permission' ? (
            <>
              <ActionBtn label="Yes" hint={shortcut('agent-approve')} onClick={() => dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'yes' })} primary />
              <ActionBtn label="No" hint={shortcut('agent-deny')} onClick={() => dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'no' })} />
            </>
          ) : task.st === 'failed' ? (
            <ActionBtn
              label={`Send failure to ${agentShort(task.agentKind)}`}
              hint={shortcut('agent-retry')}
              onClick={() => dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'retry' })}
              primary
            />
          ) : null}
          <ActionBtn
            label={task.st === 'waiting' && task.askKind !== 'permission' ? 'Reply' : 'Open'}
            hint={shortcut('agent-open')}
            onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })}
            primary={task.st === 'waiting' && task.askKind !== 'permission'}
          />
        </div>
      </div>
    </div>
  )
}

function ActionBtn({
  label,
  hint,
  onClick,
  primary
}: {
  label: string
  hint: string
  onClick: () => void
  primary?: boolean
}): React.JSX.Element {
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      hint={hint}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {label}
    </Button>
  )
}

function PreviewLines({ lines }: { lines: string[] | null }): React.JSX.Element {
  if (!lines) return <div style={{ color: 'var(--t4)' }}>Agent not running in this window.</div>
  if (lines.length === 0) return <div style={{ color: 'var(--t4)' }}>No output yet.</div>
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} style={{ color: 'var(--t2)', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {l}
        </div>
      ))}
    </>
  )
}

function WorkingCard({ task }: { task: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [hover, hoverProps] = useHover()
  const project = state.projects.find((p) => p.id === task.projectId)!
  const lines = usePtyTail(`agent-${task.id}`, 4)
  const ctx = useContextMenu(() => taskMenuItems(task, project, prefsFor(state, task.projectId), dispatch, { projects: state.projects }))
  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_TASK', taskId: task.id })}
      onContextMenu={ctx.onContextMenu}
      {...hoverProps}
      style={{
        background: 'var(--bg-panel-3)',
        border: `1px solid ${hover ? 'var(--bd-5)' : 'var(--bd-2)'}`,
        borderRadius: 7,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer'
      }}
    >
      <div style={{ padding: '12px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(task.st) }} />
        <span
          style={{
            font: '500 13.5px var(--font-ui)',
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {task.title}
        </span>
        <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t3)' }}>
          {agentShort(task.agentKind)} · {timeAgo(task.lastActivityAt)}
        </span>
      </div>
      <div style={{ padding: '0 14px 12px', font: "11.5px var(--font-mono)", color: 'var(--t4)' }}>
        {project.name} · {whereLabel(task)}
      </div>
      {task.activity ? (
        <div style={{ padding: '0 14px 10px', font: '12.5px var(--font-ui)', color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.activity}
        </div>
      ) : null}
      <div
        style={{
          background: 'var(--bg-console)',
          borderTop: '1px solid var(--bd-1)',
          padding: '10px 14px',
          font: "11.5px/18px var(--font-mono)",
          height: 92,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        <PreviewLines lines={lines} />
        {ctx.menu}
      </div>
    </div>
  )
}

/** What an empty Agents list says: why it's empty, and where to start one. */
function emptyText(filter: AppFilter, paused: number, hasProjects: boolean): string {
  if (filter === 'needs') return 'Nothing needs you right now.'
  if (filter === 'working') return 'No agent is working right now.'
  if (filter === 'done') return 'No finished agents to review.'
  if (paused) return `No agent is running - ${paused} ${paused === 1 ? 'is' : 'are'} paused (resume one from its workspace).`
  if (hasProjects) return 'No agents yet. Start one from a board: select a card and press S, or drag it to In Progress.'
  return `No agents yet. Add a project first${inParens('new-project')}, then start a task with an agent.`
}

export function Agents(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const blocked = blockedTasks(state)
  const working = workingTasks(state)
  const done = doneTasks(state)
  const queued = queuedTasks(state.tasks)

  const counts: Record<AppFilter, number> = {
    all: blocked.length + working.length + done.length,
    needs: blocked.length,
    working: working.length,
    done: done.length
  }

  const showNeeds = (state.agentFilter === 'all' || state.agentFilter === 'needs') && blocked.length > 0
  const showWorking = (state.agentFilter === 'all' || state.agentFilter === 'working') && working.length > 0
  const showDone = (state.agentFilter === 'all' || state.agentFilter === 'done') && done.length > 0
  const empty = !showNeeds && !showWorking && !showDone && !(queued.length > 0 && state.agentFilter !== 'done')

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '24px 28px', gap: 16, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ font: "600 20px var(--font-ui)", letterSpacing: '-0.01em' }}>Agents</div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-panel)', border: '1px solid var(--bd-2)', borderRadius: 6, padding: 2, font: '12px var(--font-ui)' }}>
          {FILTERS.map((f) => (
            <span
              key={f.id}
              onClick={() => dispatch({ type: 'SET_AGENT_FILTER', filter: f.id })}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                background: state.agentFilter === f.id ? 'color-mix(in srgb, var(--ov) 8%, transparent)' : 'transparent',
                color: state.agentFilter === f.id ? 'var(--t1)' : 'var(--t3)',
                cursor: 'pointer',
                display: 'flex',
                gap: 6
              }}
            >
              {f.label} <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{counts[f.id]}</span>
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t5)' }}>
          {keysLine()}
        </span>
      </div>

      {empty ? (
        <div style={{ border: '1px solid var(--bd-2)', borderRadius: 6, padding: 16, font: '13px var(--font-ui)', color: 'var(--t3)' }}>
          {emptyText(state.agentFilter, state.tasks.filter((t) => t.st === 'paused').length, state.projects.length > 0)}
        </div>
      ) : null}

      {showNeeds ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ font: "500 13px var(--font-ui)", color: 'var(--c-amber)' }}>Needs you</span>
            <span style={{ font: "12px var(--font-mono)", color: 'var(--t4)' }}>oldest first</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14 }}>
            {blocked.map((t) => (
              <BlockedCard key={t.id} task={t} />
            ))}
          </div>
        </div>
      ) : null}

      {showWorking ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <div style={{ font: "500 13px var(--font-ui)", color: 'var(--t2)' }}>Working</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14 }}>
            {working.map((t) => (
              <WorkingCard key={t.id} task={t} />
            ))}
          </div>
        </div>
      ) : null}

      {queued.length > 0 && state.agentFilter !== 'done' ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span style={{ font: '500 13px var(--font-ui)', color: 'var(--c-blue)' }}>Queued</span>
            <span style={{ font: "12px var(--font-mono)", color: 'var(--t4)' }}>
              {state.prefs.maxAgents ? `${busyAgents(state.tasks)} of ${state.prefs.maxAgents} slots in use` : 'starting'}
            </span>
          </div>
          {queued.map((q, i) => {
            const project = state.projects.find((p) => p.id === q.projectId)!
            return (
              <div
                key={q.id}
                style={{ display: 'grid', gridTemplateColumns: '24px 1.6fr 1.4fr 1fr auto', gap: 14, alignItems: 'center', height: 40, borderTop: '1px solid var(--bd-row)', font: '12.5px var(--font-ui)', padding: '0 6px' }}
              >
                <span style={{ color: 'var(--c-blue)', fontFamily: 'var(--font-mono)' }}>{i + 1}</span>
                <span style={{ color: 'var(--t1)' }}>{q.title}</span>
                <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>
                  {project.name} · {q.queued!.branch}
                </span>
                <span style={{ font: "12px var(--font-mono)", color: 'var(--t2)' }}>
                  {agentShort(q.queued!.agentKind)} · waiting {timeAgo(q.queued!.at)}
                </span>
                <span onClick={() => dispatch({ type: 'UNQUEUE_TASK', taskId: q.id })} style={{ font: '12px var(--font-ui)', color: 'var(--t3)', cursor: 'pointer' }}>
                  Remove
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {showDone ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
          <div style={{ font: "500 13px var(--font-ui)", color: 'var(--t2)', marginBottom: 6 }}>Done — ready for review</div>
          {done.map((d) => {
            const project = state.projects.find((p) => p.id === d.projectId)!
            return (
              <div
                key={d.id}
                onClick={() => dispatch({ type: 'OPEN_TASK', taskId: d.id })}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '16px 1.6fr 1.4fr 1fr 1fr auto',
                  gap: 14,
                  alignItems: 'center',
                  height: 40,
                  borderTop: '1px solid var(--bd-row)',
                  font: '12.5px var(--font-ui)',
                  cursor: 'pointer',
                  padding: '0 6px'
                }}
              >
                <span style={{ color: 'var(--c-green)', fontFamily: 'var(--font-mono)' }}>✓</span>
                <span style={{ color: 'var(--t1)' }}>{d.title}</span>
                <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>
                  {project.name} · {whereLabel(d)}
                </span>
                <span style={{ font: "12px var(--font-mono)", color: 'var(--t2)' }}>
                  {agentShort(d.agentKind)} · {timeAgo(d.lastActivityAt)}
                </span>
                <span style={{ font: "12px var(--font-mono)", color: d.lastTest ? TEST_COLOR[d.lastTest.status] : 'var(--t4)' }}>
                  {d.lastTest ? TEST_LABEL[d.lastTest.status] : 'tests not run'}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'OPEN_TASK', taskId: d.id, tab: 'changes' })
                  }}
                  style={{ font: '12px var(--font-ui)', color: 'var(--t2)' }}
                >
                  Review changes →
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
