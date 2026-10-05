import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { pluginCommands, runPluginCommand } from '../lib/plugins'
import { statusColor } from '../lib/status'
import { createNote, starterBody } from '../lib/notes'
import { shortcut } from '../lib/shortcuts'
import { fileIcon } from '../lib/fileLang'
import { SEP } from '../lib/paths'
import { errText } from '../lib/errors'
import { keyLabel } from '../lib/keys'
import { wsOpen } from '../lib/wsStore'
import { defaultScope, recentFiles, rememberFile, sameScope, scopeLabel, scopeRoot, scopesOf, searchFiles, useCheckoutFiles, type FileHit } from '../lib/quickOpen'
import { Menu } from './ui'

interface Cmd {
  id: string
  label: React.ReactNode
  sub?: React.ReactNode
  dot?: string
  icon?: React.ReactNode
  run: () => void
  /** Ctrl/Cmd+Enter: a file opens in the external editor. */
  runAlt?: () => void
}

/**
 * Ctrl+K: commands, boards, tasks, notes. Ctrl+P: Go to file - the files of
 * the task's worktree (that branch), or the project's main checkout, which
 * opens read-only. Typing ">" in Go to file switches to commands.
 */
export function CommandPalette(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)
  const palette = state.palette
  const filesMode = palette?.mode === 'files'
  const scope = filesMode ? palette.scope : null
  const root = scope ? scopeRoot(state, scope) : null
  const { list, error } = useCheckoutFiles(root)
  const query = useDeferredValue(palette?.query ?? '')
  const [scopeMenu, setScopeMenu] = useState<{ x: number; y: number } | null>(null)

  const hits = useMemo<FileHit[]>(() => (filesMode && root && list ? searchFiles(list, query, recentFiles(root)) : []), [filesMode, root, list, query])

  const openFile = (hit: FileHit, external: boolean): void => {
    if (!scope || !root) return
    rememberFile(root, hit.path)
    dispatch({ type: 'CLOSE_PALETTE' })
    if (external) {
      window.api.sys.openInEditor(`${root}${SEP}${hit.path.split('/').join(SEP)}`).catch((err: unknown) => dispatch({ type: 'TOAST', text: errText(err) }))
    } else if (scope.taskId) {
      wsOpen(scope.taskId, `file:${hit.path}`)
      dispatch({ type: 'OPEN_TASK', taskId: scope.taskId })
    } else {
      dispatch({ type: 'OPEN_FILE_PREVIEW', projectId: scope.projectId, path: hit.path })
    }
  }

  const commands = useMemo<Cmd[]>(() => {
    if (!state.palette) return []
    if (state.palette.mode === 'files') {
      return hits.map((h) => {
        const slash = h.path.lastIndexOf('/')
        const [ic, icC] = fileIcon(h.path)
        return {
          id: `file-${h.path}`,
          icon: <span style={{ width: 18, flex: 'none', textAlign: 'center', font: "700 8px/1 var(--font-mono)", color: icC }}>{ic}</span>,
          label: (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ whiteSpace: 'nowrap', color: h.changed ? 'var(--c-code)' : 'var(--t1)' }}>
                <Marked text={h.path} from={slash + 1} to={h.path.length} positions={h.positions} />
              </span>
              <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                <Marked text={h.path} from={0} to={Math.max(0, slash)} positions={h.positions} />
              </span>
            </span>
          ),
          sub: h.changed ? <span style={{ color: 'var(--c-amber)' }}>M</span> : h.recent ? 'recent' : undefined,
          run: () => openFile(h, false),
          runAlt: () => openFile(h, true)
        }
      })
    }
    const list: Cmd[] = [
      {
        id: 'go-to-file',
        label: 'Go to file…',
        sub: shortcut('quick-open'),
        run: () => {
          const sc = defaultScope(state)
          if (sc) setTimeout(() => dispatch({ type: 'OPEN_FILE_SEARCH', scope: sc }), 0)
        }
      },
      { id: 'nav-dash', label: 'Go to Projects', run: () => dispatch({ type: 'NAV', view: 'dashboard' }) },
      { id: 'nav-agents', label: 'Go to Agents', run: () => dispatch({ type: 'NAV', view: 'agents' }) },
      { id: 'nav-wt', label: 'Go to Worktrees', run: () => dispatch({ type: 'NAV', view: 'worktrees' }) },
      { id: 'prefs', label: 'Preferences', sub: shortcut('preferences'), run: () => dispatch({ type: 'OPEN_SETTINGS', section: 'general' }) },
      { id: 'new-project', label: 'New project…', sub: shortcut('new-project'), run: () => dispatch({ type: 'OPEN_ADD_PROJECT' }) },
      {
        id: 'new-note',
        label: 'New note',
        sub: shortcut('new-note'),
        run: () =>
          createNote(dispatch, { body: starterBody(), projectId: state.projectId, taskId: null, pinned: false }).then((n) => n && dispatch({ type: 'OPEN_NOTE', id: n.id }))
      }
    ]
    // Plugins' commands ("Hello: Copy task as Markdown").
    for (const c of pluginCommands()) list.push({ id: `plugin-${c.id}`, label: `${c.pluginName}: ${c.title}`, sub: shortcut(c.id), run: () => runPluginCommand(c.id, state, dispatch) })
    for (const p of state.projects) {
      list.push({
        id: `board-${p.id}`,
        label: `Open board · ${p.name}`,
        run: () => dispatch({ type: 'NAV', view: 'board', projectId: p.id })
      })
      list.push({
        id: `issues-${p.id}`,
        label: `Import GitHub issues · ${p.name}`,
        run: () => dispatch({ type: 'OPEN_ISSUES', projectId: p.id })
      })
      list.push({
        id: `settings-${p.id}`,
        label: `Project settings · ${p.name}`,
        run: () => dispatch({ type: 'OPEN_SETTINGS', section: `project:${p.id}` })
      })
    }
    const live = state.tasks
      .filter((t) => t.st)
      .sort((a, b) => {
        const rank = (s: typeof a.st) => (s === 'failed' ? 0 : s === 'waiting' ? 1 : s === 'working' ? 2 : 3)
        return rank(a.st) - rank(b.st)
      })
    for (const t of live) {
      list.push({
        id: `open-${t.id}`,
        label: t.title,
        sub: `${t.key} · ${t.st}`,
        dot: statusColor(t.st),
        run: () => dispatch({ type: 'OPEN_TASK', taskId: t.id })
      })
    }
    for (const t of state.tasks.filter((t) => (t.col === 'backlog' || t.col === 'ready') && !t.agentKind)) {
      list.push({
        id: `start-${t.id}`,
        label: `Start task · ${t.title}`,
        run: () => dispatch({ type: 'OPEN_START_MODAL', taskId: t.id })
      })
    }

    const q = state.palette.query.trim().toLowerCase()
    if (!q) return list
    // Notes come up when searching - by title or by what they say.
    const notes = state.notes
      .filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({ id: `note-${n.id}`, label: `Note · ${n.title}`, sub: state.projects.find((p) => p.id === n.projectId)?.name, run: () => dispatch({ type: 'OPEN_NOTE', id: n.id }) }))
    const text = (x: React.ReactNode): string => (typeof x === 'string' ? x.toLowerCase() : '')
    return [...list.filter((c) => text(c.label).includes(q) || text(c.sub).includes(q)), ...notes]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.palette, state.projects, state.tasks, state.notes, state.projectId, dispatch, hits])

  useEffect(() => {
    if (state.palette) inputRef.current?.focus()
  }, [state.palette])

  const index = Math.min(state.palette?.index ?? 0, Math.max(0, commands.length - 1))

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!palette) return null

  const scopes = scope ? scopesOf(state, scope.projectId) : []
  const cycleScope = (dir: 1 | -1): void => {
    if (!scope || scopes.length < 2) return
    const i = scopes.findIndex((x) => sameScope(x, scope))
    dispatch({ type: 'SET_PALETTE_SCOPE', scope: scopes[(i + dir + scopes.length) % scopes.length] })
  }
  const label = scope ? scopeLabel(state, scope) : null

  return (
    <div
      onClick={() => dispatch({ type: 'CLOSE_PALETTE' })}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'color-mix(in srgb, var(--sh) 50%, transparent)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 96,
        zIndex: 100
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: filesMode ? 680 : 560,
          maxHeight: 420,
          // As tall as its results (the backdrop's flex would stretch it).
          alignSelf: 'flex-start',
          background: 'var(--bg-panel)',
          border: '1px solid var(--bd-3)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px color-mix(in srgb, var(--sh) 50%, transparent)'
        }}
      >
        <input
          ref={inputRef}
          value={palette.query}
          onChange={(e) => {
            const v = e.target.value
            // ">" switches Go to file to commands, as in VS Code.
            if (filesMode && v.startsWith('>')) return dispatch({ type: 'SET_PALETTE_MODE', mode: 'commands', query: v.slice(1) })
            dispatch({ type: 'SET_PALETTE_QUERY', query: v })
          }}
          onKeyDown={(e) => {
            if (filesMode && e.key === 'Tab') {
              e.preventDefault()
              cycleScope(e.shiftKey ? -1 : 1)
            } else if (filesMode && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              commands[index]?.runAlt?.()
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const last = Math.max(0, commands.length - 1)
              dispatch({ type: 'SET_PALETTE_INDEX', index: Math.min(last, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1))) })
            } else if (e.key === 'Enter') {
              commands[index]?.run()
              if (!filesMode) dispatch({ type: 'CLOSE_PALETTE' })
            } else if (e.key === 'Escape') {
              dispatch({ type: 'CLOSE_PALETTE' })
            }
          }}
          placeholder={filesMode ? 'Go to file…  (> for commands)' : 'Search or run…'}
          style={{
            height: 44,
            flex: 'none',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--bd-1)',
            outline: 'none',
            color: 'var(--t1)',
            padding: '0 16px',
            fontSize: 14
          }}
        />
        {filesMode && label ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--bd-1)', font: "11.5px var(--font-mono)", color: 'var(--t4)' }}>
            <span
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setScopeMenu({ x: r.left, y: r.bottom + 4 })
              }}
              title="Which checkout to search - Tab switches"
              style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '0 1 auto', padding: '3px 8px', borderRadius: 5, border: '1px solid var(--bd-3)', color: 'var(--t2)', cursor: 'pointer' }}
            >
              <span style={{ color: 'var(--t1)' }}>{label.project}</span>
              <span>›</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{label.where}</span>
              {label.branch ? <span style={{ color: 'var(--c-blue)', whiteSpace: 'nowrap' }}>⎇ {label.branch}</span> : null}
              <span style={{ color: 'var(--t4)' }}>⌄</span>
            </span>
            {!scope?.taskId ? (
              <span title="Files of the main checkout open in a read-only preview" style={{ whiteSpace: 'nowrap', flex: 'none' }}>
                read-only
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            <span style={{ whiteSpace: 'nowrap', flex: 'none' }}>
              {error ? <span style={{ color: 'var(--c-red)' }}>{error}</span> : !list ? 'Listing files…' : `${list.files.length.toLocaleString()}${list.truncated ? '+' : ''} files`}
            </span>
          </div>
        ) : null}
        <div style={{ overflow: 'auto', padding: 4, minHeight: 0 }}>
          {commands.length === 0 ? (
            <div style={{ padding: '14px 16px', color: 'var(--t3)', fontSize: 13 }}>
              {filesMode && !root ? 'This checkout has no folder on disk.' : filesMode && !list ? 'Listing files…' : filesMode ? 'No file matches.' : 'No results.'}
            </div>
          ) : (
            commands.map((c, i) => (
              <div
                key={c.id}
                ref={i === index ? selectedRef : undefined}
                onMouseMove={() => i !== index && dispatch({ type: 'SET_PALETTE_INDEX', index: i })}
                onClick={(e) => {
                  if ((e.ctrlKey || e.metaKey) && c.runAlt) c.runAlt()
                  else c.run()
                  if (!filesMode) dispatch({ type: 'CLOSE_PALETTE' })
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  height: 36,
                  padding: '0 10px',
                  borderRadius: 5,
                  background: i === index ? 'color-mix(in srgb, var(--ov) 6%, transparent)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 13
                }}
              >
                {c.dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} /> : null}
                {c.icon}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--t1)' }}>{c.label}</span>
                {c.sub ? <span style={{ font: "11px var(--font-mono)", color: 'var(--t4)', flex: 'none' }}>{c.sub}</span> : null}
              </div>
            ))
          )}
        </div>
        {filesMode ? (
          <div style={{ flex: 'none', display: 'flex', gap: 14, padding: '7px 14px', borderTop: '1px solid var(--bd-1)', font: "11px var(--font-mono)", color: 'var(--t5)', whiteSpace: 'nowrap' }}>
            <span>↵ {scope?.taskId ? 'open' : 'preview'}</span>
            <span>{keyLabel('⌘↵')} open in editor</span>
            {scopes.length > 1 ? <span>Tab switch checkout</span> : null}
            <span>&gt; commands</span>
          </div>
        ) : null}
      </div>
      {scopeMenu && scope ? (
        <Menu
          anchor={scopeMenu}
          items={scopes.map((sc) => {
            const l = scopeLabel(state, sc)
            return {
              label: sc.taskId ? `${l.where} · ${l.branch}` : `Main checkout · ${l.branch} (read-only)`,
              checked: sameScope(sc, scope),
              onClick: () => dispatch({ type: 'SET_PALETTE_SCOPE', scope: sc })
            }
          })}
          onClose={() => {
            setScopeMenu(null)
            inputRef.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

/** text[from..to), with the matched letters in it highlighted. */
function Marked({ text, from, to, positions }: { text: string; from: number; to: number; positions: number[] }): React.JSX.Element {
  const marks = new Set(positions.filter((p) => p >= from && p < to))
  if (!marks.size) return <>{text.slice(from, to)}</>
  const parts: React.ReactNode[] = []
  let run = ''
  let marked = false
  const flush = (): void => {
    if (!run) return
    parts.push(marked ? <b key={parts.length} style={{ color: 'var(--c-blue)', fontWeight: 600 }}>{run}</b> : <React.Fragment key={parts.length}>{run}</React.Fragment>)
    run = ''
  }
  for (let i = from; i < to; i++) {
    const m = marks.has(i)
    if (m !== marked) {
      flush()
      marked = m
    }
    run += text[i]
  }
  flush()
  return <>{parts}</>
}
