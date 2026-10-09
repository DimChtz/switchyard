import React, { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { codeTheme } from '../../../lib/codeTheme'
import { editorBasicSetup, editorExtensions } from '../../../lib/editorPrefs'
import { languageFor } from '../../../lib/fileLang'
import { agentShort } from '../../../lib/derive'
import { Button, Menu, TipNote, TipRows, TipTitle, Tooltip, type MenuItem } from '../../../components/ui'
import { errText } from '../../../lib/errors'
import { keyLabel, revealLabel } from '../../../lib/keys'
import { useAppStore } from '../../../store/AppStore'
import { wsOpen } from '../../../lib/wsStore'
import { useFiles } from './FilesContext'
import { useChangesMaybe } from '../changes/ChangesContext'
import { blameGutter } from '../../../lib/blameGutter'
import { taskOfCommit } from '../../../lib/commitTask'
import type { Blame } from '@shared/types'

/** A file's editor tab. */
/** Blame shown or not, for every file editor (until the app restarts). */
let blameShown = false

export function FileEditor({ path, visible }: { path: string; visible: boolean }): React.JSX.Element {
  const { dispatch } = useAppStore()
  const f = useFiles()
  const { task } = f
  const viewRef = useRef<EditorView | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [, setRecheck] = useState(0)
  // Blame: who last changed each line (of the file as saved), in a gutter. On or off for every file.
  const { state } = useAppStore()
  const changes = useChangesMaybe()
  const repo = changes?.repoOf(path) ?? null
  const [blameOn, setBlameOnState] = useState(blameShown)
  const setBlameOn = (on: boolean): void => {
    blameShown = on
    setBlameOnState(on)
  }
  const [blame, setBlame] = useState<Blame | null>(null)
  const savedAt = f.meta(path)?.mtime
  useEffect(() => {
    if (!blameOn || !repo) return setBlame(null)
    let live = true
    window.api.git
      .blame(repo.path, repo.rel)
      .then((b) => live && setBlame(b))
      .catch(() => live && setBlame(null))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blameOn, repo?.path, repo?.rel, savedAt, changes?.commits.length])
  const blameExt = useMemo(
    () =>
      blame
        ? blameGutter(
            blame,
            (subject) => taskOfCommit(subject, state.tasks)?.key ?? null,
            (sha) => changes?.showCommit(sha, path, blame.commits[sha]?.subject)
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blame, state.tasks]
  )
  const waited = useRef(0)

  useEffect(() => f.ensureLoaded(path), [path, f.ensureLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const text = f.text(path)
  const meta = f.meta(path)
  const loading = f.loading(path) || text === undefined
  const prefs = f.prefsOf(path)
  // (What editorExtensions reads: the same settings, the same extensions - CodeMirror isn't reconfigured.)
  const extKey = [prefs.editorFont, prefs.editorFontSize, prefs.editorLigatures, prefs.editorLineHeight, prefs.editorTabSize, prefs.editorUseTabs, prefs.editorWhitespace, prefs.editorWordWrap].join('|')
  const extensions = useMemo(() => editorExtensions(prefs), [extKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const ec = f.editorConfig(path)
  const entry = f.entries?.find((e) => e.path === path) ?? null
  const dirty = f.isDirty(path)
  const disk = f.disk[path]
  const agent = agentShort(task.agentKind)
  const lines = text === undefined ? 0 : text.split('\n').length
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const name = path.split('/').pop() ?? path

  // A search result's match, selected once the file shows (checked after every render: the editor
  // view appears on its own schedule; the jump is cleared once done, so it runs once).
  useEffect(() => {
    const view = viewRef.current
    const jump = f.jump
    if (!jump || jump.path !== path || !visible || loading || !view) return
    const doc = view.state.doc
    // The editor takes the text on its own schedule (after this render): until it has it, look again shortly.
    if (doc.lines !== lines && waited.current < 40) {
      const t = setTimeout(() => {
        waited.current++
        setRecheck((n) => n + 1)
      }, 50)
      return () => clearTimeout(t)
    }
    waited.current = 0
    if (jump.line >= doc.lines) return f.jumped()
    const from = Math.min(doc.line(jump.line + 1).from + jump.col, doc.length)
    const to = Math.min(from + jump.len, doc.length)
    view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    // (A tab that was just shown isn't laid out yet: scroll again once it is.)
    requestAnimationFrame(() => view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) }))
    view.focus()
    f.jumped()
  })

  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const menuItems = (): MenuItem[] => {
    const view = viewRef.current
    const sel = view?.state.selection.main
    const hasSelection = !!sel && !sel.empty
    const items: MenuItem[] = [
      {
        label: 'Cut',
        shortcut: keyLabel('⌘X'),
        disabled: !hasSelection,
        onClick: () => {
          if (!view || !sel) return
          navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {})
          view.dispatch(view.state.replaceSelection(''))
          view.focus()
        }
      },
      {
        label: 'Copy',
        shortcut: keyLabel('⌘C'),
        disabled: !hasSelection,
        onClick: () => {
          if (view && sel) navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to)).catch(() => {})
        }
      },
      {
        label: 'Paste',
        shortcut: keyLabel('⌘V'),
        onClick: () => {
          if (!view) return
          navigator.clipboard
            .readText()
            .then((t) => {
              view.dispatch(view.state.replaceSelection(t))
              view.focus()
            })
            .catch(() => {})
        }
      },
      {
        label: 'Select All',
        shortcut: keyLabel('⌘A'),
        separatorBefore: true,
        onClick: () => {
          if (!view) return
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
          view.focus()
        }
      }
    ]
    if (dirty) items.push({ label: 'Save', shortcut: keyLabel('⌘S'), separatorBefore: true, onClick: () => f.save(path) })
    items.push({ label: 'Copy Path', separatorBefore: true, onClick: () => window.api.sys.copy(f.abs(path)) })
    items.push({ label: 'Copy Relative Path', onClick: () => window.api.sys.copy(path) })
    items.push({ label: 'Reveal in Explorer View', separatorBefore: true, onClick: () => f.reveal(path) })
    items.push({ label: revealLabel, onClick: () => window.api.sys.showItem(f.abs(path)).catch(toastErr) })
    items.push({ label: 'Open in Editor', onClick: () => window.api.sys.openInEditor(f.abs(path)).catch(toastErr) })
    return items
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 36, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--bd-1)', background: 'var(--bg-input)', minWidth: 0 , overflow: 'hidden' }}>
        <span title={f.abs(path)} style={{ font: '12.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 56, flex: '0 0 auto', maxWidth: '60%', direction: 'rtl', textAlign: 'left' }}>
          <bdi>
            {dir}
            <span style={{ color: 'var(--t1)' }}>{name}</span>
          </bdi>
        </span>
        {entry ? (
          <span style={{ font: '11.5px var(--font-ui)', color: entry.status === 'added' ? 'var(--c-green)' : entry.status === 'unchanged' ? 'var(--t3)' : 'var(--c-amber)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 10 auto' }}>
            {entry.status === 'unchanged' ? 'unchanged' : `${entry.status} by ${agent || 'you'}`}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {meta?.kind === 'text' ? (
          <Tooltip
            content={
              ec && Object.keys(ec).length ? (
                <>
                  <TipTitle>From .editorconfig</TipTitle>
                  <TipRows rows={Object.entries(ec).map(([k, v]) => [k, String(v)])} />
                  <TipNote>Applied when editing and on save.</TipNote>
                </>
              ) : (
                <>
                  <TipTitle>No .editorconfig applies</TipTitle>
                  <TipRows
                    rows={[
                      ['Indentation', prefs.editorUseTabs ? 'tabs' : `${prefs.editorTabSize} spaces`],
                      ['Line endings', meta.eol === '\r\n' ? 'CRLF (as the file has)' : 'LF (as the file has)']
                    ]}
                  />
                  <TipNote>Indentation from Settings → File editor.</TipNote>
                </>
              )
            }
          >
            <span style={{ font: '11px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1000 auto' }}>
              {prefs.editorUseTabs ? 'tabs' : `spaces ${prefs.editorTabSize}`} · {(ec?.end_of_line ?? (meta.eol === '\r\n' ? 'crlf' : 'lf')).toUpperCase()}
              {meta.bom ? ' · BOM' : ''}
              {ec && Object.keys(ec).length ? ' · .editorconfig' : ''}
            </span>
          </Tooltip>
        ) : null}
        {text !== undefined && meta?.kind === 'text' ? <span style={{ font: '11.5px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0, flex: '0 100 auto' }}>{lines} lines</span> : null}
        {entry && entry.status !== 'unchanged' ? (
          <Button size="xs" onClick={() => wsOpen(task.id, `diff:${path}`)}>
            View diff
          </Button>
        ) : null}
        {repo && meta?.kind === 'text' ? (
          <>
            <Button size="xs" tone={blameOn ? 'success' : undefined} onClick={() => setBlameOn(!blameOn)} title={blameOn ? 'Hide who changed each line' : 'Who last changed each line, when, and in which task'}>
              Blame
            </Button>
            <Button size="xs" onClick={() => wsOpen(task.id, `history:${path}`)} title="The commits that changed this file">
              History
            </Button>
          </>
        ) : null}
        {dirty ? (
          <Button variant="primary" size="xs" hint="⌘S" onClick={() => f.save(path)}>
            Save
          </Button>
        ) : null}
      </div>
      {disk ? (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px', borderBottom: '1px solid var(--bd-1)', background: 'color-mix(in srgb, var(--c-amber) 10%, transparent)', font: '12.5px var(--font-ui)', color: 'var(--t1)' }}>
          <span style={{ flex: 1 }}>
            {disk === 'deleted'
              ? 'This file was deleted on disk - your edits are only here.'
              : disk === 'refused'
                ? `It changed on disk since you opened it (${agent || 'something'} edited it) - saving would overwrite that.`
                : `${agent || 'Something'} changed this file on disk while you were editing it.`}
          </span>
          {disk !== 'deleted' ? (
            <Button size="xs" onClick={() => f.resolveDisk(path, 'disk')}>
              Reload theirs
            </Button>
          ) : null}
          <Button size="xs" variant="primary" onClick={() => f.resolveDisk(path, 'mine')}>
            {disk === 'deleted' ? 'Save mine' : 'Keep mine (overwrite)'}
          </Button>
        </div>
      ) : null}
      <div
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-code, var(--bg-console))' }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            f.save(path)
          }
        }}
        onContextMenu={(e) => {
          if (loading) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {loading ? (
          <div style={{ padding: 40, font: '13px var(--font-ui)', color: 'var(--t3)' }}>Loading…</div>
        ) : meta && meta.kind !== 'text' ? (
          <div style={{ padding: 40, font: '13px/1.5 var(--font-ui)', color: 'var(--t3)' }}>
            {meta.kind === 'binary' ? 'A binary file' : `A large file (${(meta.size / 1_000_000).toFixed(1)} MB)`} - not opened here, so it can't be saved over by accident.{' '}
            <span style={{ color: 'var(--c-blue)', cursor: 'pointer' }} onClick={() => window.api.sys.reveal(f.abs(path))}>
              Open it with its app
            </span>
          </div>
        ) : (
          <CodeMirror
            value={text}
            height="100%"
            // The editor scrolls itself (both bars always in view), not the box around it.
            style={{ height: '100%' }}
            theme={codeTheme}
            extensions={[...languageFor(path), ...extensions, ...(blameExt ? [blameExt] : [])]}
            onChange={(value) => {
              f.setEdit(path, value)
              f.scheduleAutoSave(path)
            }}
            onBlur={() => {
              if (prefs.editorAutoSave === 'blur' && f.isDirty(path)) f.save(path, true)
            }}
            onCreateEditor={(view) => {
              viewRef.current = view
            }}
            basicSetup={editorBasicSetup(prefs)}
          />
        )}
      </div>
      {menu ? <Menu anchor={menu} items={menuItems()} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
