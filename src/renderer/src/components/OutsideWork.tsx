import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { AGENTS } from '@shared/constants'
import { timeAgo } from '../lib/status'
import { useHover } from '../lib/useHover'
import { bringIn, hideOutside, rescanOutside, sessionOf, suggestAgent, suggestColumn, suggestTitle, unhideAll, useOutside } from '../lib/outside'
import { prefsFor } from '../lib/projectPrefs'
import { AlertAction, AlertLine } from './AlertLine'
import { Button, FooterNote, Modal, ModalFooter, ModalHeader, Segmented, Select, TextInput } from './ui'
import type { AgentKind, BoardColumn, OutsideItem, OutsideSession, Project } from '@shared/types'

const MONO = 'var(--font-mono)'

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What the items are, in a few words: "1 worktree, 2 branches, a conversation". */
function kinds(items: OutsideItem[]): string {
  const n = (k: OutsideItem['kind']): number => items.filter((i) => i.kind === k).length
  return [n('worktree') ? plural(n('worktree'), 'worktree') : null, n('branch') ? plural(n('branch'), 'branch', 'branches') : null, n('session') ? plural(n('session'), 'conversation') : null].filter(Boolean).join(', ')
}

/** The board's line about work in the project that no task holds. */
export function OutsideStrip({ project }: { project: Project }): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const { items } = useOutside(project.id, { tasks: state.tasks })
  if (!items?.length) return null
  return (
    <div style={{ flex: 'none', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-panel)' }}>
      <AlertLine color="var(--c-blue)" icon="⤵" title="Worktrees, branches and agent conversations started outside Switchyard">
        Work outside Switchyard in {project.name}: {kinds(items)}
        <AlertAction onClick={() => dispatch({ type: 'OPEN_OUTSIDE', projectId: project.id })}>bring in</AlertAction>
      </AlertLine>
    </div>
  )
}

/** Outside work in a project, to bring in as tasks. */
export function OutsideModal(): React.JSX.Element | null {
  const { state } = useAppStore()
  const project = state.projects.find((p) => p.id === state.outsideFor)
  if (!project) return null
  return <Body key={project.id} project={project} />
}

function Body({ project }: { project: Project }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [all, setAll] = useState(false)
  const { items, hidden, refresh } = useOutside(project.id, { all, tasks: state.tasks })
  const [open, setOpen] = useState<string | null>(null)
  const close = (): void => dispatch({ type: 'OPEN_OUTSIDE', projectId: null })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (open) setOpen(null)
      else close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const groups: [OutsideItem['kind'], string, string][] = [
    ['worktree', 'Worktrees', 'Checked out somewhere, no task holds them'],
    ['branch', 'Branches', 'Commits of their own, not checked out'],
    ['session', 'Conversations in the main checkout', 'Claude Code and Codex, the last 30 days']
  ]
  return (
    <Modal width={760} top={64} onClose={close}>
      <ModalHeader kicker={`Outside work · ${project.name}`} title="Bring in work started outside Switchyard" />
      <div style={{ flex: 1, minHeight: 140, overflow: 'auto', padding: '6px 0 12px' }}>
        {items === null ? (
          <div style={{ padding: 20, font: '13px var(--font-ui)', color: 'var(--t3)' }}>Looking for worktrees, branches and conversations…</div>
        ) : !items.length ? (
          <div style={{ padding: 20, font: '13px/1.5 var(--font-ui)', color: 'var(--t3)' }}>
            {hidden ? `Nothing left to bring in from ${project.name} (${hidden} hidden).` : `Nothing outside Switchyard in ${project.name} - every worktree and branch with work of its own belongs to a task.`}
          </div>
        ) : (
          groups.map(([kind, label, note]) => {
            const list = items.filter((i) => i.kind === kind)
            if (!list.length) return null
            return (
              <div key={kind} style={{ display: 'flex', flexDirection: 'column', padding: '10px 20px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 6 }}>
                  <span style={{ font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{label}</span>
                  <span style={{ font: '11.5px var(--font-ui)', color: 'var(--t4)' }}>{note}</span>
                </div>
                {list.map((item) => (
                  <ItemRow key={item.id} item={item} project={project} open={open === item.id} onOpen={() => setOpen(open === item.id ? null : item.id)} onDone={() => setOpen(null)} onHide={refresh} />
                ))}
              </div>
            )
          })
        )}
      </div>
      <ModalFooter>
        <FooterNote>
          Nothing changes until you bring one in: a branch then gets a worktree; a worktree and its conversation stay where they are.
          {hidden ? (
            <>
              {' '}
              <span
                onClick={() => {
                  if (all) {
                    unhideAll()
                    refresh()
                  }
                  setAll((a) => !a)
                }}
                style={{ color: 'var(--c-blue)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {all ? `Unhide ${hidden}` : `Show ${hidden} hidden`}
              </span>
            </>
          ) : null}
        </FooterNote>
        <Button
          onClick={() => {
            rescanOutside(project.id)
            refresh()
          }}
        >
          Look again
        </Button>
        <Button variant="primary" onClick={close}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function ItemRow({ item, project, open, onOpen, onDone, onHide }: { item: OutsideItem; project: Project; open: boolean; onOpen: () => void; onDone: () => void; onHide: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const s = sessionOf(item)
  const facts =
    item.kind === 'session'
      ? [s ? `${s.agentKind === 'codex' ? 'Codex' : 'Claude Code'} · ${timeAgo(s.at)} ago` : null, s?.branch ? `on ${s.branch}` : null]
      : [
          item.ahead ? plural(item.ahead, 'commit') + ' of its own' : 'no commits of its own',
          item.dirty ? plural(item.dirty, 'change') + ' not committed' : null,
          item.lastCommitAt ? `last commit ${timeAgo(item.lastCommitAt)} ago${item.subject ? ` “${item.subject}”` : ''}` : null
        ]
  return (
    <div {...hoverProps} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 12px', margin: '0 -12px', borderRadius: 6, background: open ? 'var(--bg-panel-2)' : hover ? 'var(--bg-panel-2)' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
            {item.kind === 'session' ? (
              <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s?.first ?? 'A conversation'}</span>
            ) : (
              <>
                <span style={{ font: `500 12.5px ${MONO}`, color: 'var(--t1)', whiteSpace: 'nowrap' }}>{item.branch ?? '(detached)'}</span>
                {item.path ? <span title={item.path} style={{ font: `11.5px ${MONO}`, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', minWidth: 0 }}>{item.path}</span> : null}
              </>
            )}
          </div>
          <div style={{ font: '12px var(--font-ui)', color: 'var(--t3)' }}>{facts.filter(Boolean).join(' · ')}</div>
          {item.kind !== 'session' && s ? <SessionLine s={s} more={item.sessions.length - 1} /> : null}
          {item.kind === 'session' && s?.last ? <Quote text={s.last} /> : null}
        </div>
        {!open ? (
          <>
            <span
              onClick={() => {
                hideOutside(item.id)
                onHide()
              }}
              title="Leave it out of this list (on this computer)"
              style={{ font: '12px var(--font-ui)', color: 'var(--t4)', cursor: 'pointer', visibility: hover ? 'visible' : 'hidden' }}
            >
              Hide
            </span>
            <Button size="xs" onClick={onOpen}>
              {item.kind === 'session' ? 'Make a task' : 'Bring in'}
            </Button>
          </>
        ) : null}
      </div>
      {open ? <BringInForm item={item} project={project} onCancel={onDone} onDone={onDone} /> : null}
    </div>
  )
}

function SessionLine({ s, more }: { s: OutsideSession; more: number }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ font: '12px var(--font-ui)', color: 'var(--t2)' }}>
        <span style={{ color: 'var(--c-blue)' }}>{s.agentKind === 'codex' ? 'Codex' : 'Claude Code'}</span> conversation · {timeAgo(s.at)} ago{more > 0 ? ` · ${plural(more, 'older one')}` : ''}
        {s.first ? <span style={{ color: 'var(--t3)' }}> · asked “{s.first.length > 90 ? `${s.first.slice(0, 89)}…` : s.first}”</span> : null}
      </div>
      {s.last ? <Quote text={s.last} /> : null}
    </div>
  )
}

function Quote({ text }: { text: string }): React.JSX.Element {
  return (
    <div style={{ font: '12px/1.45 var(--font-ui)', color: 'var(--t3)', borderLeft: '2px solid var(--bd-3)', paddingLeft: 9, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</div>
  )
}

function BringInForm({ item, project, onCancel, onDone }: { item: OutsideItem; project: Project; onCancel: () => void; onDone: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const prefs = prefsFor(state, project.id)
  const enabled = AGENTS.filter((a) => !state.prefs.agentsOff.includes(a.kind))
  const fallback = (project.agentKind && enabled.some((a) => a.kind === project.agentKind) ? project.agentKind : prefs.defaultAgent) as AgentKind
  const [title, setTitle] = useState(() => suggestTitle(item))
  const [agent, setAgent] = useState<AgentKind>(() => suggestAgent(item, fallback))
  const [col, setCol] = useState<BoardColumn>(() => suggestColumn(item))
  const [busy, setBusy] = useState(false)
  const s = sessionOf(item)
  const resumes = !!s && s.agentKind === agent && item.kind !== 'session'
  const go = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const task = await bringIn(item, { title, agentKind: agent, col }, { project, tasks: state.tasks, dispatch })
    setBusy(false)
    if (task) onDone()
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', alignItems: 'center', rowGap: 8, columnGap: 10, padding: '8px 0 2px', font: '12.5px var(--font-ui)' }}>
      <span style={{ color: 'var(--t4)' }}>Title</span>
      <TextInput
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
        }}
        style={{ fontSize: 13 }}
      />
      <span style={{ color: 'var(--t4)' }}>Agent</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Select value={agent} options={enabled.map((a): [string, string] => [a.kind, a.name])} onChange={(v) => setAgent(v as AgentKind)} />
        <span style={{ color: 'var(--t3)', font: '12px var(--font-ui)' }}>
          {item.kind === 'session' ? 'A new task: it starts fresh, with the conversation as its description' : resumes ? 'Resume picks up its conversation' : 'Resume starts the agent in the worktree'}
        </span>
      </div>
      <span style={{ color: 'var(--t4)' }}>Column</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Segmented
          value={col}
          options={item.kind === 'session' ? [['backlog', 'Backlog'], ['ready', 'Ready']] : [['progress', 'In Progress'], ['review', 'Review']]}
          onChange={setCol}
        />
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={go}>
          {busy ? 'Adding…' : item.kind === 'branch' ? 'Check out & add' : 'Add to board'}
        </Button>
      </div>
    </div>
  )
}
