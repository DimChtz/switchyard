import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { allKeyCommands, bindings } from '../lib/shortcuts'
import { evalWhen, formatKey } from '@shared/keybindings'
import { isMac } from '../lib/keys'
import type { ViewName } from '@shared/types'

/** Opens (or closes) the cheat sheet: ? anywhere you aren't typing, or Help → Keyboard cheat sheet. */
export function toggleKeyboardHelp(): void {
  window.dispatchEvent(new CustomEvent('switchyard:keys'))
}

type Pair = [string, string]

const mod = isMac ? '⌘' : 'Ctrl+'

/** Keys a screen handles itself (not commands you can rebind). */
function screenKeys(view: ViewName): { title: string; keys: Pair[] } | null {
  if (view === 'board')
    return {
      title: 'On the board',
      keys: [
        ['← → ↑ ↓  or  h j k l', 'Move between cards'],
        ['↵', 'Open the task (or start it)'],
        ['Right-click a card', 'Its actions: start, pin, move, delete…']
      ]
    }
  if (view === 'inbox')
    return {
      title: 'In the inbox',
      keys: [
        ['j / k', 'Next / previous item'],
        ['r', 'Reply']
      ]
    }
  if (view === 'workspace')
    return {
      title: 'In the editor and terminals',
      keys: [
        [`${mod}F`, 'Find (and replace) in the file or terminal'],
        [isMac ? '⌃G' : 'Ctrl+G', 'Go to line'],
        [isMac ? '⇧⌘O' : 'Ctrl+Shift+O', 'Go to symbol'],
        [`${mod}S`, 'Save the file'],
        [`${mod}click a path`, 'Open a file named in a terminal, at its line'],
        ['Click a change mark', "See what a changed line was, or put it back"]
      ]
    }
  return null
}

/**
 * The keyboard cheat sheet: the shortcuts that work where you are, grouped as
 * the menus are, plus the screen's own keys. Typing filters it.
 */
export function KeyboardHelp(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const toggle = (): void => {
      setQuery('')
      setOpen((o) => !o)
    }
    window.addEventListener('switchyard:keys', toggle)
    return () => window.removeEventListener('switchyard:keys', toggle)
  }, [])

  const groups = useMemo(() => {
    if (!open) return []
    const ctx = { [state.view]: true, terminalFocus: false, inputFocus: false, dialogOpen: false }
    const titles = new Map(allKeyCommands().map((c) => [c.id, c]))
    const byCat = new Map<string, Pair[]>()
    const seen = new Set<string>()
    for (const b of bindings()) {
      const c = titles.get(b.command)
      if (!c || !b.key || seen.has(b.command) || !evalWhen(b.when, ctx)) continue
      seen.add(b.command)
      byCat.set(c.category, [...(byCat.get(c.category) ?? []), [formatKey(b.key, isMac), c.title]])
    }
    const own = screenKeys(state.view)
    const list: { title: string; keys: Pair[] }[] = [...(own ? [own] : []), ...[...byCat].map(([title, keys]) => ({ title, keys }))]
    const q = query.trim().toLowerCase()
    return q ? list.map((g) => ({ ...g, keys: g.keys.filter(([k, t]) => t.toLowerCase().includes(q) || k.toLowerCase().includes(q)) })).filter((g) => g.keys.length) : list
  }, [open, query, state.view, state.keybindings]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null
  const close = (): void => setOpen(false)
  return (
    <div
      onMouseDown={close}
      style={{ position: 'absolute', inset: 0, zIndex: 110, background: 'color-mix(in srgb, var(--sh) 50%, transparent)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 64 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(820px, calc(100vw - 64px))',
          maxHeight: 'calc(100vh - 128px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
          border: '1px solid var(--bd-3)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 20px 60px color-mix(in srgb, var(--sh) 50%, transparent)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--bd-2)' }}>
          <span style={{ font: '600 14px var(--font-ui)', color: 'var(--t1)' }}>Keyboard shortcuts</span>
          <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)' }}>here and everywhere</span>
          <span style={{ flex: 1 }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
            placeholder="Filter…"
            spellCheck={false}
            style={{ width: 200, height: 26, boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg-app)', border: '1px solid var(--bd-3)', borderRadius: 5, color: 'var(--t1)', font: '12.5px var(--font-ui)', outline: 'none' }}
          />
        </div>
        <div style={{ overflow: 'auto', padding: '14px 16px 18px', columnWidth: 360, columnGap: 28 }}>
          {groups.length ? null : <div style={{ font: '13px var(--font-ui)', color: 'var(--t4)' }}>No shortcut matches “{query}”.</div>}
          {groups.map((g) => (
            <div key={g.title} style={{ breakInside: 'avoid', marginBottom: 16 }}>
              <div style={{ font: '500 10.5px var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t5)', paddingBottom: 6 }}>{g.title}</div>
              {g.keys.map(([k, t]) => (
                <div key={`${k}${t}`} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '3px 0' }}>
                  <span style={{ flex: 1, minWidth: 0, font: '12.5px var(--font-ui)', color: 'var(--t2)' }}>{t}</span>
                  <span style={{ flex: 'none', font: '11.5px var(--font-mono)', color: 'var(--t1)', padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--ov) 7%, transparent)' }}>{k}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 16px', borderTop: '1px solid var(--bd-2)', font: '11.5px var(--font-ui)', color: 'var(--t4)' }}>
          <span>Esc closes</span>
          <span style={{ flex: 1 }} />
          <span
            onClick={() => {
              close()
              dispatch({ type: 'OPEN_SETTINGS', section: 'keys' })
            }}
            style={{ color: 'var(--c-blue)', cursor: 'pointer' }}
          >
            Change them in Settings → Keyboard shortcuts
          </span>
        </div>
      </div>
    </div>
  )
}
