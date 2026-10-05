import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { ago, createNote, importNotes, joinNote, linkOf, noteMenuItems, noteTitle, plainText, splitNote } from '../../lib/notes'
import { useContextMenu } from '../ui'
import { HoverBox, NoteEditor, PinIcon, type NoteMode } from './NoteEditor'
import type { LiveLinks } from './livePreview'
import { reposOf } from '../../lib/multiRepo'
import type { Note, Task } from '@shared/types'

type Filter = 'all' | 'pinned' | 'tasks' | 'projects' | 'personal'

// Kept while the screen is closed: the editor's mode, the list's filter, and per task its search and note.
let lastMode: NoteMode = 'live'
let lastFilter: Filter = 'all'
const taskQuery = new Map<string, string>()
const taskNote = new Map<string, string>()

/** Asks the Notes screen to start a note or search ("N" and "/"). */
export function notesCommand(cmd: 'new' | 'search'): void {
  window.dispatchEvent(new CustomEvent('switchyard:notes', { detail: cmd }))
}

const T1 = 'var(--t1)'
const T2 = 'var(--t2)'
const T3 = 'var(--t3)'
const MONO = "var(--font-mono)"

/**
 * Notes: the list (search, filters, sections) and the open note. On the
 * Notes screen ("main") all notes; in a task's workspace ("task") the
 * task's own, its project's, and the ones that mention its key.
 */
export function NotesPane({ task }: { task?: Task }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [query, setQueryState] = useState(() => (task ? (taskQuery.get(task.id) ?? '') : ''))
  const setQuery = (v: string): void => {
    if (task) taskQuery.set(task.id, v)
    setQueryState(v)
  }
  const [filter, setFilterState] = useState<Filter>(lastFilter)
  const setFilter = (f: Filter): void => {
    lastFilter = f
    setFilterState(f)
  }
  const [mode, setModeState] = useState<NoteMode>(lastMode)
  const setMode = (m: NoteMode): void => {
    lastMode = m
    setModeState(m)
  }
  const [taskSel, setTaskSel] = useState<string | null>(() => (task ? (taskNote.get(task.id) ?? null) : null))
  const searchRef = useRef<HTMLInputElement>(null)

  const select = (id: string): void => {
    if (task) {
      taskNote.set(task.id, id)
      setTaskSel(id)
    } else dispatch({ type: 'OPEN_NOTE', id })
  }

  const ql = query.trim().toLowerCase()
  const lk = (n: Note): ReturnType<typeof linkOf> => linkOf(n, state.tasks, state.projects)
  const matches = (n: Note): boolean => !ql || `${n.body}\n${lk(n).label}`.toLowerCase().includes(ql)
  const sorted = [...state.notes].sort((a, b) => b.updatedAt - a.updatedAt)

  let sections: [string, Note[]][]
  if (task) {
    const repos = reposOf(task)
    const keyRe = new RegExp(`\\b${task.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    const isProject = (n: Note): boolean => !n.taskId && !!n.projectId && repos.includes(n.projectId)
    const names = repos.map((r) => state.projects.find((p) => p.id === r)?.name ?? r)
    sections = [
      ['This task', sorted.filter((n) => n.taskId === task.id && matches(n))],
      [`Project · ${names.join(' + ')}`, sorted.filter((n) => isProject(n) && matches(n))],
      [`Mentions ${task.key}`, sorted.filter((n) => n.taskId !== task.id && !isProject(n) && keyRe.test(n.body) && matches(n))]
    ]
  } else {
    const pass = (n: Note): boolean =>
      filter === 'all' ||
      (filter === 'pinned' && n.pinned) ||
      (filter === 'tasks' && !!n.taskId) ||
      (filter === 'projects' && !!n.projectId && !n.taskId) ||
      (filter === 'personal' && !n.projectId && !n.taskId)
    const shown = sorted.filter((n) => pass(n) && matches(n))
    const label: Record<Filter, string> = { all: '', pinned: 'Pinned', tasks: 'Linked to tasks', projects: 'Project notes', personal: 'Personal' }
    sections = ql
      ? [['Results', shown]]
      : filter === 'all'
        ? [
            ['Pinned', shown.filter((n) => n.pinned)],
            ['Recent', shown.filter((n) => !n.pinned)]
          ]
        : [[label[filter], shown]]
  }
  const visible = sections.flatMap(([, list]) => list)
  const selId = task ? taskSel : state.noteId
  const open = state.notes.find((n) => n.id === selId) ?? visible[0] ?? null

  /** A new note: in a task linked to it; on the Projects filter to the current project; otherwise personal. */
  const newNote = async (title = '', link?: { projectId: string | null; taskId: string | null }): Promise<void> => {
    const to = link ?? (task ? { projectId: task.projectId, taskId: task.id } : filter === 'projects' ? { projectId: state.projectId, taskId: null } : { projectId: null, taskId: null })
    const note = await createNote(dispatch, { body: title ? `# ${title}\n` : '', ...to, pinned: false })
    if (!note) return
    setQuery('')
    if (!task && filter === 'pinned') setFilter('all')
    if (mode === 'preview') setMode('split')
    select(note.id)
  }
  // Markdown files or folders dropped on the list are imported (in a task: as its notes).
  const [dropping, setDropping] = useState(false)
  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDropping(false)
    const paths = [...e.dataTransfer.files].map((f) => window.api.fs.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    const id = await importNotes(dispatch, paths, task ? { projectId: task.projectId, taskId: task.id } : undefined)
    if (id) {
      setQuery('')
      if (!task && filter !== 'all') setFilter('all')
      select(id)
    }
  }
  const duplicate = async (n: Note): Promise<void> => {
    const s = splitNote(n.body)
    const note = await createNote(dispatch, { body: joinNote(`${s.title || 'Untitled'} copy`, s.text), projectId: n.projectId, taskId: n.taskId, pinned: false })
    if (note) select(note.id)
  }

  // "N" and "/" on the Notes screen.
  useEffect(() => {
    if (task) return
    const on = (e: Event): void => {
      const cmd = (e as CustomEvent<string>).detail
      if (cmd === 'new') newNote()
      else searchRef.current?.focus()
    }
    window.addEventListener('switchyard:notes', on)
    return () => window.removeEventListener('switchyard:notes', on)
  })

  const links: LiveLinks = {
    findNote: (name) => state.notes.find((x) => noteTitle(x).toLowerCase() === name.trim().toLowerCase()),
    openNote: (name) => {
      const hit = links.findNote(name)
      if (hit) select(hit.id)
      else newNote(name.trim(), open ? { projectId: open.projectId, taskId: open.taskId } : undefined)
    },
    findTask: (key) => state.tasks.find((t) => t.key === key),
    openTask: (t) => (t.worktreePath ? dispatch({ type: 'OPEN_TASK', taskId: t.id }) : (dispatch({ type: 'NAV', view: 'board', projectId: t.projectId }), dispatch({ type: 'SET_BOARD_FOCUS', id: t.id }))),
    openUrl: (url) => {
      if (/^https?:\/\//i.test(url)) window.api.sys.openExternal(url)
    }
  }

  const counts: Record<Filter, number> = {
    all: state.notes.length,
    pinned: state.notes.filter((n) => n.pinned).length,
    tasks: state.notes.filter((n) => n.taskId).length,
    projects: state.notes.filter((n) => n.projectId && !n.taskId).length,
    personal: state.notes.filter((n) => !n.projectId && !n.taskId).length
  }
  const withItems = sections.filter(([, list]) => list.length)

  return (
    <div style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: '288px minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)', background: 'var(--bg-app)', color: T1 }}>
      <div
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={onDrop}
        style={{ position: 'relative', borderRight: '1px solid var(--bd-1)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-sunken)' }}
      >
        {dropping ? (
          <div
            style={{
              position: 'absolute',
              inset: 6,
              zIndex: 2,
              pointerEvents: 'none',
              border: '1.5px dashed var(--c-blue)',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--bg-app) 88%, transparent)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: 20,
              textAlign: 'center'
            }}
          >
            <span style={{ font: '500 13.5px var(--font-ui)', color: T1 }}>{task ? `Import as notes for ${task.key}` : 'Import as notes'}</span>
            <span style={{ font: '12px/1.5 var(--font-ui)', color: T3 }}>Markdown or text files, or a folder - an Obsidian vault, a Notion export</span>
          </div>
        ) : null}
        <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0, height: 30, display: 'flex', alignItems: 'center', gap: 7, padding: '0 6px 0 9px', background: 'var(--bg-input)', border: '1px solid var(--bd-3)', borderRadius: 5, boxSizing: 'border-box' }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ stroke: 'var(--t3)' }} strokeWidth="1.3" strokeLinecap="round">
                <circle cx="6" cy="6" r="3.8" />
                <path d="m8.8 8.8 3.2 3.2" />
              </svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (query) setQuery('')
                    else e.currentTarget.blur()
                  } else if (e.key === 'Enter' && visible[0]) {
                    e.preventDefault()
                    select(visible[0].id)
                  }
                }}
                spellCheck={false}
                placeholder={task ? `Search notes for ${task.key}` : 'Search notes'}
                style={{ flex: 1, minWidth: 0, height: '100%', background: 'transparent', border: 'none', outline: 'none', color: T1, font: '12.5px var(--font-ui)', padding: 0 }}
              />
              {query ? (
                <HoverBox
                  onClick={() => setQuery('')}
                  title="Clear · Esc"
                  style={{ width: 18, height: 18, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T3, cursor: 'pointer', fontSize: 13 }}
                  hover={{ color: T1, background: 'var(--bd-1)' }}
                >
                  ×
                </HoverBox>
              ) : null}
            </div>
            <HoverBox
              onClick={() => newNote()}
              title={task ? 'New note' : 'New note · N'}
              style={{ width: 30, height: 30, flex: 'none', boxSizing: 'border-box', border: '1px solid var(--bd-3)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T2, cursor: 'pointer' }}
              hover={{ color: T1, borderColor: 'var(--bd-5)', background: 'var(--bg-panel)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5L8 1.5z" />
                <path d="M7 6.8v4M5 8.8h4" />
              </svg>
            </HoverBox>
          </div>
          {!task ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(
                [
                  ['all', 'All'],
                  ['pinned', 'Pinned'],
                  ['tasks', 'Tasks'],
                  ['projects', 'Projects'],
                  ['personal', 'Personal']
                ] as [Filter, string][]
              ).map(([k, l]) => {
                const on = filter === k
                return (
                  <HoverBox
                    key={k}
                    onClick={() => setFilter(k)}
                    style={{
                      height: 22,
                      padding: '0 8px',
                      borderRadius: 11,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      font: '12px var(--font-ui)',
                      color: on ? T1 : T2,
                      background: on ? 'var(--bd-1)' : 'transparent',
                      border: `1px solid ${on ? 'var(--bd-5)' : 'var(--bd-2)'}`,
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    hover={{ color: T1 }}
                  >
                    {l}
                    <span style={{ font: `10.5px ${MONO}`, color: 'var(--t4)' }}>{counts[k]}</span>
                  </HoverBox>
                )
              })}
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px 12px' }}>
          {withItems.map(([label, list]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ padding: '10px 8px 5px', display: 'flex', font: `500 11px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t4)' }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                <span>{list.length}</span>
              </div>
              {list.map((n) => (
                <NoteItem key={n.id} note={n} active={open?.id === n.id} query={ql} onClick={() => select(n.id)} />
              ))}
            </div>
          ))}
          {!withItems.length ? (
            <div style={{ padding: '14px 10px', font: '12.5px/1.55 var(--font-ui)', color: T3, textWrap: 'pretty' } as React.CSSProperties}>
              {ql ? `No notes match “${query}”.` : task ? `No notes for ${task.key} yet.` : 'No notes here yet.'}
            </div>
          ) : null}
        </div>
      </div>

      {open ? (
        <NoteEditor key={open.id} note={open} mode={mode} onMode={setMode} links={links} onSelect={select} onDuplicate={duplicate} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, background: 'var(--bg-console)', textAlign: 'center' }}>
          <div style={{ font: '500 15px var(--font-ui)', color: T1 }}>{task ? `Notes for ${task.key}` : 'No note selected'}</div>
          <div style={{ font: '13px/1.55 var(--font-ui)', color: T3, maxWidth: 380, textWrap: 'pretty' } as React.CSSProperties}>
            {task
              ? `Write down decisions, edge cases and context. Notes linked to a task are attached when an agent starts, and you can send them to ${task.agentKind ?? 'its agent'} any time.`
              : 'Notes can be personal, or linked to a project or a task. Link a note to a task to give its agent the context.'}
          </div>
          <NewNoteButton onClick={() => newNote()} hint={task ? '' : 'N'} />
        </div>
      )}
    </div>
  )
}

/** The white "New note" button (the Notes header and the empty state). */
export function NewNoteButton({ onClick, hint }: { onClick: () => void; hint: string }): React.JSX.Element {
  return (
    <HoverBox
      onClick={onClick}
      style={{ height: 28, padding: '0 12px', background: T1, color: 'var(--bg-app)', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 10, font: '500 12.5px var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap' }}
      hover={{ background: 'var(--t-max)' }}
    >
      New note
      {hint ? <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>{hint}</span> : null}
    </HoverBox>
  )
}

function NoteItem({ note, active, query, onClick }: { note: Note; active: boolean; query: string; onClick: () => void }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const title = noteTitle(note)
  const body = plainText(splitNote(note.body).text)
  const i = query ? body.toLowerCase().indexOf(query) : -1
  let pre = ''
  let hit = ''
  let post: string
  if (i >= 0) {
    pre = (i > 30 ? '…' : '') + body.slice(Math.max(0, i - 30), i)
    hit = body.slice(i, i + query.length)
    post = body.slice(i + query.length, i + query.length + 120)
  } else post = body.slice(0, 140) || 'Empty note'
  const lk = linkOf(note, state.tasks, state.projects)
  const ctx = useContextMenu(() => noteMenuItems(note, { tasks: state.tasks, projects: state.projects, dispatch, open: onClick }))
  return (
    <HoverBox
      onClick={onClick}
      style={{ padding: '8px 10px 9px', borderRadius: 6, background: active ? 'color-mix(in srgb, var(--c-blue) 10%, transparent)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}
      hover={{ background: active ? 'color-mix(in srgb, var(--c-blue) 13%, transparent)' : 'var(--bg-panel)' }}
    >
      <span onContextMenu={ctx.onContextMenu} style={{ display: 'contents' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, font: '500 13px var(--font-ui)', color: active ? T1 : title ? 'var(--t-body)' : T3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title || 'Untitled'}</span>
          {note.pinned ? (
            <span style={{ color: 'var(--c-pin)', display: 'flex' }}>
              <PinIcon size={11} fill="var(--c-pin)" />
            </span>
          ) : null}
          <span style={{ font: `11px ${MONO}`, color: 'var(--t4)' }}>{ago(note.updatedAt)}</span>
        </span>
        <span
          style={{ font: '12px/1.45 var(--font-ui)', color: 'var(--t-dim)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' } as React.CSSProperties}
        >
          {pre}
          {hit ? <span style={{ background: 'color-mix(in srgb, var(--c-amber) 22%, transparent)', color: 'var(--c-hit)', borderRadius: 2 }}>{hit}</span> : null}
          {post}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `11px ${MONO}`, color: lk.color, minWidth: 0 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: lk.color, flex: 'none' }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lk.label}</span>
        </span>
        {ctx.menu}
      </span>
    </HoverBox>
  )
}
