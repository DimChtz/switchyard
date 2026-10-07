import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { agentShort } from '../../../lib/derive'
import { TerminalView } from '../../../components/TerminalView'
import { AGENTS } from '@shared/constants'
import { agentSessionId, projectEnv, setupSessionId, startAgent, testsSessionId } from '../../../lib/agentControl'
import { Button } from '../../../components/ui'
import { taskRoot } from '../../../lib/multiRepo'
import { useShells } from '../../../lib/wsStore'
import { prefsFor } from '../../../lib/projectPrefs'
import { errText } from '../../../lib/errors'
import type { AgentKind, PtyInfo, Project, Task } from '@shared/types'

/** The agent's session as a tab: its real terminal, or a way to start it again. */
export function AgentTab({ task, visible }: { task: Task; visible: boolean }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const project = state.projects.find((p) => p.id === task.projectId)
  const agentDef = AGENTS.find((a) => a.kind === task.agentKind)
  const sessionId = agentSessionId(task.id)
  // The agent is started by the launch flow (or Resume/Restart), never just
  // by opening this - so this only attaches to a session that exists.
  const [session, setSession] = useState<PtyInfo | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      window.api.pty.info(sessionId).then((i) => {
        if (!cancelled) setSession(i)
      })
    }
    refresh()
    const offData = window.api.pty.onData((id) => {
      if (id === sessionId) setSession((cur) => (cur && cur !== 'loading' && cur.running ? cur : { running: true, exitCode: null }))
    })
    const offExit = window.api.pty.onExit((id) => {
      if (id === sessionId) refresh()
    })
    return () => {
      cancelled = true
      offData()
      offExit()
    }
  }, [sessionId, task.st])

  if (session === 'loading') return <div style={{ flex: 1, minHeight: 0 }} />
  // The scratchpad: any agent, started here and now (none yet, or the last one exited).
  if (task.scratch && (!session || !session.running)) return <ScratchAgents task={task} project={project} ended={session ? (session.exitCode ?? 0) : null} />
  if (session)
    return (
      <>
        <TerminalView key={sessionId} sessionId={sessionId} cwd={taskRoot(task) ?? ''} attachOnly autoFocus={visible} />
        {!session.running ? (
          <AgentBar
            text={session.exitCode === 0 ? `${agentShort(task.agentKind)} exited.` : `${agentShort(task.agentKind)} exited with code ${session.exitCode}.`}
            action={session.exitCode === 0 ? `Restart ${agentShort(task.agentKind)}` : 'Send failure back'}
            hint={session.exitCode === 0 ? '' : 'R'}
            danger={session.exitCode !== 0}
            onClick={() => dispatch(session.exitCode === 0 ? { type: 'RESUME_TASK', taskId: task.id } : { type: 'ANSWER_TASK', taskId: task.id, answer: 'retry' })}
          />
        ) : null}
      </>
    )
  if (task.worktreePath && agentDef)
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ font: '13px var(--font-ui)', color: 'var(--t3)' }}>{agentDef.name} isn't running for this task.</div>
        <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'RESUME_TASK', taskId: task.id })}>
          Resume {agentDef.name}
        </Button>
        <div style={{ font: '12px var(--font-ui)', color: 'var(--t4)' }}>{agentDef.resumeArgs ? 'Reopens its previous conversation in this worktree.' : "Starts a new session with the task's first message."}</div>
      </div>
    )
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t4)', fontSize: 13, padding: 20, textAlign: 'center' }}>
      {task.worktreePath ? 'No agent on this task.' : 'This task has no worktree yet.'}
    </div>
  )
}

/**
 * The scratchpad's agent: pick one and it starts in the project's folder
 * with no task to work on - you tell it what to do. `ended`: the exit code
 * of the one that ran before (null: none has).
 */
function ScratchAgents({ task, project, ended }: { task: Task; project: Project | undefined; ended: number | null }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [installed, setInstalled] = useState<Partial<Record<AgentKind, boolean>> | null>(null)
  const [busy, setBusy] = useState<AgentKind | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.agents
      .detectInstalled()
      .then((i) => !cancelled && setInstalled(i))
      .catch(() => !cancelled && setInstalled({}))
    return () => {
      cancelled = true
    }
  }, [])
  const agents = AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind))
  const go = (kind: AgentKind, resume: boolean): void => {
    if (busy || !project) return
    setBusy(kind)
    dispatch({ type: 'SET_TASK_AGENT', taskId: task.id, agentKind: kind })
    // A fresh session has no first message: it's waiting for yours.
    startAgent({ ...task, agentKind: kind, firstMessage: null, session: resume ? task.session : null }, project, prefsFor(state, project.id), resume ? 'resume' : 'fresh')
      .catch((err: unknown) => dispatch({ type: 'TOAST', text: `Could not start ${AGENTS.find((a) => a.kind === kind)?.name ?? kind}: ${errText(err)}` }))
      .finally(() => setBusy(null))
  }
  const last = AGENTS.find((a) => a.kind === task.agentKind)
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20, textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ font: '500 14px var(--font-ui)', color: 'var(--t1)' }}>{ended === null || !last ? 'Start an agent in the scratchpad' : `${last.name} ${ended === 0 ? 'exited' : `exited with code ${ended}`}`}</div>
        <div style={{ font: '12.5px var(--font-ui)', color: 'var(--t3)', maxWidth: 420, textWrap: 'pretty' } as React.CSSProperties}>
          It works in {project?.name ?? 'the project'}&apos;s own folder, on whatever is checked out there - no task, branch or worktree. Tell it what to do once it&apos;s up.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* Only its own conversation (known by id): "the latest one here" could be one of yours in this folder. */}
        {last && task.session?.id && (last.kind === 'claude' || last.kind === 'codex') ? (
          <Button variant="primary" size="lg" disabled={!!busy} onClick={() => go(last.kind, true)}>
            Resume {last.name}
          </Button>
        ) : null}
        {agents.map((a) => (
          <Button
            key={a.kind}
            size="lg"
            variant={ended === null && a.kind === (project?.agentKind ?? state.prefs.defaultAgent) ? 'primary' : undefined}
            disabled={!!busy || installed?.[a.kind] === false}
            title={installed?.[a.kind] === false ? `${a.name} isn't installed` : undefined}
            onClick={() => go(a.kind, false)}
          >
            {busy === a.kind ? 'Starting…' : `${ended !== null && a.kind === last?.kind ? 'New' : 'Start'} ${a.name}`}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** A shell tab: its terminal (started the first time it shows). */
export function ShellTab({ task, project, id, visible }: { task: Task; project: Project; id: string; visible: boolean }): React.JSX.Element {
  const shell = useShells(task.id).find((s) => s.id === id)
  const cwd = shell?.cwd ?? taskRoot(task) ?? project.repoPath ?? ''
  // Not one of the task's shells (yet): a tab left from before a restart, about to be tidied away - nothing is started for it.
  if (!shell) return <div style={{ flex: 1, minHeight: 0 }} />
  return <TerminalView key={id} sessionId={id} cwd={cwd} cmd={shell?.profile?.path} args={shell?.profile?.args} env={projectEnv(project)} autoFocus={visible} />
}

/** The launch setup's or the tests' output (they run on their own; this only shows them). */
export function OutputTab({ task, kind, visible }: { task: Task; kind: 'setup' | 'tests'; visible: boolean }): React.JSX.Element {
  const cwd = taskRoot(task) ?? ''
  if (kind === 'tests') {
    if (!task.lastTest) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t4)', fontSize: 13 }}>The tests haven't run yet.</div>
    return <TerminalView key={`tests:${task.lastTest.at}`} sessionId={testsSessionId(task.id)} cwd={cwd} attachOnly autoFocus={visible} />
  }
  return <TerminalView key="setup" sessionId={setupSessionId(task.id)} cwd={cwd} attachOnly autoFocus={visible} />
}

function AgentBar({ text, action, hint, danger, onClick }: { text: string; action: string; hint: string; danger: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        flex: 'none',
        margin: '0 16px 12px',
        border: `1px solid ${danger ? 'color-mix(in srgb, var(--c-red) 40%, transparent)' : 'var(--bd-3)'}`,
        borderRadius: 6,
        background: danger ? 'color-mix(in srgb, var(--c-red) 6%, transparent)' : 'var(--bg-panel-3)',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: danger ? 'var(--c-red)' : 'var(--t4)', flex: 'none' }} />
      <span style={{ flex: 1, font: '13px var(--font-ui)', color: 'var(--t1)' }}>{text}</span>
      <Button variant="primary" size="sm" hint={hint} onClick={onClick}>
        {action}
      </Button>
    </div>
  )
}
