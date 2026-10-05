import React, { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { EditorView } from '@codemirror/view'
import { useAppStore } from '../../store/AppStore'
import { ago, deleteNote, deletedNotes, exportNote, joinNote, linkOf, linksTo, noteTitle, splitNote } from '../../lib/notes'
import { statusColor } from '../../lib/status'
import { errText } from '../../lib/errors'
import { keyLabel } from '../../lib/keys'
import { useHover } from '../../lib/useHover'
import { Menu, type MenuAnchor, type MenuItem } from '../ui'
import { refreshLive, type LiveLinks } from './livePreview'
import { applyEdit, liveEditing, liveReading } from './liveSetup'
import { indent, prefixLines, wrapWith, type MdEdit } from '../../lib/mdEdit'
import type { Note } from '@shared/types'

const SAVE_MS = 600
// Notes whose editor just unmounted; mounting again (StrictMode) cancels the leave.
const leaving = new Map<string, ReturnType<typeof setTimeout>>()

export type NoteMode ='live' | 'write' | 'split' | 'preview'

const T1 = 'var(--t1)'
const T3 = 'var(--t3)'
const MONO = "var(--font-mono)"

/**
 * One note: its link (a task, a project or personal), a title, Markdown text
 * with a formatting bar, and a live preview beside or instead of it. Saves
 * as you type; the file keeps "# Title" as its first line.
 */
export function NoteEditor({
  note,
  mode,
  onMode,
  links,
  onSelect,
  onDuplicate
}: {
  note: Note
  mode: NoteMode
  onMode: (m: NoteMode) => void
  /** [[note]] and task links in the preview. */
  links: LiveLinks
  onSelect: (id: string) => void
  onDuplicate: (note: Note) => void
}): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const first = splitNote(note.body)
  const [title, setTitle] = useState(first.title)
  const [text, setText] = useState(first.text)
  const draft = joinNote(title, text)
  const dirty = useRef(false)
  const latest = useRef({ note, draft })
  latest.current = { note, draft }
  const textRef = useRef<HTMLTextAreaElement>(null)
  // Live mode's editor (CodeMirror), in place of the textarea.
  const viewRef = useRef<EditorView | null>(null)
  const live = mode === 'live'
  const focusText = (): void => (live ? viewRef.current?.focus() : textRef.current?.focus())
  const titleRef = useRef<HTMLInputElement>(null)
  const [linkMenu, setLinkMenu] = useState<MenuAnchor | null>(null)
  const [moreMenu, setMoreMenu] = useState<MenuAnchor | null>(null)

  const save = async (patch: Partial<Pick<Note, 'projectId' | 'taskId' | 'pinned'>> = {}, nameFromTitle = false): Promise<void> => {
    const { note: n, draft: body } = latest.current
    dirty.current = false
    try {
      const saved = await window.api.notes.save({ id: n.id, body, projectId: n.projectId, taskId: n.taskId, pinned: n.pinned, ...patch, nameFromTitle })
      dispatch({ type: 'NOTE_SAVED', note: saved, replaces: saved.id !== n.id ? n.id : undefined })
    } catch (err) {
      dispatch({ type: 'TOAST', text: `Could not save the note: ${errText(err)}` })
    }
  }

  // Save a moment after typing stops.
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => save(), SAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // Leaving the note: save what's left, and let a new note take its title's file name.
  // A new note left without a word in it isn't kept. Deferred a tick: StrictMode's
  // dev-only unmount + remount of the same note must not count as leaving it.
  useEffect(() => {
    const id = note.id
    clearTimeout(leaving.get(id))
    leaving.delete(id)
    // A new, empty note: type its title first.
    if (!note.body.trim()) setTimeout(() => titleRef.current?.focus(), 0)
    return () => {
      leaving.set(
        id,
        setTimeout(() => {
          leaving.delete(id)
          if (deletedNotes.has(latest.current.note.id)) return
          const { note: n, draft: body } = latest.current
          const placeholder = /^note(-\d+)?$/.test(n.id)
          if (placeholder && !n.pinned && /^\s*(#{1,6})?\s*$/.test(body)) {
            window.api.notes
              .delete(n.id)
              .then(() => dispatch({ type: 'NOTE_DELETED', id: n.id, quiet: true }))
              .catch(() => {})
            return
          }
          if (dirty.current || placeholder) save({}, true)
        })
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Changed outside the app (another editor, a sync) while not being edited here.
  useEffect(() => {
    if (dirty.current || note.body === latest.current.draft) return
    const s = splitNote(note.body)
    setTitle(s.title)
    setText(s.text)
  }, [note.body, note.updatedAt])

  const editTitle = (v: string): void => {
    dirty.current = true
    setTitle(v)
  }
  const editText = (v: string): void => {
    dirty.current = true
    setText(v)
  }

  // The formatting bar and keys: change the text around the selection, then put it back.
  const edit = (fn: MdEdit): void => {
    const view = viewRef.current
    if (live && view) return applyEdit(view, fn)
    const el = textRef.current
    if (!el) return
    const [v, a, b] = fn(el.value, el.selectionStart, el.selectionEnd)
    editText(v)
    setTimeout(() => {
      const x = textRef.current
      if (!x) return
      x.focus()
      x.setSelectionRange(a, b)
    }, 0)
  }
  const wrap = (l: string, r: string, placeholder: string): void => edit(wrapWith(l, r, placeholder))
  const linePrefix = (pre: string): void => edit(prefixLines(pre))
  const tools: [string, string, string, () => void][] = [
    ['H', 'Heading', '600 12.5px var(--font-ui)', () => linePrefix('## ')],
    ['B', `Bold ${keyLabel('⌘B')}`, '700 12.5px var(--font-ui)', () => wrap('**', '**', 'bold')],
    ['I', `Italic ${keyLabel('⌘I')}`, 'italic 500 13px var(--font-ui)', () => wrap('*', '*', 'italic')],
    ['‹›', `Inline code ${keyLabel('⌘E')}`, `500 12px ${MONO}`, () => wrap('`', '`', 'code')],
    ['•', 'Bulleted list', '600 15px var(--font-ui)', () => linePrefix('- ')],
    ['[ ]', 'Checklist', `500 11px ${MONO}`, () => linePrefix('- [ ] ')],
    ['“', 'Quote', '600 16px var(--font-ui)', () => linePrefix('> ')],
    ['[[ ]]', 'Link another note', `500 11px ${MONO}`, () => wrap('[[', ']]', 'Note title')]
  ]
  const onTextKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.shiftKey && k === 'b') {
      e.preventDefault()
      return wrap('**', '**', 'bold')
    }
    if (mod && !e.shiftKey && k === 'i') {
      e.preventDefault()
      return wrap('*', '*', 'italic')
    }
    if (mod && !e.shiftKey && k === 'e') {
      e.preventDefault()
      e.stopPropagation()
      return wrap('`', '`', 'code')
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault()
      return edit(indent)
    }
    // Enter continues a list, a checklist or a quote; on an empty item it ends it.
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const x = e.currentTarget
      const v = x.value
      const a = x.selectionStart
      const ls = v.lastIndexOf('\n', a - 1) + 1
      const cur = v.slice(ls, a)
      const mm = /^(\s*)([-*] \[[ xX]\] |[-*] |\d+\. |> )/.exec(cur)
      if (!mm) return
      e.preventDefault()
      if (cur === mm[0]) return edit(() => [v.slice(0, ls) + v.slice(a), ls, ls])
      let next = mm[2]
      if (/^\d+\. $/.test(next)) next = `${parseInt(next, 10) + 1}. `
      next = next.replace(/\[[xX]\]/, '[ ]')
      const ins = `\n${mm[1]}${next}`
      edit((vv, aa, bb) => [vv.slice(0, aa) + ins + vv.slice(bb), aa + ins.length, aa + ins.length])
    }
  }

  // Live mode: the editor's setup is made once; what it calls is read from here.
  const liveLinks = useRef<LiveLinks>(links)
  liveLinks.current = links
  const liveEdit = useRef(edit)
  liveEdit.current = edit
  const liveSetup = useMemo(
    () => liveEditing({ placeholder: 'Write in Markdown - # heading, - [ ] todo, `code`, [[another note]], or a task key like MS-38', links: liveLinks, edit: liveEdit }),
    []
  )
  // Split and Preview: the same rendering, read-only (checkboxes still tick).
  const previewSetup = useMemo(() => liveReading(liveLinks), [])
  const previewRef = useRef<EditorView | null>(null)

  // Which [[links]] and task keys resolve changes with the notes and tasks.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshLive.of(null) })
    previewRef.current?.dispatch({ effects: refreshLive.of(null) })
  }, [state.notes, state.tasks])

  // The link: personal, a whole project, or one of its tasks.
  const setLink = (projectId: string | null, taskId: string | null): void => {
    save({ projectId, taskId })
    const task = state.tasks.find((t) => t.id === taskId)
    const project = state.projects.find((p) => p.id === projectId)
    dispatch({ type: 'TOAST', text: task ? `Linked to ${task.key}` : project ? `Linked to ${project.name}` : 'Note is now personal' })
  }
  const home = note.projectId ?? state.tasks.find((t) => t.id === state.taskId)?.projectId
  const linkItems: MenuItem[] = [
    { label: 'Personal', sub: 'not linked', dot: T3, checked: !note.projectId && !note.taskId, onClick: () => setLink(null, null) },
    ...[...state.projects]
      .sort((a, b) => Number(b.id === home) - Number(a.id === home))
      .flatMap((p): MenuItem[] => [
        { label: p.name, heading: true, onClick: () => {} },
        { label: 'Whole project', dot: 'var(--t2)', checked: note.projectId === p.id && !note.taskId, onClick: () => setLink(p.id, null) },
        ...state.tasks
          .filter((t) => t.projectId === p.id && t.col !== 'done')
          .map((t) => ({ label: t.title, sub: t.key, dot: t.st ? statusColor(t.st) : 'var(--t5)', checked: note.taskId === t.id, onClick: () => setLink(p.id, t.id) }))
      ])
  ]
  const moreItems: MenuItem[] = [
    { label: note.pinned ? 'Unpin' : 'Pin to top', onClick: () => save({ pinned: !note.pinned }) },
    { label: 'Duplicate', onClick: () => onDuplicate({ ...note, body: draft }) },
    { label: 'Copy as Markdown', onClick: () => (window.api.sys.copy(draft), dispatch({ type: 'TOAST', text: 'Copied as Markdown' })) },
    { label: 'Save as Markdown file…', onClick: () => exportNote(dispatch, draft) },
    { label: 'Delete note', danger: true, onClick: () => deleteNote(dispatch, note) }
  ]

  const lk = linkOf(note, state.tasks, state.projects)
  const when = ago(note.updatedAt)
  const words = (text.match(/\S+/g) ?? []).length
  const shownTitle = title.trim().toLowerCase()
  const backlinks = shownTitle ? state.notes.filter((x) => x.id !== note.id && linksTo(x.body, shownTitle)) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--bg-console)' }}>
      <div style={{ height: 42, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 20px', borderBottom: '1px solid var(--bd-1)' }}>
        <HoverBox
          onClick={(e) => {
            const el = e.currentTarget
            setLinkMenu((m) => (m ? null : { el }))
          }}
          title="Link this note to a task or project"
          style={{ height: 24, maxWidth: 340, minWidth: 0, padding: '0 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 7, font: `12px ${MONO}`, color: lk.color, border: '1px solid var(--bd-3)', boxSizing: 'border-box', cursor: 'pointer' }}
          hover={{ borderColor: 'var(--bd-5)', background: 'var(--bg-panel)' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: lk.color, flex: 'none' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lk.label}</span>
          <svg width="9" height="9" viewBox="0 0 10 10" style={{ flex: 'none' }}>
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" style={{ stroke: 'var(--t3)' }} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </HoverBox>
        <span style={{ font: '11.5px var(--font-ui)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {when === 'now' ? 'Edited just now' : `Edited ${when} ago`} · {words} word{words === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', padding: 2, gap: 2, background: 'var(--bg-input)', border: '1px solid var(--bd-2)', borderRadius: 5, flex: 'none' }}>
          {(
            [
              ['live', 'Live', 'Write and see it rendered in one - the line you’re on shows its Markdown'],
              ['write', 'Write', 'Markdown only'],
              ['split', 'Split', 'Markdown and preview side by side'],
              ['preview', 'Preview', 'Rendered - click checkboxes to tick them']
            ] as [NoteMode, string, string][]
          ).map(([k, l, tip]) => (
            <HoverBox
              key={k}
              onClick={() => onMode(k)}
              title={tip}
              style={{ height: 20, padding: '0 8px', borderRadius: 3, display: 'flex', alignItems: 'center', font: '12px var(--font-ui)', color: mode === k ? T1 : T3, background: mode === k ? 'var(--bd-2)' : 'transparent', cursor: 'pointer', userSelect: 'none' }}
              hover={{ color: T1 }}
            >
              {l}
            </HoverBox>
          ))}
        </div>
        <HoverBox
          onClick={() => save({ pinned: !note.pinned })}
          title={note.pinned ? 'Unpin' : 'Pin to top'}
          style={{ width: 26, height: 26, flex: 'none', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: note.pinned ? 'var(--c-pin)' : 'var(--t-dim)', cursor: 'pointer' }}
          hover={{ background: 'var(--bg-hover)' }}
        >
          <PinIcon size={13} fill={note.pinned ? 'var(--c-pin)' : 'none'} />
        </HoverBox>
        <HoverBox
          onClick={(e) => {
            const el = e.currentTarget
            setMoreMenu((m) => (m ? null : { el, align: 'end' }))
          }}
          title="More"
          style={{ width: 26, height: 26, flex: 'none', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-dim)', cursor: 'pointer', font: '600 13px var(--font-ui)', letterSpacing: 1 }}
          hover={{ background: 'var(--bg-hover)', color: T1 }}
        >
          ···
        </HoverBox>
      </div>
      <div style={{ padding: '20px 28px 4px', flex: 'none' }}>
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => editTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              focusText()
            }
          }}
          spellCheck={false}
          placeholder="Untitled"
          style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', color: T1, font: '600 22px/1.3 var(--font-ui)', letterSpacing: '-0.01em', padding: 0 }}
        />
      </div>
      {mode !== 'preview' ? (
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '6px 22px 8px' }}>
          {tools.map(([l, tip, font, fn]) => (
            <HoverBox
              key={l}
              onMouseDown={(e) => e.preventDefault()}
              onClick={fn}
              title={tip}
              style={{ minWidth: 26, height: 24, padding: '0 5px', boxSizing: 'border-box', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-icon)', cursor: 'pointer', font, userSelect: 'none' }}
              hover={{ background: 'var(--bg-hover)', color: T1 }}
            >
              {l}
            </HoverBox>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ font: `11px ${MONO}`, color: 'var(--t5)', whiteSpace: 'nowrap' }}>↵ continues lists · [[ ]] links notes</span>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', borderTop: '1px solid var(--bg-hover)' }}>
        {live ? (
          <div
            onMouseDown={(e) => {
              // Below the text: put the cursor at the end.
              const view = viewRef.current
              if (!view || e.target !== e.currentTarget) return
              e.preventDefault()
              view.focus()
              view.dispatch({ selection: { anchor: view.state.doc.length } })
            }}
            style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'auto', padding: '0 28px 32px', display: 'flex', flexDirection: 'column', cursor: 'text' }}
          >
            <CodeMirror
              value={text}
              onChange={editText}
              extensions={liveSetup}
              basicSetup={false}
              theme="none"
              onCreateEditor={(view) => {
                viewRef.current = view
              }}
            />
            {backlinks.length ? <Backlinks notes={backlinks} onSelect={onSelect} /> : null}
          </div>
        ) : null}
        {mode !== 'preview' && !live ? (
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => editText(e.target.value)}
            onKeyDown={onTextKey}
            spellCheck={false}
            placeholder="Write in Markdown - # heading, - [ ] todo, `code`, [[another note]], or a task key like MS-38"
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: '100%',
              boxSizing: 'border-box',
              resize: 'none',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: '16px 28px 28px',
              color: 'var(--t-body)',
              font: `13px/1.75 ${MONO}, ui-monospace, monospace`,
              borderRight: mode === 'split' ? '1px solid var(--bg-hover)' : 'none',
              caretColor: 'var(--c-blue)',
              tabSize: 2
            }}
          />
        ) : null}
        {mode === 'split' || mode === 'preview' ? (
          <div style={{ flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'auto', padding: '14px 28px 32px', display: 'flex', flexDirection: 'column', background: mode === 'split' ? 'var(--bg-sunken)' : 'transparent' }}>
            <CodeMirror
              value={text}
              onChange={(v) => v !== text && editText(v)}
              extensions={previewSetup}
              basicSetup={false}
              theme="none"
              onCreateEditor={(view) => {
                previewRef.current = view
              }}
            />
            {!text.trim() ? <div style={{ font: '13px/1.6 var(--font-ui)', color: 'var(--t4)', textWrap: 'pretty' } as React.CSSProperties}>Nothing here yet. Preview updates as you type.</div> : null}
            {backlinks.length ? <Backlinks notes={backlinks} onSelect={onSelect} /> : null}
          </div>
        ) : null}
      </div>
      {linkMenu ? (
        <Menu
          anchor={linkMenu}
          width={330}
          items={linkItems}
          intro="Link to a task to give its agent this note as context, or to a project to share it with every task in it."
          onClose={() => setLinkMenu(null)}
        />
      ) : null}
      {moreMenu ? <Menu anchor={moreMenu} width={200} items={moreItems} onClose={() => setMoreMenu(null)} /> : null}
    </div>
  )
}

/** "Linked from": the notes whose [[links]] point here. */
function Backlinks({ notes, onSelect }: { notes: Note[]; onSelect: (id: string) => void }): React.JSX.Element {
  const { state } = useAppStore()
  return (
    <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid var(--bg-hover)', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'default' }}>
      <div style={{ font: `500 10.5px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)', paddingBottom: 4 }}>Linked from</div>
      {notes.map((b) => (
        <HoverBox
          key={b.id}
          onClick={() => onSelect(b.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 8px', margin: '0 -8px', borderRadius: 4, cursor: 'pointer', font: '13px var(--font-ui)', color: 'var(--c-blue)' }}
          hover={{ background: 'var(--bg-panel)' }}
        >
          <span>{noteTitle(b) || 'Untitled'}</span>
          <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>{linkOf(b, state.tasks, state.projects).label}</span>
        </HoverBox>
      ))}
    </div>
  )
}

/** A styled span with a hover look (the design's style-hover). */
export function HoverBox({
  onClick,
  onMouseDown,
  title,
  style,
  hover,
  children
}: {
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void
  onMouseDown?: (e: React.MouseEvent<HTMLSpanElement>) => void
  title?: string
  style: React.CSSProperties
  hover: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const [on, hoverProps] = useHover()
  return (
    <span onClick={onClick} onMouseDown={onMouseDown} title={title} {...hoverProps} style={{ ...style, ...(on ? hover : null) }}>
      {children}
    </span>
  )
}

export function PinIcon({ size, fill }: { size: number; fill: string }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ fill }} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M5 1.5h4l-.5 3.3 2.2 2.2H3.3l2.2-2.2z" />
      <path d="M7 7v5.5" fill="none" />
    </svg>
  )
}
