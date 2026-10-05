import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { statusColor, statusLabel, timeAgo } from '../../../lib/status'
import { agentShort } from '../../../lib/derive'
import { useRealDiffStats } from '../../../lib/realGit'
import { COLUMN_LABEL } from '@shared/constants'
import { TaskDescription } from '../TaskDescription'
import { AcceptanceCriteria } from '../Criteria'
import { previewPortOf } from '../WorkspacePreview'
import { TipRows, TipTitle, Tooltip } from '../../../components/ui'
import type { Project, Task, WorktreeStatus } from '@shared/types'
import { checkoutsOf, isMulti, repoCommands, reposOf, taskRoot } from '../../../lib/multiRepo'
import { useUsage } from '../../../lib/usage'
import { formatCost, sumUsage } from '@shared/usage'
import { baseOf } from '../../../lib/stack'
import { parentOf } from '@shared/stack'
import { useShells, wsOpen } from '../../../lib/wsStore'
import { PanelHeader, type PanelChrome } from '../layout/PanelHeader'
import { useTranscript } from './useTranscript'

const SECTION: React.CSSProperties = { font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }

/** "42s", "12m", "3h 05m". */
function duration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "950", "12.3k", "1.2M". */
function count(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** The Task side bar view: what the task is, where it runs, how it's going. */
export function TaskView({ task, project, chrome }: { task: Task; project: Project; chrome: PanelChrome }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const parent = parentOf(task, state.tasks)
  const realStats = useRealDiffStats([task], [project])[task.id]
  const shells = useShells(task.id)
  const [wt, setWt] = useState<WorktreeStatus | null>(null)

  useEffect(() => {
    if (!task.worktreePath) return setWt(null)
    let cancelled = false
    // Every repository's worktree: commits and uncommitted changes add up; "behind" is the home's.
    const checkouts = checkoutsOf(task, state.projects).filter((c) => c.path)
    Promise.all(checkouts.map((c) => window.api.git.worktreeStatus(c.path!, baseOf(task, c.project)).catch(() => null))).then((all) => {
      if (cancelled) return
      const home = all[0]
      if (!home) return setWt(null)
      const rest = all.slice(1).filter((s): s is NonNullable<typeof s> => !!s)
      setWt({ ...home, ahead: home.ahead + rest.reduce((n, s) => n + s.ahead, 0), dirty: home.dirty + rest.reduce((n, s) => n + s.dirty, 0) })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.worktreePath, task.taskDir, (task.repos ?? []).join(), project.defaultBranch, task.st, task.lastActivityAt])

  // The dev server (Preview), for Environment.
  const [devPort, setDevPort] = useState<number | null>(null)
  useEffect(() => {
    const check = (): void => {
      window.api.pty.info(`preview-${task.id}`).then((i) => setDevPort(i?.running ? previewPortOf(task.id) : null))
    }
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [task.id])

  // Agent time ticks while it works.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (task.st !== 'working') return
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [task.st])
  const workMs = (task.workMs ?? 0) + (task.st === 'working' && task.workingSince ? Math.max(0, now - task.workingSince) : 0)

  // Each repository's test command (a task in several repositories runs them all).
  const testSteps = repoCommands(task, state.projects, 'testCmd')
  const testLabel = testSteps.length > 1 ? testSteps.map((t) => `${t.name}: ${t.cmd}`).join(' · ') : testSteps[0]?.cmd
  const runTests = (): void => {
    dispatch({ type: 'RUN_TESTS', taskId: task.id })
    if (testSteps.length) wsOpen(task.id, 'tests')
  }

  const env: { label: string; v: string; sub: string; agent?: boolean }[] = [
    { label: 'Task', v: task.key, sub: task.title },
    { label: 'Branch', v: task.branch ?? '—', sub: `from ${baseOf(task, project)}${wt?.behind ? ` · ${wt.behind} behind` : ''}` },
    {
      label: 'Worktree',
      v: taskRoot(task) ?? '—',
      sub: !task.worktreePath ? 'not created' : (isMulti(task) ? `${reposOf(task).length} repos · ` : '') + (wt ? `${wt.ahead} commit${wt.ahead === 1 ? '' : 's'} · ${wt.dirty ? `${wt.dirty} uncommitted` : 'clean'}` : '…')
    },
    { label: 'Agent', v: task.agentKind ? `${agentShort(task.agentKind)} · ${statusLabel(task) || 'stopped'}` : '—', sub: task.startedAt ? `started ${timeAgo(task.startedAt)} ago` : '', agent: true },
    { label: 'Terminal', v: `${shells.length + (task.agentKind ? 1 : 0)} session${shells.length + (task.agentKind ? 1 : 0) === 1 ? '' : 's'}`, sub: devPort ? `dev server on :${devPort}` : [agentShort(task.agentKind), ...shells.map((s) => s.name)].filter(Boolean).join(' · ') }
  ]

  return (
    <>
      <PanelHeader title="Task" chrome={chrome} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 18px 20px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: '12px var(--font-mono)', color: 'var(--t3)' }}>
            {task.key} · {COLUMN_LABEL[task.col]}
            {parent ? (
              <span title={`Builds on ${parent.key} · ${parent.title}`}>
                {' '}
                · ↳ on{' '}
                <span onClick={() => dispatch({ type: 'OPEN_TASK_SHEET', taskId: parent.id })} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
                  {parent.key}
                </span>
              </span>
            ) : null}
          </div>
          <div style={{ font: '600 19px/1.25 var(--font-ui)', letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{task.title}</div>
          <TaskDescription key={task.id} task={task} />
        </div>
        <AcceptanceCriteria key={`ac-${task.id}`} task={task} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...SECTION, marginBottom: 12 }}>Environment</div>
          {env.map((e, i, arr) => (
            <div key={e.label} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: `1.5px solid ${e.agent ? statusColor(task.st) : 'var(--t4)'}`,
                    background: e.agent ? statusColor(task.st) : i === 0 ? 'var(--t4)' : 'transparent',
                    marginTop: 4,
                    flex: 'none'
                  }}
                />
                {i < arr.length - 1 ? <span style={{ flex: 1, width: 1, background: 'var(--bd-4)' }} /> : null}
              </div>
              <div style={{ paddingBottom: 12, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ font: '11.5px var(--font-ui)', color: 'var(--t3)', width: 62, flex: 'none' }}>{e.label}</span>
                  <span title={e.v} style={{ font: '12.5px var(--font-mono)', color: e.agent ? statusColor(task.st) : i < 2 ? 'var(--t1)' : 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.v}
                  </span>
                </div>
                {e.sub ? (
                  <div title={e.sub} style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', marginLeft: 70, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.sub}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--bd-1)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 7, font: '12px var(--font-mono)', color: 'var(--t3)' }}>
          <Stat
            label="Changes"
            value={
              realStats ? (
                <span style={{ color: 'var(--t2)' }}>
                  {realStats.files} <span style={{ color: 'var(--c-green)' }}>+{realStats.added}</span> <span style={{ color: 'var(--c-red)' }}>−{realStats.deleted}</span>
                </span>
              ) : (
                <span style={{ color: 'var(--t2)' }}>{task.worktreePath ? '…' : '—'}</span>
              )
            }
          />
          <Stat label="Tests" value={<TestsValue task={task} testCmd={testLabel} onRun={runTests} />} />
          {task.lastTest?.status === 'failed' && task.agentKind ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span
                onClick={() =>
                  dispatch({
                    type: 'MESSAGE_AGENT',
                    taskId: task.id,
                    text: `The tests are failing: \`${testLabel}\` exited with code ${task.lastTest?.exitCode}. Run them, find the cause and fix it.`,
                    toast: `Sent the failing tests to ${agentShort(task.agentKind) || 'the agent'}.`
                  })
                }
                style={{ color: 'var(--c-blue)', cursor: 'pointer' }}
              >
                Send failure to {agentShort(task.agentKind)} →
              </span>
            </div>
          ) : null}
          <Stat label="Commits" value={<span style={{ color: 'var(--t2)' }}>{wt ? wt.ahead : task.worktreePath ? '…' : '—'}</span>} />
          <Stat
            label="Agent time"
            value={
              <span style={{ color: 'var(--t2)' }} title={task.startedAt ? `Time spent working · started ${timeAgo(task.startedAt)} ago` : undefined}>
                {task.startedAt ? duration(workMs) : '—'}
              </span>
            }
          />
        </div>
        <SessionStats task={task} />
      </div>
    </>
  )
}

function TestsValue({ task, testCmd, onRun }: { task: Task; testCmd?: string; onRun: () => void }): React.JSX.Element {
  if (!testCmd) return <span style={{ color: 'var(--t4)' }}>no test command</span>
  const t = task.lastTest
  const label = !t ? (
    <span style={{ color: 'var(--t4)' }}>not run</span>
  ) : t.status === 'running' ? (
    <span style={{ color: 'var(--c-amber)' }}>running…</span>
  ) : t.status === 'passed' ? (
    <span style={{ color: 'var(--c-green)' }}>passing</span>
  ) : (
    <span style={{ color: 'var(--c-red)' }}>failing</span>
  )
  return (
    <span style={{ display: 'flex', gap: 10 }}>
      {t ? (
        <span onClick={() => wsOpen(task.id, 'tests')} title="Show the output" style={{ cursor: 'pointer' }}>
          {label}
        </span>
      ) : (
        label
      )}
      {t?.status !== 'running' && task.worktreePath ? (
        <span onClick={onRun} title={testCmd} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
          {t ? 'rerun' : 'run'}
        </span>
      ) : null}
    </span>
  )
}

/** The agent's Claude Code session, from its transcript: tokens and what they cost. */
function SessionStats({ task }: { task: Task }): React.JSX.Element | null {
  const { state } = useAppStore()
  const usage = useUsage()
  const summary = useTranscript(task)
  if (!summary) return null
  const { tokens } = summary
  // Priced model by model, from what's recorded (a session can switch models).
  const prices = state.prefs.modelPrices
  const sessionSum = sumUsage(usage.filter((e) => e.sessionId === task.session?.id), { prices }).get('')
  const taskSum = sumUsage(usage.filter((e) => e.taskId === task.id), { prices }).get('')
  return (
    <div style={{ borderTop: '1px solid var(--bd-1)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 7, font: '12px var(--font-mono)', color: 'var(--t3)' }}>
      <div style={{ ...SECTION, marginBottom: 2 }}>Session</div>
      <Stat
        label="Tokens"
        value={
          <Tooltip
            content={
              <>
                <TipTitle>This session&apos;s tokens</TipTitle>
                <TipRows
                  rows={[
                    ['Input', tokens.input.toLocaleString()],
                    ['Written to cache', tokens.cacheWrite.toLocaleString()],
                    ['Read from cache', tokens.cacheRead.toLocaleString()],
                    ['Output', tokens.output.toLocaleString()]
                  ]}
                />
              </>
            }
          >
            <span style={{ color: 'var(--t2)' }}>
              {count(tokens.input + tokens.cacheWrite)} in · {count(tokens.output)} out
            </span>
          </Tooltip>
        }
      />
      <Stat label="Cached" value={<span style={{ color: 'var(--t2)' }}>{count(tokens.cacheRead)} read</span>} />
      <Stat
        label="Cost"
        value={
          <span style={{ color: 'var(--t2)' }} title="What these tokens cost at API prices (a subscription isn't billed per token)">
            {!sessionSum ? '…' : sessionSum.cost || !sessionSum.unpriced ? `≈ ${formatCost(sessionSum.cost)}${sessionSum.unpriced ? ' + unpriced' : ''}` : 'no price for this model'}
            {taskSum && taskSum.sessions > 1 ? ` · task ${formatCost(taskSum.cost)}` : ''}
          </span>
        }
      />
      <Stat label="Tool calls" value={<span style={{ color: 'var(--t2)' }}>{summary.toolCount}</span>} />
      {summary.model ? <Stat label="Model" value={<span style={{ color: 'var(--t2)' }}>{summary.model.replace(/^claude-/, '')}</span>} /> : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ flex: 1 }}>{label}</span>
      {value}
    </div>
  )
}
