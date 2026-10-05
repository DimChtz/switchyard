import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../../store/AppStore'
import { useHover } from '../../../lib/useHover'
import { statusColor, statusLabel } from '../../../lib/status'
import { agentShort } from '../../../lib/derive'
import { setupSessionId } from '../../../lib/agentControl'
import { previewPortOf } from '../WorkspacePreview'
import { Menu, type MenuAnchor } from '../../../components/ui'
import { prefsFor } from '../../../lib/projectPrefs'
import { taskRoot } from '../../../lib/multiRepo'
import { addShell, setDrag, startTabDrag, useShells, wsOpen } from '../../../lib/wsStore'
import type { Layout } from '../../../lib/wsLayout'
import { groupsOf } from '../../../lib/wsLayout'
import type { ShellOption, Task } from '@shared/types'
import { PanelHeader, PanelIcon, type PanelChrome } from '../layout/PanelHeader'

/** The Sessions side bar view: the agent, the terminals and the tools - click to show, drag onto a group (or its edge). */
export function SessionsView({ task, layout, chrome }: { task: Task; layout: Layout; chrome: PanelChrome }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const shells = useShells(task.id)
  const [hasSetup, setHasSetup] = useState(false)
  useEffect(() => {
    window.api.pty.info(setupSessionId(task.id)).then((i) => setHasSetup(!!i))
  }, [task.id])
  const [devPort, setDevPort] = useState<number | null>(null)
  useEffect(() => {
    const check = (): void => {
      window.api.pty.info(`preview-${task.id}`).then((i) => setDevPort(i?.running ? previewPortOf(task.id) : null))
    }
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [task.id])
  const [profiles, setProfiles] = useState<ShellOption[]>([])
  const [profileMenu, setProfileMenu] = useState<MenuAnchor | null>(null)
  useEffect(() => {
    window.api.sys.shells().then(setProfiles)
  }, [])

  const groups = groupsOf(layout.root)
  const focused = groups.find((g) => g.g === layout.focus)
  const showing = focused?.a ?? null
  const isOpen = (id: string): boolean => groups.some((g) => g.tabs.includes(id))
  const notes = state.notes.filter((n) => n.taskId === task.id).length
  const root = taskRoot(task) ?? undefined
  const t = task.lastTest

  const row = (id: string, label: string, sub: string, ic: string, icColor: string, dot?: string): React.JSX.Element => (
    <SessionRow key={id} id={id} taskId={task.id} label={label} sub={sub} ic={ic} icColor={icColor} dot={dot} active={showing === id} open={isOpen(id)} />
  )

  return (
    <>
      <PanelHeader title="Sessions" chrome={chrome}>
        <PanelIcon title="New terminal" onClick={() => addShell(task.id, { taskRoot: root })}>
          <path d="M7 2.5v9M2.5 7h9" />
        </PanelIcon>
      </PanelHeader>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Head>Agent</Head>
        {row('agent', task.agentKind ? agentShort(task.agentKind) : 'Agent', task.agentKind ? statusLabel(task.st) || 'stopped' : 'none', '◆', 'var(--c-blue)', task.agentKind ? statusColor(task.st) : undefined)}
        <Head>Terminals</Head>
        {hasSetup ? row('setup', 'setup', 'launch setup', '›', 'var(--t3)') : null}
        {t ? row('tests', 'tests', t.status === 'running' ? 'running' : t.status, '›', 'var(--t3)', t.status === 'running' ? 'var(--c-amber)' : t.status === 'passed' ? 'var(--c-green)' : 'var(--c-red)') : null}
        {shells.map((s) => row(`shell:${s.id}`, s.name, s.profile?.label ?? (s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? 'shell' : 'shell'), '›', 'var(--t3)'))}
        {!hasSetup && !t && !shells.length ? <div style={{ padding: '2px 8px 4px', font: '12px var(--font-ui)', color: 'var(--t4)' }}>No terminals open.</div> : null}
        <Head>Tools</Head>
        {row('preview', 'Preview', devPort ? `localhost:${devPort}` : 'no server', '◎', 'var(--c-green)')}
        {row('notes', 'Notes', `${notes} linked`, '¶', 'var(--t2)')}
        {row('timeline', 'Timeline', 'turns · undo', '↺', 'var(--t2)')}
        <NewTerminal
          onClick={() => addShell(task.id, { taskRoot: root })}
          onMenu={profiles.length ? (el) => setProfileMenu((m) => (m ? null : { el })) : undefined}
        />
        <div style={{ padding: '14px 8px 0', font: '12px/1.5 var(--font-ui)', color: 'var(--t4)', textWrap: 'pretty' }}>Click to open in the focused group. Drag onto any group edge to open it in a split.</div>
      </div>
      {profileMenu ? (
        <Menu
          anchor={profileMenu}
          width={230}
          items={[
            ...profiles.map((p) => ({ label: p.label, sub: p.id === prefsFor(state, task.projectId).shell ? 'default' : '', onClick: () => addShell(task.id, { profile: p, taskRoot: root }) })),
            { label: 'Choose the default…', separatorBefore: true, onClick: () => dispatch({ type: 'OPEN_SETTINGS', section: 'terminal' }) }
          ]}
          onClose={() => setProfileMenu(null)}
        />
      ) : null}
    </>
  )
}

function Head({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={{ padding: '12px 8px 5px', font: '500 10.5px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t5)' }}>{children}</div>
}

function SessionRow({ id, taskId, label, sub, ic, icColor, dot, active, open }: { id: string; taskId: string; label: string; sub: string; ic: string; icColor: string; dot?: string; active: boolean; open: boolean }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      draggable
      onDragStart={(e) => startTabDrag(e, id, null)}
      onDragEnd={() => setDrag(null)}
      onClick={() => wsOpen(taskId, id)}
      title={open ? 'Open - click to show it' : 'Click to open in the focused group'}
      {...hoverProps}
      style={{
        height: 28,
        flex: 'none',
        padding: '0 8px',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        background: active ? 'color-mix(in srgb, var(--c-blue) 10%, transparent)' : hover ? 'var(--bg-menu)' : 'transparent',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      <span style={{ width: 12, flex: 'none', textAlign: 'center', font: '11px var(--font-mono)', color: icColor }}>{ic}</span>
      <span style={{ flex: 1, minWidth: 0, font: '12.5px var(--font-ui)', color: open ? 'var(--t1)' : 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50%' }}>{sub}</span>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flex: 'none' }} /> : null}
    </div>
  )
}

/** The dashed "+ New terminal" row, with the terminal profiles (⌄) beside it. */
function NewTerminal({ onClick, onMenu }: { onClick: () => void; onMenu?: (el: HTMLElement) => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  const [mHover, mHoverProps] = useHover()
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      <div
        onClick={onClick}
        {...hoverProps}
        style={{ flex: 1, height: 28, padding: '0 8px', borderRadius: 4, border: `1px dashed ${hover ? 'var(--bd-5)' : 'var(--bd-3)'}`, display: 'flex', alignItems: 'center', gap: 9, font: '12.5px var(--font-ui)', color: hover ? 'var(--t1)' : 'var(--t-dim)', cursor: 'pointer' }}
      >
        <span style={{ width: 12, textAlign: 'center' }}>+</span>New terminal
      </div>
      {onMenu ? (
        <div
          onClick={(e) => onMenu(e.currentTarget)}
          title="New terminal with…"
          {...mHoverProps}
          style={{ width: 28, height: 28, borderRadius: 4, border: `1px dashed ${mHover ? 'var(--bd-5)' : 'var(--bd-3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: mHover ? 'var(--t1)' : 'var(--t-dim)', cursor: 'pointer', boxSizing: 'border-box' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : null}
    </div>
  )
}
