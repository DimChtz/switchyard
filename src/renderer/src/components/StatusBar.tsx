import React, { useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { useHover } from '../lib/useHover'
import { needsYou, statusColor } from '../lib/status'
import { agentShort, liveTasks } from '../lib/derive'
import { shortcut } from '../lib/shortcuts'
import { NoticeBell } from './NoticeCenter'
import { Menu, type MenuAnchor, type MenuItem } from './ui'
import { actOnUpdate, useUpdate } from '../lib/updates'

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

/** A new version, until Switchyard restarts: restart and install it now (or later, on quit) - or get it from its page. */
function UpdateChip(): React.JSX.Element | null {
  const update = useUpdate()
  const [hover, hoverProps] = useHover()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  if (!update) return null
  const ready = update.kind === 'ready'
  const items: MenuItem[] = ready
    ? [
        { label: 'Restart now to install', onClick: () => actOnUpdate(update) },
        { label: 'Later - it installs when you quit', onClick: () => {} },
        { label: 'What’s new', onClick: () => window.api.sys.openExternal(update.url), separatorBefore: true }
      ]
    : [
        { label: 'Download from the release page', onClick: () => actOnUpdate(update) },
        { label: 'Later', onClick: () => {} }
      ]
  return (
    <>
      <span
        onClick={(e) => setMenu({ el: e.currentTarget, align: 'end' })}
        title={ready ? `Switchyard ${update.version} is downloaded - restart to install it` : `Switchyard ${update.version} is out - this build can't install it itself`}
        {...hoverProps}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', height: 18, borderRadius: 9, cursor: 'pointer', font: '11.5px var(--font-ui)', color: 'var(--c-green)', background: `color-mix(in srgb, var(--c-green) ${hover ? 18 : 10}%, transparent)` }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8.5V1.5M2 4.5l3-3 3 3" />
        </svg>
        {ready ? `Update ready · ${update.version}` : `Update out · ${update.version}`}
      </span>
      {menu ? <Menu anchor={menu} items={items} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

export function StatusBar(): React.JSX.Element {
  const { state } = useAppStore()
  const live = liveTasks(state)

  const queued = state.tasks.filter((t) => t.queued).length
  let ctx = `${live.filter((t) => t.st === 'working').length} working · ${
    live.filter(needsYou).length
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
      <UpdateChip />
      <NoticeBell />
    </div>
  )
}
