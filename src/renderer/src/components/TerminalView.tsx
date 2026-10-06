import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store/AppStore'
import { editorFontStack } from '../lib/editorPrefs'
import type { Prefs } from '@shared/types'
import { errText } from '../lib/errors'
import { isMac, keyLabel } from '../lib/keys'
import { Menu, type MenuItem } from './ui'
import { prefsFor, projectIdForPath } from '../lib/projectPrefs'
import { tokenValue } from '../lib/theme'
import { FILE_DRAG_TYPE, pathStyleFor, pathsForTerminal } from '../lib/dropPaths'
import type { ITheme } from '@xterm/xterm'

/** The theme's terminal colors. */
function terminalTheme(): ITheme {
  const v = tokenValue
  return {
    background: v('term-bg'),
    foreground: v('term-fg'),
    cursor: v('term-cursor'),
    cursorAccent: v('term-bg'),
    selectionBackground: v('term-selection'),
    black: v('ansi-black'),
    red: v('ansi-red'),
    green: v('ansi-green'),
    yellow: v('ansi-yellow'),
    blue: v('ansi-blue'),
    magenta: v('ansi-magenta'),
    cyan: v('ansi-cyan'),
    white: v('ansi-white'),
    brightBlack: v('ansi-bright-black'),
    brightRed: v('ansi-bright-red'),
    brightGreen: v('ansi-bright-green'),
    brightYellow: v('ansi-bright-yellow'),
    brightBlue: v('ansi-bright-blue'),
    brightMagenta: v('ansi-bright-magenta'),
    brightCyan: v('ansi-bright-cyan'),
    brightWhite: v('ansi-bright-white')
  }
}

// Each open terminal's "type these paths in" (a file dropped on it through
// the workspace's drop zones, which sit over it while a tab is dragged).
const pasteTargets = new Map<string, (paths: string[]) => void>()
/** Types paths into a session's terminal, quoted for its shell; false when it isn't showing. */
export function pastePathsInto(sessionId: string, paths: string[]): boolean {
  const f = pasteTargets.get(sessionId)
  if (!f) return false
  f(paths)
  return true
}

interface Props {
  sessionId: string
  cwd: string
  cmd?: string
  args?: string[]
  execCommand?: string
  onExit?: (exitCode: number) => void
  /** Only show an existing session; never start a process. */
  attachOnly?: boolean
  /** Extra environment variables for a process this view starts. */
  env?: Record<string, string>
  /** Takes the keyboard when it opens (not when it opens hidden, behind another tab). Default: yes. */
  autoFocus?: boolean
}

export function TerminalView({ sessionId, cwd, cmd, args, execCommand, onExit, attachOnly, env, autoFocus = true }: Props): React.JSX.Element {
  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus
  const containerRef = useRef<HTMLDivElement>(null)
  // Where xterm draws: inside the container's margin. (Not the container itself - with border-box
  // sizing the fit addon counts its padding as room, and the text ran into the edges.)
  const hostRef = useRef<HTMLDivElement>(null)
  const { state } = useAppStore()
  // A project can set its own terminal font and the like.
  const prefs = prefsFor(state, projectIdForPath(state, cwd))
  const options = termOptions(prefs)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const copyOnSelectRef = useRef(prefs.termCopyOnSelect)
  copyOnSelectRef.current = prefs.termCopyOnSelect
  const termRef = useRef<{ term: Terminal; fit: FitAddon; search: SearchAddon } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // Find in the terminal (Ctrl+F / ⌘F while it has focus).
  const [find, setFind] = useState<string | null>(null)
  const gpuRef = useRef(prefs.termGpu)
  gpuRef.current = prefs.termGpu

  // Settings → Terminal applies to open terminals too.
  const optionsKey = JSON.stringify(options)
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    Object.assign(t.term.options, optionsRef.current)
    t.fit.fit()
    window.api.pty.resize(sessionId, t.term.cols, t.term.rows)
  }, [optionsKey, sessionId])

  useEffect(() => {
    const container = hostRef.current
    if (!container) return

    let cancelled = false
    let teardown: (() => void) | null = null

    // Deferred to a macrotask so React 18 StrictMode's dev-only synchronous
    // mount -> cleanup -> mount cycle never reaches the real pty spawn: the
    // phantom first mount's cleanup runs (and cancels this) before the
    // timeout fires, so only the surviving mount ever touches the PTY.
    // Spawning, immediately killing, and respawning a real ConPTY process
    // in quick succession is flaky on Windows (the second process can die
    // with STATUS_CONTROL_C_EXIT) - this avoids that churn entirely.
    const timer = setTimeout(async () => {
      if (cancelled) return
      // The bundled monospace font first, so xterm measures its cells with it.
      await document.fonts.load(`${optionsRef.current.fontSize}px ${optionsRef.current.fontFamily}`).catch(() => {})
      if (cancelled) return

      const term = new Terminal({
        ...optionsRef.current,
        lineHeight: 1.45,
        theme: terminalTheme(),
        // Unicode 11 widths (emoji, CJK) - the agents' TUIs draw with them.
        allowProposedApi: true
      })
      const fit = new FitAddon()
      const search = new SearchAddon()
      term.loadAddon(fit)
      term.loadAddon(search)
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
      // Web addresses open in the browser with Ctrl/⌘+click (a plain click selects, as in VS Code).
      term.loadAddon(
        new WebLinksAddon((e, uri) => {
          if ((e.ctrlKey || e.metaKey) && /^https?:\/\//i.test(uri)) window.api.sys.openExternal(uri)
        })
      )
      term.open(container)
      // Drawn with the GPU (Settings → Terminal); back to the default renderer if WebGL goes away.
      if (gpuRef.current) {
        try {
          const gl = new WebglAddon()
          gl.onContextLoss(() => gl.dispose())
          term.loadAddon(gl)
        } catch {
          // no WebGL here - the default renderer it is
        }
      }
      fit.fit()
      termRef.current = { term, fit, search }
      if (autoFocusRef.current) term.focus()

      // A session spawned before this view ever mounted (e.g. the agent is
      // started eagerly the moment a task launches, well before the user
      // opens the Terminal tab) already emitted output over IPC while nobody
      // was listening yet - that data is gone from the wire. Queue anything
      // that arrives on the live listener until the main process's buffered
      // replay of that session's output so far has been written first, so
      // the terminal shows everything in order instead of just what happened
      // to arrive after this view mounted.
      let ready = true
      let pending: string[] = []

      // Re-attaching to an already-running session (e.g. navigating back to a
      // task whose agent kept working in the background) must not spawn a
      // second process under the same id - just start listening to it.
      window.api.pty.info(sessionId).then(async (info) => {
        if (cancelled) return
        if (!info) {
          if (attachOnly) return
          window.api.pty.spawn({ id: sessionId, cwd, cmd, args, execCommand, env, cols: term.cols, rows: term.rows }).catch((err: unknown) => {
            if (cancelled) return
            const message = errText(err)
            term.write(`\r\n\x1b[31mFailed to start: ${message}\x1b[0m\r\n`)
          })
          return
        }
        ready = false
        const buffered = await window.api.pty.getBuffer(sessionId)
        if (cancelled) return
        term.write(buffered)
        if (!info.running) term.write(`\r\n\x1b[90m[process exited with code ${info.exitCode}]\x1b[0m\r\n`)
        term.write(pending.join(''))
        pending = []
        ready = true
        if (info.running) window.api.pty.resize(sessionId, term.cols, term.rows)
      })

      const offData = window.api.pty.onData((id, data) => {
        if (id !== sessionId) return
        if (!ready) {
          pending.push(data)
          return
        }
        term.write(data)
      })
      const offExit = window.api.pty.onExit((id, exitCode) => {
        if (id !== sessionId) return
        term.write(`\r\n\x1b[90m[process exited with code ${exitCode}]\x1b[0m\r\n`)
        onExit?.(exitCode)
      })

      // Ctrl+Shift+C / Ctrl+Shift+V copy and paste (Ctrl+C stays the shell's
      // interrupt), as in VS Code's terminal. macOS uses ⌘C / ⌘V already.
      term.attachCustomKeyEventHandler((e) => {
        // Ctrl+F / ⌘F: find in the terminal's output.
        if (e.type === 'keydown' && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
          setFind((f) => f ?? (term.hasSelection() ? term.getSelection() : ''))
          return false
        }
        if (isMac) return true
        {
          if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey || e.altKey) return true
          if (e.code === 'KeyC') {
            if (term.hasSelection()) window.api.sys.copy(term.getSelection())
            return false
          }
          if (e.code === 'KeyV') {
            window.api.menu.role('paste')
            return false
          }
          return true
        }
      })

      const onData = term.onData((data) => window.api.pty.write(sessionId, data))
      const onSelect = term.onSelectionChange(() => {
        if (copyOnSelectRef.current && term.hasSelection()) window.api.sys.copy(term.getSelection())
      })

      const resizeObserver = new ResizeObserver(() => {
        fit.fit()
        window.api.pty.resize(sessionId, term.cols, term.rows)
      })
      resizeObserver.observe(container)
      // A new theme: the terminal's colors follow (xterm draws them itself, so it needs values).
      const onTheme = (): void => {
        term.options.theme = terminalTheme()
      }
      window.addEventListener('switchyard:theme', onTheme)

      teardown = () => {
        // Deliberately does NOT kill the pty session: leaving this view
        // (switching workspace tabs, opening a different task) should not
        // stop a shell or an agent that's meant to keep running in the
        // background. Sessions are only killed by an explicit user action
        // (closing a shell tab, stopping the preview server) or when the
        // underlying task/worktree goes away.
        offData()
        offExit()
        onData.dispose()
        onSelect.dispose()
        resizeObserver.disconnect()
        window.removeEventListener('switchyard:theme', onTheme)
        termRef.current = null
        term.dispose()
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(timer)
      teardown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const focusTerm = (): void => containerRef.current?.querySelector('textarea')?.focus()

  // Files dropped on it (from the explorer, or the system's file manager) are typed in as paths.
  const [dropping, setDropping] = useState(false)
  const droppable = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(FILE_DRAG_TYPE) || e.dataTransfer.types.includes('Files')
  const typePaths = (paths: string[]): void => {
    const term = termRef.current?.term
    if (!term || !paths.length) return
    // An agent isn't a shell: its paths are written as the platform's shell would.
    const style = pathStyleFor(attachOnly ? undefined : (cmd ?? prefs.shell), window.electron.process.platform)
    // paste(): bracketed when the program asked for it, so nothing runs by itself.
    term.paste(pathsForTerminal(paths, cwd, style))
    focusTerm()
  }
  const typePathsRef = useRef(typePaths)
  typePathsRef.current = typePaths
  useEffect(() => {
    const f = (paths: string[]): void => typePathsRef.current(paths)
    pasteTargets.set(sessionId, f)
    return () => {
      if (pasteTargets.get(sessionId) === f) pasteTargets.delete(sessionId)
    }
  }, [sessionId])
  const onDrop = (e: React.DragEvent): void => {
    setDropping(false)
    if (!droppable(e)) return
    e.preventDefault()
    const ours = e.dataTransfer.getData(FILE_DRAG_TYPE)
    let paths: string[]
    try {
      paths = ours ? (JSON.parse(ours) as string[]) : [...e.dataTransfer.files].map((f) => window.api.fs.pathForFile(f)).filter(Boolean)
    } catch {
      return
    }
    typePaths(paths)
  }
  const menuItems = (): MenuItem[] => {
    const term = termRef.current?.term
    return [
      { label: 'Copy', shortcut: keyLabel(isMac ? '⌘C' : '⇧⌘C'), disabled: !term?.hasSelection(), onClick: () => term && window.api.sys.copy(term.getSelection()) },
      {
        label: 'Paste',
        shortcut: keyLabel(isMac ? '⌘V' : '⇧⌘V'),
        onClick: () => {
          // Into xterm's input, which sends it to the process.
          focusTerm()
          window.api.menu.role('paste')
        }
      },
      { label: 'Select All', onClick: () => term?.selectAll() },
      { label: 'Find…', shortcut: keyLabel('⌘F'), onClick: () => setFind((f) => f ?? '') },
      { label: 'Clear', separatorBefore: true, onClick: () => term?.clear() }
    ]
  }

  return (
    <>
      <div
        ref={containerRef}
        onClick={focusTerm}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          if (!droppable(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={onDrop}
        style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}
      >
        <div ref={hostRef} style={{ position: 'absolute', inset: '10px 8px 8px 14px' }} />
        {dropping ? (
          <div
            style={{
              position: 'absolute',
              inset: 4,
              zIndex: 5,
              pointerEvents: 'none',
              border: '1px dashed color-mix(in srgb, var(--c-blue) 70%, transparent)',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--c-blue) 7%, transparent)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: 14,
              font: '12px var(--font-ui)',
              color: 'var(--t1)'
            }}
          >
            <span style={{ background: 'var(--bg-menu)', border: '1px solid var(--bd-4)', borderRadius: 5, padding: '3px 9px' }}>Drop to insert the path</span>
          </div>
        ) : null}
        {find !== null ? (
          <FindBar
            initial={find}
            search={termRef.current?.search ?? null}
            onClose={() => {
              setFind(null)
              termRef.current?.search.clearDecorations()
              focusTerm()
            }}
          />
        ) : null}
      </div>
      {menu ? <Menu anchor={menu} items={menuItems()} onClose={() => setMenu(null)} /> : null}
    </>
  )
}

/** The terminal's find bar: next/previous match, case and regex, Esc closes. */
function FindBar({ initial, search, onClose }: { initial: string; search: SearchAddon | null; onClose: () => void }): React.JSX.Element {
  const [q, setQ] = useState(initial)
  const [caseSensitive, setCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [count, setCount] = useState<{ index: number; total: number } | null>(null)
  useEffect(() => {
    if (!search) return
    const sub = search.onDidChangeResults((r) => setCount(r ? { index: r.resultIndex, total: r.resultCount } : null))
    return () => sub.dispose()
  }, [search])
  // (Decorations on: that's what makes it count the matches.) Colors from the theme.
  const opts = { caseSensitive, regex, decorations: { matchOverviewRuler: tokenValue('t3'), activeMatchColorOverviewRuler: tokenValue('c-blue'), matchBackground: tokenValue('term-selection'), activeMatchBackground: tokenValue('c-amber') } }
  const go = (back = false): void => {
    if (!search || !q) return
    if (back) search.findPrevious(q, opts)
    else search.findNext(q, opts)
  }
  useEffect(() => {
    if (q) search?.findNext(q, { ...opts, incremental: true })
    else search?.clearDecorations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, caseSensitive, regex])
  const toggle = (on: boolean): React.CSSProperties => ({ font: '11px var(--font-mono)', padding: '1px 5px', borderRadius: 3, cursor: 'pointer', color: on ? 'var(--t1)' : 'var(--t4)', background: on ? 'color-mix(in srgb, var(--c-blue) 25%, transparent)' : 'transparent' })
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 6, right: 14, zIndex: 5, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', background: 'var(--bg-panel)', border: '1px solid var(--bd-4)', borderRadius: 6, boxShadow: '0 6px 20px color-mix(in srgb, var(--sh) 40%, transparent)' }}
    >
      <input
        autoFocus
        value={q}
        placeholder="Find"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'Enter') go(e.shiftKey)
        }}
        style={{ width: 180, background: 'var(--bg-input)', border: '1px solid var(--bd-3)', borderRadius: 4, padding: '3px 6px', color: 'var(--t1)', font: '12px var(--font-mono)', outline: 'none' }}
      />
      <span style={{ font: '11px var(--font-mono)', color: 'var(--t3)', minWidth: 44, textAlign: 'right' }}>{q ? (count && count.total ? `${count.index + 1}/${count.total}` : 'none') : ''}</span>
      <span title="Match case" style={toggle(caseSensitive)} onClick={() => setCase((v) => !v)}>
        Aa
      </span>
      <span title="Regular expression" style={toggle(regex)} onClick={() => setRegex((v) => !v)}>
        .*
      </span>
      <span title="Previous (Shift+Enter)" style={toggle(false)} onClick={() => go(true)}>
        ↑
      </span>
      <span title="Next (Enter)" style={toggle(false)} onClick={() => go()}>
        ↓
      </span>
      <span title="Close (Esc)" style={toggle(false)} onClick={onClose}>
        ×
      </span>
    </div>
  )
}

function termOptions(p: Prefs): { fontFamily: string; fontSize: number; scrollback: number; cursorStyle: Prefs['termCursor']; cursorBlink: boolean } {
  return {
    fontFamily: editorFontStack(p.termFont),
    fontSize: p.termFontSize,
    scrollback: p.termScrollback,
    cursorStyle: p.termCursor,
    cursorBlink: p.termCursorBlink
  }
}
