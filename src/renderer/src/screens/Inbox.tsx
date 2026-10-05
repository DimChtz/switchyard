import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { agentShort } from '../lib/derive'
import { clock, timeAgo, wakeAt } from '../lib/status'
import { keyLabel } from '../lib/keys'
import { usePtyTail } from '../lib/ptyTail'
import { refreshComments, useInboxItems, type InboxItem, type InboxKind } from '../lib/inbox'
import { markRead } from '../lib/notices'
import { followUpMessage, where } from '../lib/review'
import { conflictMessage } from '../lib/conflicts'
import { isMulti, repoDir } from '../lib/multiRepo'
import { Button } from '../components/ui'
import type { Task } from '@shared/types'
import { baseOf } from '../lib/stack'

const KIND: Record<InboxKind, { label: string; color: string }> = {
  approval: { label: 'Approval', color: 'var(--c-amber)' },
  question: { label: 'Question', color: 'var(--c-amber)' },
  failed: { label: 'Failed', color: 'var(--c-red)' },
  limit: { label: 'Usage limit', color: 'var(--c-blue)' },
  conflict: { label: 'Conflict', color: 'var(--c-red)' },
  tests: { label: 'Tests', color: 'var(--c-red)' },
  criteria: { label: 'Acceptance', color: 'var(--c-red)' },
  review: { label: 'Review', color: 'var(--c-blue)' },
  team: { label: 'Team', color: 'var(--c-amber)' },
  waiting: { label: 'Your turn', color: 'var(--t3)' }
}

interface Action {
  key: string
  label: string
  run: () => void
  primary?: boolean
}

/**
 * The Inbox: everything waiting on you, one at a time, most urgent first.
 * j/k (↑/↓) move; each item's actions have a key (y/n approve, r reply,
 * o open, s skip …).
 */
export function Inbox(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const all = useInboxItems()
  // Skipped for now: back when it changes (its id does).
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const items = useMemo(() => all.filter((i) => !skipped.has(i.id)), [all, skipped])
  const [index, setIndex] = useState(0)
  const [reply, setReply] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const item = items[Math.min(index, items.length - 1)] ?? null
  const task = item?.taskId ? (state.tasks.find((t) => t.id === item.taskId) ?? null) : null
  const agent = agentShort(task?.agentKind ?? null) || 'the agent'

  // A new item under the cursor starts with an empty reply.
  useEffect(() => setReply(''), [item?.id])
  useEffect(() => {
    if (index > 0 && index >= items.length) setIndex(Math.max(0, items.length - 1))
  }, [items.length, index])

  const send = (text: string, toast?: string): void => {
    if (!task || !text.trim()) return
    dispatch({ type: 'MESSAGE_AGENT', taskId: task.id, text, toast: toast ?? `Sent to ${agent}.` })
  }
  const open = (tab?: 'changes' | 'terminal'): void => {
    if (!task) return
    if (task.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: task.id, tab })
    else {
      dispatch({ type: 'NAV', view: 'board', projectId: task.projectId })
      dispatch({ type: 'SET_BOARD_FOCUS', id: task.id })
    }
  }
  const skip = (): void => item && setSkipped((s) => new Set(s).add(item.id))

  /** Sends the reply box: to the agent - in a review comment's thread, or answering its question. */
  const sendReply = (): void => {
    if (!item || !task || !reply.trim()) return
    if (item.kind === 'review' && item.comment) {
      const c = item.comment
      const ref = c.ref ?? 0
      window.api.store.updateComments([{ id: c.id, patch: { awaiting: true, thread: [...(c.thread ?? []), { from: 'you', text: reply.trim(), at: Date.now() }] } }]).then(refreshComments)
      send(followUpMessage({ ...c, ref }, reply.trim()))
    } else {
      send(reply.trim())
      if (item.notice) markRead([item.notice.id])
    }
    setReply('')
  }

  const actions = ((): Action[] => {
    if (!item) return []
    const replyAction: Action = { key: 'r', label: 'Reply', run: () => replyRef.current?.focus() }
    const openAction: Action = { key: 'o', label: 'Open', run: () => open(item.kind === 'review' ? 'changes' : undefined) }
    const skipAction: Action = { key: 's', label: 'Skip', run: skip }
    switch (item.kind) {
      case 'approval':
        return [
          { key: 'y', label: 'Approve', primary: true, run: () => task && dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'yes' }) },
          { key: 'n', label: 'Deny', run: () => task && dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'no' }) },
          openAction,
          skipAction
        ]
      case 'question':
        return [replyAction, { key: 'x', label: 'Dismiss', run: () => item.notice && markRead([item.notice.id]) }, openAction, skipAction]
      case 'failed':
        return [{ key: 't', label: 'Retry', primary: true, run: () => task && dispatch({ type: 'ANSWER_TASK', taskId: task.id, answer: 'retry' }) }, replyAction, openAction, skipAction]
      case 'limit':
        return [
          { key: 'w', label: 'Wake now', primary: true, run: () => task && dispatch({ type: 'WAKE_TASK', taskId: task.id }) },
          { key: 'x', label: 'Don’t wake it', run: () => task && dispatch({ type: 'CANCEL_SLEEP', taskId: task.id }) },
          openAction,
          skipAction
        ]
      case 'conflict':
        return [
          {
            key: 't',
            label: `Tell ${agent}`,
            primary: true,
            run: () => {
              if (!task) return
              const repo = state.projects.find((p) => p.id === item.repoId)
              const other = item.other ? state.tasks.find((t) => t.id === item.other) : undefined
              const home = state.projects.find((p) => p.id === task.projectId)
              const base = home ? baseOf(task, home) : 'main'
              send(conflictMessage({ other: item.other ?? null, repoId: item.repoId ?? '', files: item.files ?? [], conflicts: item.files ?? [] }, other, base, isMulti(task) && repo ? repoDir(repo) : ''), `Told ${agent} about it.`)
              skip()
            }
          },
          openAction,
          skipAction
        ]
      case 'tests':
        return [{ key: 't', label: `Ask ${agent} to fix`, primary: true, run: () => send(`The tests failed (${item.detail}). Look at the failures, fix them, and run the tests again.`) }, openAction, skipAction]
      case 'criteria':
        return [{ key: 't', label: `Ask ${agent} to fix`, primary: true, run: () => send(`These acceptance criteria failed: ${item.detail?.replace(/\n/g, '; ')}. Fix them and verify them again.`) }, openAction, skipAction]
      case 'review':
        return [
          {
            key: 'x',
            label: 'Resolve',
            primary: true,
            run: () => item.comment && window.api.store.updateComments([{ id: item.comment.id, patch: { resolved: true } }]).then(refreshComments)
          },
          replyAction,
          openAction,
          skipAction
        ]
      case 'team':
        return [{ key: 'l', label: 'Let it through', primary: true, run: () => item.message && window.api.team.release(item.message.id) }, { key: 'o', label: 'Open Team', run: () => dispatch({ type: 'NAV', view: 'team' }) }, skipAction]
      case 'waiting':
        return [replyAction, { key: 'c', label: 'Continue', run: () => send('Please continue.') }, openAction, skipAction]
    }
  })()

  // The keys: j/k move, each action's key runs it. Not while typing the reply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return
      if (document.querySelector('[role=dialog], [role=menu]')) return
      const k = e.key.toLowerCase()
      if (k === 'j' || e.key === 'ArrowDown') setIndex((i) => Math.min(items.length - 1, i + 1))
      else if (k === 'k' || e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
      else {
        const a = actions.find((x) => x.key === k)
        if (!a) return
        a.run()
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const canReply = actions.some((a) => a.key === 'r')

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Inbox</span>
        <span style={{ font: '12px var(--font-mono)', color: 'var(--t3)' }}>
          {items.length ? `${items.length} waiting on you` : 'nothing waiting on you'}
          {skipped.size ? ' · ' : ''}
          {skipped.size ? (
            <span onClick={() => setSkipped(new Set())} style={{ color: 'var(--c-blue)', cursor: 'pointer' }}>
              {skipped.size} skipped
            </span>
          ) : null}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t5)' }}>j/k move · keys on each action · r reply</span>
      </div>
      {!items.length ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
          <div style={{ font: '500 15px var(--font-ui)', color: 'var(--t1)' }}>All clear</div>
          <div style={{ font: '13px var(--font-ui)', color: 'var(--t4)' }}>Approvals, questions, failures, clashes and finished turns show up here.</div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '380px 1fr' }}>
          <div style={{ borderRight: '1px solid var(--bd-1)', overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {items.map((it, i) => (
              <ItemRow key={it.id} item={it} task={state.tasks.find((t) => t.id === it.taskId)} active={it.id === item?.id} onClick={() => setIndex(i)} />
            ))}
          </div>
          {item ? (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '18px 24px 14px', display: 'flex', flexDirection: 'column', gap: 6, borderBottom: '1px solid var(--bd-1)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', font: '12px var(--font-mono)', color: 'var(--t4)' }}>
                  <span style={{ color: KIND[item.kind].color }}>{KIND[item.kind].label}</span>
                  {task ? (
                    <span>
                      {task.key} · {task.title}
                    </span>
                  ) : null}
                  <span>· {timeAgo(item.at)} ago</span>
                </div>
                <div style={{ font: '600 17px var(--font-ui)', color: 'var(--t1)' }}>{item.title}</div>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Context item={item} task={task} />
              </div>
              <div style={{ borderTop: '1px solid var(--bd-1)', padding: '12px 24px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {canReply ? (
                  <textarea
                    ref={replyRef}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        sendReply()
                      }
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                    rows={2}
                    placeholder={item.kind === 'review' ? `Reply in the comment's thread - ${agent} answers there` : `Reply to ${agent}`}
                    style={{ resize: 'vertical', background: 'var(--bg-panel-3)', color: 'var(--t1)', border: '1px solid var(--bd-3)', borderRadius: 6, padding: '8px 10px', font: '13px/1.45 var(--font-ui)', outline: 'none' }}
                  />
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {actions.map((a) => (
                    <Button key={a.key} variant={a.primary ? 'primary' : undefined} hint={a.key} onClick={a.run}>
                      {a.label}
                    </Button>
                  ))}
                  {canReply ? (
                    <Button hint={keyLabel('⌘↵')} disabled={!reply.trim()} onClick={sendReply}>
                      Send reply
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, task, active, onClick }: { item: InboxItem; task?: Task; active: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const k = KIND[item.kind]
  return (
    <div
      data-inbox={item.kind}
      onClick={onClick}
      {...hoverProps}
      style={{ display: 'flex', gap: 10, padding: '9px 10px', borderRadius: 6, cursor: 'pointer', background: active ? 'var(--bg-panel-3)' : hover ? 'var(--bg-hover)' : 'transparent', boxShadow: active ? 'inset 2px 0 0 var(--c-blue)' : 'none' }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: k.color, flex: 'none', marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t1)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
          <span style={{ font: '10.5px var(--font-mono)', color: 'var(--t5)' }}>{timeAgo(item.at)}</span>
        </div>
        <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task ? `${task.key} · ` : ''}
          {item.detail ?? task?.title ?? ''}
        </span>
      </div>
    </div>
  )
}

/** What the item is about: the question, the comment, the files - and what the terminal shows. */
function Context({ item, task }: { item: InboxItem; task: Task | null }): React.JSX.Element {
  const terminal = item.kind === 'tests' ? `tests-${task?.id}` : `agent-${task?.id}`
  const showTail = !!task && item.kind !== 'team' && item.kind !== 'review'
  const tail = usePtyTail(showTail ? terminal : '', 28)
  const box: React.CSSProperties = { font: '13px/1.55 var(--font-ui)', color: 'var(--t1)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-panel)', border: '1px solid var(--bd-2)' }
  return (
    <>
      {item.kind === 'review' && item.comment ? (
        <>
          <div style={{ font: '12px var(--font-mono)', color: 'var(--t3)' }}>{where(item.comment)}</div>
          <div style={box}>
            <span style={{ color: 'var(--t4)' }}>You: </span>
            {item.comment.text}
          </div>
          {(item.comment.thread ?? []).map((r, i) => (
            <div key={i} style={{ ...box, background: r.from === 'agent' ? 'color-mix(in srgb, var(--c-blue) 7%, transparent)' : 'var(--bg-panel)' }}>
              <span style={{ color: r.from === 'agent' ? 'var(--c-blue)' : 'var(--t4)' }}>{r.from === 'agent' ? 'Agent' : 'You'}: </span>
              {r.text}
            </div>
          ))}
        </>
      ) : item.kind === 'limit' && task?.sleeping ? (
        <div style={box}>
          {task.sleeping.until ? `It resumes on its own at ${clock(task.sleeping.until)}.` : `It didn't say when the limit resets - it tries again at ${clock(wakeAt(task.sleeping))}.`}
          {'\n'}
          <span style={{ color: 'var(--t3)' }}>{task.sleeping.reason}</span>
        </div>
      ) : item.detail ? (
        <div style={box}>{item.detail}</div>
      ) : null}
      {showTail && tail?.length ? (
        <pre style={{ margin: 0, font: '12px/1.5 var(--font-mono)', color: 'var(--t2)', background: 'var(--bg-console)', border: '1px solid var(--bd-2)', borderRadius: 8, padding: '10px 12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{tail.join('\n')}</pre>
      ) : null}
    </>
  )
}
