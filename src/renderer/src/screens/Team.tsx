import React, { useEffect, useMemo, useRef, useState } from 'react'
import { plural } from '../lib/summary'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { agentShort } from '../lib/derive'
import { statusColor, statusLabel, timeAgo } from '../lib/status'
import { errText } from '../lib/errors'
import { keyLabel } from '../lib/keys'
import { useTeam } from '../lib/team'
import { Button, Select } from '../components/ui'
import type { Task, TeamMessage } from '@shared/types'

const STATE_TEXT: Record<TeamMessage['state'], string> = {
  queued: 'waiting for its turn to end',
  delivered: 'delivered',
  read: 'read',
  held: 'held - too many back and forth'
}

/**
 * The Team channel: what the agents of tasks running in parallel say to
 * each other (their send_message tool), what Switchyard tells them (a
 * clash between their changes), and what you tell them.
 */
export function Team(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const messages = useTeam()
  const [who, setWho] = useState<string | null>(null)
  const [to, setTo] = useState<string>('')
  const [text, setText] = useState('')
  const feed = useRef<HTMLDivElement>(null)
  const active = state.tasks.filter((t) => t.agentKind && t.col !== 'done')
  const shown = useMemo(() => (who ? messages.filter((m) => m.from === who || m.to === who) : messages), [messages, who])
  const target = to || who || active[0]?.id || ''

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight })
  }, [shown.length, who])

  const name = (id: string): string => (id === 'user' ? 'You' : id === 'switchyard' ? 'Switchyard' : (state.tasks.find((t) => t.id === id)?.key ?? id))
  const send = async (): Promise<void> => {
    if (!text.trim() || !target) return
    try {
      await window.api.team.send(target, text)
      setText('')
    } catch (err) {
      dispatch({ type: 'TOAST', text: errText(err) })
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Team</span>
        <span style={{ font: '12px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          agents on parallel tasks, coordinating · messages reach an agent when its turn ends
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px 1fr' }}>
        <div style={{ borderRight: '1px solid var(--bd-1)', overflow: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <AgentRow label="Everything" sub={plural(messages.length, 'message')} active={who === null} onClick={() => setWho(null)} />
          <div style={{ font: '500 11px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', padding: '14px 8px 6px' }}>Agents at work</div>
          {active.length ? (
            active.map((t) => (
              <AgentRow
                key={t.id}
                task={t}
                label={`${t.key} ${t.title}`}
                sub={[agentShort(t.agentKind), statusLabel(t)].filter(Boolean).join(' · ')}
                count={messages.filter((m) => m.from === t.id || m.to === t.id).length}
                active={who === t.id}
                onClick={() => {
                  setWho(t.id)
                  setTo(t.id)
                }}
              />
            ))
          ) : (
            <div style={{ padding: '4px 8px', font: '12px/1.5 var(--font-ui)', color: 'var(--t4)' }}>No agent is working on a task.</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div ref={feed} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!shown.length ? (
              <div style={{ margin: 'auto', maxWidth: 460, textAlign: 'center', font: '13px/1.6 var(--font-ui)', color: 'var(--t4)' }}>
                Nothing yet. Agents with Switchyard&apos;s tools (Claude Code, Codex, OpenCode, Copilot CLI) can see who else is working (list_active_tasks) and message them (send_message); when the conflict radar finds two whose changes clash, Switchyard introduces them here.
              </div>
            ) : (
              shown.map((m) => <Message key={m.id} m={m} name={name} tasks={state.tasks} onOpen={(id) => dispatch({ type: 'OPEN_TASK', taskId: id })} />)
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--bd-1)', padding: '10px 24px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '12px var(--font-ui)', color: 'var(--t3)' }}>
              To
              <Select
                value={target}
                options={active.map((t) => [t.id, `${t.key} · ${agentShort(t.agentKind)} · ${t.title}`] as [string, string])}
                onChange={setTo}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    send()
                  }
                }}
                disabled={!active.length}
                rows={2}
                placeholder={active.length ? 'A message for that agent - it gets it when its turn ends' : 'No agent to message'}
                style={{ flex: 1, resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 6, padding: '8px 10px', font: '13px/1.45 var(--font-ui)', outline: 'none' }}
              />
              <Button variant="primary" hint={keyLabel('⌘↵')} disabled={!text.trim() || !target} onClick={send}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentRow({ task, label, sub, count, active, onClick }: { task?: Task; label: string; sub: string; count?: number; active: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      onClick={onClick}
      {...hoverProps}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', background: active ? 'var(--bg-panel-3)' : hover ? 'var(--bg-hover)' : 'transparent' }}
    >
      {task ? <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: statusColor(task.st) }} /> : null}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)' }}>{sub}</span>
      </div>
      {count ? <span style={{ font: '11px var(--font-mono)', color: 'var(--t3)' }}>{count}</span> : null}
    </div>
  )
}

function Message({ m, name, tasks, onOpen }: { m: TeamMessage; name: (id: string) => string; tasks: Task[]; onOpen: (id: string) => void }): React.JSX.Element {
  const from = tasks.find((t) => t.id === m.from)
  const color = m.from === 'user' ? 'var(--c-blue)' : m.from === 'switchyard' ? 'var(--c-amber)' : 'var(--t1)'
  const link = (id: string): React.ReactNode =>
    tasks.some((t) => t.id === id) ? (
      <span onClick={() => onOpen(id)} title="Open the task" style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
        {name(id)}
      </span>
    ) : (
      name(id)
    )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, font: '12px var(--font-mono)', color: 'var(--t4)' }}>
        <span style={{ color, fontWeight: 600 }}>{link(m.from)}</span>
        {from?.agentKind ? <span>{agentShort(from.agentKind)}</span> : null}
        <span>→ {link(m.to)}</span>
        <span>· {timeAgo(m.at)} ago</span>
        <span style={{ color: m.state === 'held' ? 'var(--c-amber)' : 'var(--t5)' }}>· {STATE_TEXT[m.state]}</span>
        {m.state === 'held' ? (
          <span onClick={() => window.api.team.release(m.id)} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
            let it through
          </span>
        ) : null}
      </div>
      <div
        style={{
          font: '13px/1.55 var(--font-ui)',
          color: 'var(--t1)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          padding: '8px 12px',
          borderRadius: 8,
          background: m.from === 'user' ? 'color-mix(in srgb, var(--c-blue) 9%, transparent)' : m.from === 'switchyard' ? 'color-mix(in srgb, var(--c-amber) 8%, transparent)' : 'var(--bg-panel)',
          border: '1px solid var(--bd-2)'
        }}
      >
        {m.text}
      </div>
    </div>
  )
}
