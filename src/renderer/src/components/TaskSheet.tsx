import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/AppStore'
import { COLUMN_LABEL } from '@shared/constants'
import { keyLabel } from '../lib/keys'
import { checklistItems } from '../lib/mdEdit'
import { newCriterion } from '../lib/criteria'
import { Button, Menu, type MenuAnchor, type MenuItem } from './ui'
import { childrenOf, parentOf, wouldLoop } from '@shared/stack'
import { HoverBox } from './notes/NoteEditor'
import { MarkdownField, useLiveLinks } from './MarkdownField'
import { AcceptanceCriteria } from '../screens/workspace/Criteria'
import type { Task } from '@shared/types'

/**
 * What the task builds on (its branch starts from that task's), picked
 * until it starts; and the tasks building on it.
 */
function StackRow({ task, open }: { task: Task; open: (id: string) => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const parent = parentOf(task, state.tasks)
  const children = childrenOf(task, state.tasks)
  const project = state.projects.find((p) => p.id === task.projectId)
  const main = project?.defaultBranch ?? 'main'
  const set = (parentId: string | null): void => dispatch({ type: 'SET_BUILDS_ON', taskId: task.id, parentId })
  const fixed = !!task.branch
  const items: MenuItem[] = [
    { label: 'Nothing', sub: `starts from ${main}`, checked: !parent, onClick: () => set(null) },
    { label: 'Builds on', heading: true, onClick: () => {} },
    ...state.tasks
      .filter((t) => t.id !== task.id && t.col !== 'done' && (t.projectId === task.projectId || t.repos?.includes(task.projectId)) && !wouldLoop(task.id, t.id, state.tasks))
      .map((t) => ({ label: t.title, sub: `${t.key} · ${COLUMN_LABEL[t.col]}`, checked: parent?.id === t.id, onClick: () => set(t.id) }))
  ]
  const link = (t: Task): React.JSX.Element => (
    <HoverBox
      key={t.id}
      onClick={() => open(t.id)}
      title={`${t.title} - open it`}
      style={{ color: 'var(--c-blue)', cursor: 'pointer' }}
      hover={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}
    >
      {t.key}
    </HoverBox>
  )
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, font: '12px var(--font-mono)', color: 'var(--t3)', marginTop: -6 }}>
      <span style={{ color: 'var(--t4)' }}>↳</span>
      {fixed ? (
        <span title="Its branch was made from this when it started">
          {parent ? <>builds on {link(parent)} · {parent.title}</> : `from ${main}`}
        </span>
      ) : (
        <HoverBox
          onClick={(e) => {
            const el = e.currentTarget
            setMenu((m) => (m ? null : { el }))
          }}
          title="A task that needs another's changes builds on it: its branch starts from that one's"
          style={{ height: 22, padding: '0 8px', borderRadius: 4, border: '1px solid var(--bd-3)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: parent ? 'var(--t1)' : 'var(--t3)' }}
          hover={{ borderColor: 'var(--bd-5)', background: 'var(--bg-panel)' }}
        >
          {parent ? `builds on ${parent.key} · ${parent.title}` : `from ${main} - builds on nothing`}
          <span style={{ color: 'var(--t4)' }}>▾</span>
        </HoverBox>
      )}
      {children.length ? (
        <span>
          · {children.map((c, i) => (
            <React.Fragment key={c.id}>
              {i ? ', ' : ''}
              {link(c)}
            </React.Fragment>
          ))}{' '}
          build{children.length === 1 ? 's' : ''} on this
        </span>
      ) : null}
      {menu ? <Menu anchor={menu} width={340} items={items} intro="Its branch starts from that task's, so it has its changes; it's merged after it." onClose={() => setMenu(null)} /> : null}
    </div>
  )
}

/** The task sheet: where a task's title, description and criteria are written. */
export function TaskSheet(): React.JSX.Element | null {
  const { state } = useAppStore()
  const task = state.tasks.find((t) => t.id === state.taskSheet)
  if (!task) return null
  return <Sheet key={task.id} task={task} />
}

function Sheet({ task }: { task: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.desc ?? '')
  const latest = useRef({ title, desc })
  latest.current = { title, desc }
  const project = state.projects.find((p) => p.id === task.projectId)

  // Closing keeps what was written (Esc, a click outside, Done); Discard doesn't.
  const close = useCallback(
    (keep = true): void => {
      if (keep) {
        const { title: t, desc: d } = latest.current
        dispatch({ type: 'RENAME_TASK', taskId: task.id, title: t })
        dispatch({ type: 'SET_TASK_DESC', id: task.id, desc: d })
      }
      dispatch({ type: 'OPEN_TASK_SHEET', taskId: null })
    },
    [dispatch, task.id]
  )
  const links = useLiveLinks(close)

  // Ahead of the app's shortcuts: Esc closes this, and nothing behind it moves.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      // A confirm or a menu over it takes Esc itself.
      if (e.key !== 'Escape' || document.querySelector('[role=dialog][aria-modal=true], [role=menu]')) return
      // A criterion being written or edited: Esc is its own (cancel).
      const el = e.target as HTMLElement
      if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && !el.dataset.sheetTitle) return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close])

  // "- [ ]" items not already acceptance criteria: offered as them.
  const have = new Set((task.criteria ?? []).map((c) => c.text.trim().toLowerCase()))
  const offered = checklistItems(desc).filter((i) => !have.has(i.text.trim().toLowerCase()))
  const dirty = title.trim() !== task.title || desc.trim() !== (task.desc ?? '')

  return createPortal(
    <div
      onMouseDown={() => close()}
      style={{ position: 'fixed', top: 36, bottom: 26, left: 0, right: 0, background: 'var(--backdrop)', display: 'flex', justifyContent: 'flex-end', zIndex: 90 }}
    >
      <div
        role="dialog"
        aria-label={`${task.key} - ${task.title}`}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: 'calc(100vw - 120px)',
          height: '100%',
          background: 'var(--bg-console)',
          borderLeft: '1px solid var(--bd-4)',
          boxShadow: '-24px 0 64px color-mix(in srgb, var(--sh) 45%, transparent)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ height: 42, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 28px', borderBottom: '1px solid var(--bd-1)', font: `12px var(--font-mono)`, color: 'var(--t3)' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {task.key} · {project?.name ?? task.projectId} · {COLUMN_LABEL[task.col]}
            {task.issue ? ` · #${task.issue.number}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--t4)' }}>esc</span>
          <HoverBox
            onClick={() => close()}
            title="Close (keeps your changes)"
            style={{ width: 26, height: 26, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-dim)', cursor: 'pointer', font: '15px var(--font-ui)' }}
            hover={{ background: 'var(--bg-hover)', color: 'var(--t1)' }}
          >
            ×
          </HoverBox>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) close()
              else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                e.preventDefault()
                ;(e.currentTarget.closest('[role=dialog]')?.querySelector('.cm-content') as HTMLElement | null)?.focus()
              }
            }}
            data-sheet-title="1"
            spellCheck={false}
            placeholder="Task title"
            style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '600 22px/1.3 var(--font-ui)', letterSpacing: '-0.01em', padding: 0, flex: 'none' }}
          />
          <StackRow
            task={task}
            open={(id) => {
              close()
              dispatch({ type: 'OPEN_TASK_SHEET', taskId: id })
            }}
          />
          <div style={{ flex: '1 0 auto', minHeight: 260, display: 'flex', flexDirection: 'column' }}>
            <MarkdownField
              value={desc}
              onChange={setDesc}
              autoFocus
              onSubmit={() => close()}
              links={links}
              placeholder="What should the agent build? Context, constraints, a - [ ] checklist of what done means…"
              hint="↵ continues lists"
            />
          </div>
          {offered.length ? (
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, background: 'color-mix(in srgb, var(--c-blue) 8%, transparent)', font: '12.5px var(--font-ui)', color: 'var(--t2)' }}>
              <span style={{ color: 'var(--c-blue)', font: '600 12px var(--font-mono)' }}>☐</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {offered.length} checklist item{offered.length === 1 ? '' : 's'} in the description - make {offered.length === 1 ? 'it an acceptance criterion' : 'them acceptance criteria'}, for the agent to verify?
              </span>
              <Button
                size="xs"
                onClick={() => {
                  dispatch({ type: 'SET_CRITERIA', taskId: task.id, criteria: [...(task.criteria ?? []), ...offered.map((i) => newCriterion(i.text))] })
                  dispatch({ type: 'TOAST', text: `Added ${offered.length} acceptance criteri${offered.length === 1 ? 'on' : 'a'}` })
                }}
              >
                Add {offered.length === 1 ? 'it' : `all ${offered.length}`}
              </Button>
            </div>
          ) : null}
          <div style={{ flex: 'none', borderTop: '1px solid var(--bg-hover)', paddingTop: 16 }}>
            <AcceptanceCriteria task={task} />
          </div>
        </div>
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 28px', borderTop: '1px solid var(--bd-2)', background: 'var(--bg-panel-3)' }}>
          <span style={{ flex: 1, minWidth: 0, font: '12px var(--font-ui)', color: 'var(--t3)' }}>
            {task.agentKind && task.col !== 'done' ? 'The agent has the description it started with - tell it about changes in its terminal.' : 'Changes are kept when you close this.'}
          </span>
          {dirty ? (
            <Button size="lg" onClick={() => close(false)}>
              Discard changes
            </Button>
          ) : null}
          <Button size="lg" variant="primary" hint={keyLabel('⌘↵')} onClick={() => close()}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
