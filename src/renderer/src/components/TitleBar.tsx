import React, { useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { isMac, keyLabel } from '../lib/commands'
import { Menu, type MenuItem } from './ui'
import type { MenuEntry, MenuModel } from '@shared/types'
import { canGo } from '../store/history'
import { inParens } from '../lib/shortcuts'

const VIEW_TITLE: Record<string, string> = {
  dashboard: 'Projects',
  board: 'Board',
  agents: 'Agents',
  worktrees: 'Worktrees',
  workspace: 'Workspace',
  settings: 'Settings',
  notes: 'Notes',
  usage: 'Usage',
  team: 'Team',
  inbox: 'Inbox',
  summary: 'Summary',
  map: 'Map'
}

export function TitleBar({ menus, run }: { menus: MenuModel[]; run: (id: string) => void }): React.JSX.Element {
  const { state } = useAppStore()
  const [open, setOpen] = useState<number | null>(null)
  // Moved to with ← / →: the first item is highlighted, as in a native menu bar.
  const [viaKeyboard, setViaKeyboard] = useState(false)

  let title = VIEW_TITLE[state.view] ?? ''
  if (state.view === 'workspace' && state.taskId) {
    const task = state.tasks.find((t) => t.id === state.taskId)
    if (task) title = task.title
  }
  if (state.view === 'board' && state.projectId) {
    const project = state.projects.find((p) => p.id === state.projectId)
    if (project) title = project.name
  }

  return (
    <>
      <div
        style={
          {
            height: 36,
            flex: 'none',
            // Menus | back, forward and the title, centred | room for the
            // window controls. Nothing may overlap: an element over the
            // menus would put its drag area over theirs, leaving only slivers
            // of each menu clickable.
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            columnGap: 12,
            background: 'var(--bg-chrome)',
            borderBottom: '1px solid var(--bd-1)',
            position: 'relative',
            zIndex: 46,
            // Native window controls live on top of the page here: macOS's
            // traffic lights sit inset at the left (titleBarStyle:
            // 'hiddenInset'), Windows/Linux draw minimize/maximize/close at
            // the right (titleBarOverlay) - this bar just needs to leave
            // room for whichever one applies and stay draggable everywhere
            // else, the same way VS Code's single title bar works.
            paddingLeft: isMac ? 78 : 8,
            paddingRight: isMac ? 14 : 140,
            WebkitAppRegion: 'drag'
          } as React.CSSProperties
        }
      >
        {/* macOS shows these menus in the system menu bar instead. */}
        {isMac ? (
          <span />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifySelf: 'start', minWidth: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {menus.map((m, i) => (
              <TopMenu
                key={m.label}
                menu={m}
                open={open === i}
                viaKeyboard={viaKeyboard}
                onToggle={() => {
                  setViaKeyboard(false)
                  setOpen(open === i ? null : i)
                }}
                onEnter={() => {
                  if (open === null || open === i) return
                  setViaKeyboard(false)
                  setOpen(i)
                }}
                onClose={() => setOpen(null)}
                onNavigate={(dir) => {
                  setViaKeyboard(true)
                  setOpen((i + dir + menus.length) % menus.length)
                }}
                onPick={run}
              />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 2, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <NavButton dir={-1} enabled={canGo(state, -1)} title={`Go back${inParens('go-back')}`} onClick={() => run('go-back')} />
            <NavButton dir={1} enabled={canGo(state, 1)} title={`Go forward${inParens('go-forward')}`} onClick={() => run('go-forward')} />
          </div>
          <span style={{ fontSize: 12, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420, userSelect: 'none' }}>
            Switchyard — {title}
          </span>
          {/* As wide as the buttons, so the title stays in the middle. */}
          <span style={{ width: 46, flex: 'none' }} />
        </div>
        <span />
      </div>
      {/* Clicking anywhere else closes an open menu. */}
      {open !== null ? <div onMouseDown={() => setOpen(null)} style={{ position: 'absolute', inset: 0, zIndex: 45 }} /> : null}
    </>
  )
}

/** ← or → (as VS Code's title bar): back to the place before, or forward again. */
function NavButton({ dir, enabled, title, onClick }: { dir: -1 | 1; enabled: boolean; title: string; onClick: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const on = hover && enabled
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: !enabled ? 'var(--t5)' : on ? 'var(--t1)' : 'var(--t3)',
        background: on ? 'color-mix(in srgb, var(--ov) 8%, transparent)' : 'transparent',
        cursor: enabled ? 'pointer' : 'default'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        {dir < 0 ? <path d="M11.5 7H2.5M6 3.5 2.5 7 6 10.5" /> : <path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />}
      </svg>
    </button>
  )
}

/** A menu's entries as Menu items (a separator marks the item after it). */
function toItems(entries: MenuEntry[], onPick: (id: string) => void): MenuItem[] {
  const items: MenuItem[] = []
  let sep = false
  for (const e of entries) {
    if (e.type === 'separator') {
      sep = true
      continue
    }
    items.push({ label: e.label, shortcut: e.key ? keyLabel(e.key) : undefined, disabled: e.enabled === false, separatorBefore: sep, onClick: () => onPick(e.id) })
    sep = false
  }
  return items
}

function TopMenu({
  menu,
  open,
  viaKeyboard,
  onToggle,
  onEnter,
  onClose,
  onNavigate,
  onPick
}: {
  menu: MenuModel
  open: boolean
  viaKeyboard: boolean
  onToggle: () => void
  onEnter: () => void
  onClose: () => void
  onNavigate: (dir: -1 | 1) => void
  onPick: (id: string) => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const label = useRef<HTMLSpanElement>(null)
  return (
    <div>
      <span
        ref={label}
        // mousedown, not click: keeps focus (and the selection) where it
        // was, so Cut/Copy/Paste act on it.
        onMouseDown={(e) => {
          e.preventDefault()
          onToggle()
        }}
        onMouseEnter={() => {
          setHover(true)
          onEnter()
        }}
        onMouseLeave={() => setHover(false)}
        style={{
          height: 24,
          padding: '0 9px',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          font: '12.5px var(--font-ui)',
          color: open || hover ? 'var(--t1)' : 'var(--t2)',
          background: open ? 'color-mix(in srgb, var(--ov) 8%, transparent)' : 'transparent',
          cursor: 'default',
          userSelect: 'none'
        }}
      >
        {menu.label}
      </span>
      {open && label.current ? (
        <Menu
          anchor={{ el: label.current }}
          width={268}
          items={toItems(menu.items, onPick)}
          initialActive={viaKeyboard ? 0 : -1}
          onClose={onClose}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  )
}
