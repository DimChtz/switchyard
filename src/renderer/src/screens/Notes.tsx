import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { NewNoteButton, NotesList, NoteTab, notesCommand } from '../components/notes/NotesPane'
import { HoverBox } from '../components/notes/NoteEditor'
import { Menu, type MenuAnchor, type MenuItem } from '../components/ui'
import { exportNotes, importNotes, noteMenuItems, noteTitle } from '../lib/notes'
import { shortcut } from '../lib/shortcuts'
import { EditorArea, type TabMeta } from './workspace/layout/EditorArea'
import { activate, closeTab, groupsOf, splitGroup, type TabId } from '../lib/wsLayout'
import { NOTES_LAYOUT, setLayout, useLayout, wsOpen } from '../lib/wsStore'

/** The Notes screen: every note - personal, a project's, or a task's - each opening in a tab. */
export function Notes(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const layout = useLayout(NOTES_LAYOUT)
  const linked = state.notes.filter((n) => n.taskId).length
  const hint = [shortcut('notes-search') && `${shortcut('notes-search')} search`, shortcut('notes-new') && `${shortcut('notes-new')} new`, '[[title]] links notes', 'task keys link tasks']
    .filter(Boolean)
    .join(' · ')
  const open = (id: string, gid?: string): void => wsOpen(NOTES_LAYOUT, `note:${id}`, gid)
  const close = (id: TabId, gid: string): void => setLayout(NOTES_LAYOUT, (L) => closeTab(L, id, gid))

  // A note asked for from elsewhere (the palette, a link, a task's menu): its tab.
  useEffect(() => {
    if (state.noteId) open(state.noteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.noteSeq])

  const focused = groupsOf(layout.root).find((g) => g.g === layout.focus)
  const showing = focused?.a?.startsWith('note:') ? focused.a.slice(5) : null

  const meta = (id: TabId): TabMeta | null => {
    if (!id.startsWith('note:')) return null
    const n = state.notes.find((x) => x.id === id.slice(5))
    const title = n ? noteTitle(n) || 'Untitled' : 'Note'
    return { label: title, ic: '¶', icColor: n?.pinned ? 'var(--c-pin)' : 'var(--t2)', tip: title }
  }
  const tabMenu = (id: TabId, gid: string): MenuItem[] => {
    const tabs = groupsOf(layout.root).find((x) => x.g === gid)?.tabs ?? []
    const i = tabs.indexOf(id)
    const splitTo = (zone: 'right' | 'bottom'): void => setLayout(NOTES_LAYOUT, (L) => splitGroup(activate(L, gid, id), gid, zone) ?? L)
    const n = state.notes.find((x) => x.id === id.slice(5))
    return [
      { label: 'Close', onClick: () => close(id, gid) },
      { label: 'Close Others', disabled: tabs.length < 2, onClick: () => tabs.filter((t) => t !== id).forEach((t) => close(t, gid)) },
      { label: 'Close to the Right', disabled: i === tabs.length - 1, onClick: () => tabs.slice(i + 1).forEach((t) => close(t, gid)) },
      { label: 'Close All', onClick: () => tabs.forEach((t) => close(t, gid)) },
      { label: 'Split Right', separatorBefore: true, onClick: () => splitTo('right') },
      { label: 'Split Down', onClick: () => splitTo('bottom') },
      ...(n ? noteMenuItems(n, { tasks: state.tasks, projects: state.projects, dispatch }).map((m, k) => (k === 0 ? { ...m, separatorBefore: true } : m)) : [])
    ]
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', borderBottom: '1px solid var(--bd-1)' }}>
        <span style={{ font: '600 16px var(--font-ui)' }}>Notes</span>
        <span style={{ font: "12px var(--font-mono)", color: 'var(--t3)' }}>
          {state.notes.length} note{state.notes.length === 1 ? '' : 's'} · {linked} linked to tasks
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ font: "11.5px var(--font-mono)", color: 'var(--t5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{hint}</span>
        <TransferButton />
        <NewNoteButton onClick={() => notesCommand('new')} hint={shortcut('notes-new')} />
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
        <NotesList width={288} activeId={showing} onOpen={(id) => open(id)} />
        <EditorArea
          taskId={NOTES_LAYOUT}
          layout={layout}
          meta={meta}
          render={(id) => (id.startsWith('note:') ? <NoteTab id={id.slice(5)} onOpen={(n) => open(n)} /> : null)}
          close={close}
          addItems={() => [{ label: 'New note', glyph: '¶', glyphColor: 'var(--t2)', onClick: () => notesCommand('new') }]}
          tabMenu={tabMenu}
          splitEmpty={() => {}}
          typePaths={() => false}
        />
      </div>
    </div>
  )
}

/** "Import / Export": Markdown files, a folder or vault in; the notes out as Markdown files. */
function TransferButton(): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const open = (id: string | null): void => {
    if (id) dispatch({ type: 'OPEN_NOTE', id })
  }
  const n = state.notes.length
  const items: MenuItem[] = [
    { label: 'Import', heading: true, onClick: () => {} },
    { label: 'Markdown files…', sub: '.md .txt', onClick: () => importNotes(dispatch, 'files').then(open) },
    { label: 'A folder or Obsidian vault…', sub: 'Notion, Bear', onClick: () => importNotes(dispatch, 'folder').then(open) },
    { label: 'Export', heading: true, separatorBefore: true, onClick: () => {} },
    { label: 'All notes to a folder…', sub: `${n} .md`, disabled: !n, onClick: () => exportNotes(dispatch, state.notes.map((x) => x.id)) }
  ]
  return (
    <>
      <HoverBox
        onClick={(e) => {
          const el = e.currentTarget
          setMenu((m) => (m ? null : { el, align: 'end' }))
        }}
        title="Import Markdown notes, or export yours as Markdown files"
        style={{ height: 28, padding: '0 10px', flex: 'none', boxSizing: 'border-box', border: '1px solid var(--bd-3)', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 7, font: '500 12.5px var(--font-ui)', color: 'var(--t2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        hover={{ color: 'var(--t1)', border: '1px solid var(--bd-5)', background: 'var(--bg-panel)' }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 5.5 2.2 7.8l2.3 2.3M2.2 7.8h6M9.5 8.5l2.3-2.3-2.3-2.3M11.8 6.2h-6" />
        </svg>
        Import / Export
      </HoverBox>
      {menu ? (
        <Menu
          anchor={menu}
          width={290}
          items={items}
          intro="Import brings Markdown in as notes; [[links]], tags and headings are kept. You can also drop files or folders onto the list."
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}
