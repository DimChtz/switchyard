import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { useHover } from '../../lib/useHover'
import { fileIcon } from '../../lib/fileLang'
import { errText } from '../../lib/errors'
import { keyLabel } from '../../lib/keys'
import { confirm } from '../../components/ui'
import { matchLines, pathFilter, searchRegex, type FileMatches, type LineMatch, type TextSearchOptions, type TextSearchResult } from '@shared/textSearch'

/** What the search panel remembers per task while the workspace is closed. */
interface SearchState extends TextSearchOptions {
  replace: string
  showReplace: boolean
  showOptions: boolean
}

const EMPTY: SearchState = { query: '', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '', replace: '', showReplace: false, showOptions: false }
const remembered = new Map<string, SearchState>()

const MONO = "var(--font-mono)"
const BOX: React.CSSProperties = { height: 28, display: 'flex', alignItems: 'center', gap: 2, paddingRight: 3, background: 'var(--bg-input)', borderRadius: 4, boxSizing: 'border-box' }
const INPUT: React.CSSProperties = { flex: 1, minWidth: 0, height: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '12.5px var(--font-ui)', padding: '0 8px' }

/**
 * The explorer's search (Ctrl+Shift+F): every matching line in the task's
 * worktree, file by file, with match case / whole word / regular
 * expression, files to include and exclude, and replace. Replacing saves
 * the files - except ones open with unsaved changes, which change in the
 * editor.
 */
export function ExplorerSearch({
  taskId,
  root,
  focusKey,
  refreshKey,
  unsaved,
  isDirty,
  replaceInEditor,
  onReplaced,
  onOpenAt,
  onExit
}: {
  taskId: string
  root: string
  /** Changes when the query box should take focus (Ctrl+Shift+F, the search icon). */
  focusKey: number
  /** Changes when files may have changed (Refresh, a save). */
  refreshKey: number
  /** Text of files open with unsaved changes - searched instead of what's on disk. */
  unsaved: Record<string, string>
  isDirty: (path: string) => boolean
  /** Replaces in an open file's unsaved text; returns how many. */
  replaceInEditor: (path: string, o: TextSearchOptions, replacement: string) => number
  /** These files changed on disk. */
  onReplaced: (paths: string[]) => void
  onOpenAt: (path: string, line: number, col: number, len: number) => void
  onExit: () => void
}): React.JSX.Element {
  const { dispatch } = useAppStore()
  const [s, setS] = useState<SearchState>(() => remembered.get(taskId) ?? EMPTY)
  const set = (patch: Partial<SearchState>): void => setS((cur) => ({ ...cur, ...patch }))
  useEffect(() => {
    remembered.set(taskId, s)
  }, [taskId, s])

  const [result, setResult] = useState<TextSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [rerun, setRerun] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  // Searches a moment after typing stops; a newer search wins over an older one.
  const seq = useRef(0)
  const opts: TextSearchOptions = { query: s.query, regex: s.regex, caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, include: s.include, exclude: s.exclude }
  const optsKey = JSON.stringify(opts)
  useEffect(() => {
    const id = ++seq.current
    if (!s.query) {
      setResult(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      window.api.fs
        .searchText(root, opts)
        .then((r) => id === seq.current && setResult(r))
        .catch((err: unknown) => id === seq.current && setResult({ files: [], total: 0, truncated: false, error: errText(err) }))
        .finally(() => id === seq.current && setSearching(false))
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optsKey, root, refreshKey, rerun])

  // Files with unsaved changes: their editor text, not the disk's.
  const shown = useMemo<TextSearchResult | null>(() => {
    const { rx } = searchRegex(opts)
    if (!result || !rx || result.error || !Object.keys(unsaved).length) return result
    const keep = pathFilter(opts)
    const files = result.files.filter((f) => !(f.path in unsaved))
    for (const [path, text] of Object.entries(unsaved)) {
      if (!keep(path)) continue
      const lines = matchLines(text, rx)
      if (lines.length) files.push({ path, lines, count: lines.reduce((n, l) => n + l.ranges.length, 0) })
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { ...result, files, total: files.reduce((n, f) => n + f.count, 0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, unsaved])

  const replaceIn = async (files: FileMatches[], ask: boolean): Promise<void> => {
    if (!files.length) return
    const count = files.reduce((n, f) => n + f.count, 0)
    if (ask) {
      const ok = await confirm({
        title: `Replace ${count} occurrence${count > 1 ? 's' : ''} in ${files.length} file${files.length > 1 ? 's' : ''}?`,
        body: `With “${s.replace}”. The files are saved - files open with unsaved changes change in the editor instead.`,
        confirmLabel: 'Replace all'
      })
      if (!ok) return
    }
    const inEditor = files.filter((f) => isDirty(f.path)).map((f) => f.path)
    const onDisk = files.filter((f) => !isDirty(f.path)).map((f) => f.path)
    try {
      let done = 0
      let changed = 0
      for (const path of inEditor) {
        const n = replaceInEditor(path, opts, s.replace)
        if (n) {
          done += n
          changed++
        }
      }
      if (onDisk.length) {
        const r = await window.api.fs.replaceText(root, opts, s.replace, onDisk)
        done += r.count
        changed += r.files
        onReplaced(onDisk)
      }
      dispatch({ type: 'TOAST', text: `Replaced ${done} occurrence${done === 1 ? '' : 's'} in ${changed} file${changed === 1 ? '' : 's'}${inEditor.length ? ` · ${inEditor.length} unsaved` : ''}` })
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not replace: ${errText(err)}` })
    }
    setRerun((n) => n + 1)
  }

  const toggles: [keyof SearchState, string, React.ReactNode, string][] = [
    ['caseSensitive', 'Match case', 'Aa', 'C'],
    ['wholeWord', 'Match whole word', <span key="ww" style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>ab</span>, 'W'],
    ['regex', 'Use regular expression', '.*', 'R']
  ]
  const error = shown?.error
  const summary = error
    ? error
    : !s.query
      ? ''
      : searching && !shown
        ? 'Searching…'
        : shown && shown.total
          ? `${shown.total}${shown.truncated ? '+' : ''} result${shown.total > 1 ? 's' : ''} in ${shown.files.length} file${shown.files.length > 1 ? 's' : ''}`
          : 'No results'

  return (
    <>
      <div style={{ flex: 'none', padding: '8px 10px 6px 6px', display: 'flex', gap: 4 }}>
        <HoverSpan
          onClick={() => set({ showReplace: !s.showReplace })}
          title="Toggle replace"
          style={{ width: 16, height: 28, flex: 'none', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-dim)', cursor: 'pointer' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: s.showReplace ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .12s ease' }}>
            <path d="M3.5 1.8 6.7 5 3.5 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </HoverSpan>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...BOX, border: `1px solid ${error ? 'color-mix(in srgb, var(--c-red) 60%, transparent)' : 'var(--bd-3)'}` }}>
            <input
              ref={inputRef}
              value={s.query}
              onChange={(e) => set({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (s.query) set({ query: '' })
                  else onExit()
                } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
                  const t = toggles.find(([, , , k]) => e.code === `Key${k}`)
                  if (t) {
                    e.preventDefault()
                    set({ [t[0]]: !s[t[0]] } as Partial<SearchState>)
                  }
                }
              }}
              spellCheck={false}
              placeholder="Search"
              title={`Search files ${keyLabel('⇧⌘F')}`}
              style={INPUT}
            />
            {toggles.map(([k, title, label, key]) => (
              <Toggle key={k} on={!!s[k]} title={`${title} ${keyLabel(`⌥${key}`)}`} onClick={() => set({ [k]: !s[k] } as Partial<SearchState>)}>
                {label}
              </Toggle>
            ))}
          </div>
          {s.showReplace ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ ...BOX, flex: 1, minWidth: 0, border: '1px solid var(--bd-3)', paddingRight: 0 }}>
                <input
                  value={s.replace}
                  onChange={(e) => set({ replace: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      replaceIn(shown?.files ?? [], true)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      set({ showReplace: false })
                    }
                  }}
                  spellCheck={false}
                  placeholder="Replace"
                  style={INPUT}
                />
              </div>
              <HoverSpan
                onClick={() => replaceIn(shown?.files ?? [], true)}
                title={`Replace all ${keyLabel('⌘↵')}`}
                style={{ width: 26, height: 26, flex: 'none', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: shown?.total ? 'var(--t2)' : 'var(--t5)', cursor: shown?.total ? 'pointer' : 'default', border: '1px solid var(--bd-3)', boxSizing: 'border-box' }}
              >
                <ReplaceIcon size={14} />
              </HoverSpan>
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
            <span style={{ flex: 1, minWidth: 0, font: '11.5px var(--font-ui)', color: error ? 'var(--c-red)' : 'var(--t3)' }}>{summary}</span>
            {s.query ? (
              <HoverSpan
                onClick={() => set({ query: '', replace: '' })}
                title="Clear search · Esc"
                hoverStyle={{ color: 'var(--t1)', background: 'var(--bg-hover)' }}
                style={{ height: 18, padding: '0 5px', borderRadius: 3, display: 'flex', alignItems: 'center', font: '11px var(--font-ui)', color: 'var(--t-dim)', cursor: 'pointer' }}
              >
                Clear
              </HoverSpan>
            ) : null}
            <Toggle on={s.showOptions || !!(s.include || s.exclude)} title="Toggle include / exclude" onClick={() => set({ showOptions: !s.showOptions })} wide>
              ···
            </Toggle>
          </div>
          {s.showOptions ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: '11px var(--font-ui)', color: 'var(--t3)' }}>files to include</span>
              <GlobInput value={s.include} placeholder="e.g. src/**/*.ts, *.tsx" onChange={(v) => set({ include: v })} />
              <span style={{ font: '11px var(--font-ui)', color: 'var(--t3)', marginTop: 2 }}>files to exclude</span>
              <GlobInput value={s.exclude} placeholder="e.g. **/*.test.ts, vendor" onChange={(v) => set({ exclude: v })} />
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 6px 10px' }}>
        {(shown?.files ?? []).map((f) => (
          <ResultGroup
            key={f.path}
            file={f}
            closed={closed.has(f.path)}
            dirty={isDirty(f.path)}
            replace={s.showReplace ? s.replace : null}
            onToggle={() =>
              setClosed((prev) => {
                const next = new Set(prev)
                if (next.has(f.path)) next.delete(f.path)
                else next.add(f.path)
                return next
              })
            }
            onReplaceFile={() => replaceIn([f], false)}
            onOpenAt={onOpenAt}
          />
        ))}
      </div>
    </>
  )
}

function ResultGroup({
  file,
  closed,
  dirty,
  replace,
  onToggle,
  onReplaceFile,
  onOpenAt
}: {
  file: FileMatches
  closed: boolean
  dirty: boolean
  /** The replacement shown over each match (the replace field is open). */
  replace: string | null
  onToggle: () => void
  onReplaceFile: () => void
  onOpenAt: (path: string, line: number, col: number, len: number) => void
}): React.JSX.Element {
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const dir = slash > 0 ? file.path.slice(0, slash) : ''
  const [ic, icC] = fileIcon(name)
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <HoverSpan
        onClick={onToggle}
        title={file.path}
        hoverStyle={{ background: 'var(--bg-menu)' }}
        style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 6px 0 4px', borderRadius: 4, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ width: 14, flex: 'none', display: 'flex', justifyContent: 'center', color: 'var(--t3)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: closed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform .12s ease' }}>
            <path d="M3.5 1.8 6.7 5 3.5 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span style={{ width: 18, flex: 'none', font: `700 8px/1 ${MONO}`, color: icC, textAlign: 'center' }}>{ic}</span>
        <span style={{ font: '12.5px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap' }}>{name}</span>
        {dirty ? <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--t1)', flex: 'none' }} /> : null}
        <span style={{ flex: 1, minWidth: 0, font: `11.5px ${MONO}`, color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir}</span>
        {replace !== null ? (
          <HoverSpan
            onClick={(e) => {
              e.stopPropagation()
              onReplaceFile()
            }}
            title="Replace in this file"
            hoverStyle={{ background: 'var(--bd-2)', color: 'var(--t1)' }}
            style={{ width: 20, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-dim)', flex: 'none' }}
          >
            <ReplaceIcon size={12} />
          </HoverSpan>
        ) : null}
        <span
          style={{
            minWidth: 18,
            height: 16,
            padding: '0 5px',
            borderRadius: 8,
            background: 'var(--bd-1)',
            color: 'var(--t2)',
            font: `500 10.5px ${MONO}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            flex: 'none'
          }}
        >
          {file.count}
        </span>
      </HoverSpan>
      {closed ? null : file.lines.map((l) => <ResultLine key={l.line} path={file.path} line={l} replace={replace} onOpenAt={onOpenAt} />)}
    </div>
  )
}

function ResultLine({ path, line, replace, onOpenAt }: { path: string; line: LineMatch; replace: string | null; onOpenAt: (path: string, line: number, col: number, len: number) => void }): React.JSX.Element {
  const [start, len] = line.ranges[0]
  const before = line.text.slice(0, start).replace(/^\s+/, '')
  // Just the end of what comes before the match, so the match shows.
  const pre = before.length > 8 ? `…${before.slice(-8)}` : before
  const hit = line.text.slice(start, start + len)
  const post = line.text.slice(start + len, start + len + 90)
  const more = line.ranges.length > 1 ? `+${line.ranges.length - 1}` : ''
  return (
    <HoverSpan
      onClick={() => onOpenAt(path, line.line, start, len)}
      title={`Line ${line.line + 1}`}
      hoverStyle={{ background: 'var(--bg-menu)' }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 22, padding: '0 6px 0 28px', borderRadius: 4, cursor: 'pointer', font: `12px ${MONO}` }}
    >
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t-icon)' }}>
        {pre}
        {replace !== null ? (
          <>
            <span style={{ background: 'color-mix(in srgb, var(--c-red) 18%, transparent)', color: 'var(--c-red-soft)', textDecoration: 'line-through', borderRadius: 2 }}>{hit}</span>
            <span style={{ background: 'color-mix(in srgb, var(--c-green) 20%, transparent)', color: 'var(--c-green)', borderRadius: 2 }}>{replace}</span>
          </>
        ) : (
          <span style={{ background: 'color-mix(in srgb, var(--c-amber) 22%, transparent)', color: 'var(--c-hit)', borderRadius: 2 }}>{hit}</span>
        )}
        {post}
      </span>
      <span style={{ flex: 'none', color: 'var(--t5)', fontSize: 11 }}>{more}</span>
      <span style={{ flex: 'none', color: 'var(--t5)', fontSize: 11, minWidth: 22, textAlign: 'right' }}>{line.line + 1}</span>
    </HoverSpan>
  )
}

function Toggle({ on, title, onClick, wide, children }: { on: boolean; title: string; onClick: () => void; wide?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={{
        width: wide ? undefined : 22,
        height: wide ? 18 : 20,
        padding: wide ? '0 5px' : undefined,
        flex: 'none',
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `500 11px ${MONO}`,
        cursor: 'pointer',
        background: on ? 'color-mix(in srgb, var(--c-blue) 16%, transparent)' : 'transparent',
        color: on ? 'var(--c-blue)' : 'var(--t-dim)',
        border: `1px solid ${on ? 'color-mix(in srgb, var(--c-blue) 45%, transparent)' : 'transparent'}`,
        boxSizing: 'border-box'
      }}
    >
      {children}
    </span>
  )
}

/** Include/exclude field: applies a moment after typing stops. */
function GlobInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }): React.JSX.Element {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  useEffect(() => {
    if (local === value) return
    const t = setTimeout(() => onChange(local), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])
  return (
    <div style={{ height: 26, display: 'flex', alignItems: 'center', background: 'var(--bg-input)', border: '1px solid var(--bd-3)', borderRadius: 4, boxSizing: 'border-box' }}>
      <input value={local} onChange={(e) => setLocal(e.target.value)} spellCheck={false} placeholder={placeholder} style={{ ...INPUT, font: `12px ${MONO}` }} />
    </div>
  )
}

function HoverSpan({
  onClick,
  title,
  style,
  hoverStyle = { background: 'var(--bg-hover)', color: 'var(--t1)' },
  children
}: {
  onClick: (e: React.MouseEvent) => void
  title?: string
  style: React.CSSProperties
  hoverStyle?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span onClick={onClick} title={title} {...hoverProps} style={{ ...style, ...(hover ? hoverStyle : null) }}>
      {children}
    </span>
  )
}

function ReplaceIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5h5M2 6h5" />
      <path d="M9 3v4.5a1.5 1.5 0 0 1-1.5 1.5H4" />
      <path d="M5.5 7.5 4 9l1.5 1.5" />
    </svg>
  )
}
