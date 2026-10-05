import React, { useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { NewNoteButton, NotesPane, notesCommand } from '../components/notes/NotesPane'
import { HoverBox } from '../components/notes/NoteEditor'
import { Menu, type MenuAnchor, type MenuItem } from '../components/ui'
import { exportNotes, importNotes } from '../lib/notes'
import { shortcut } from '../lib/shortcuts'

/** The Notes screen: every note - personal, a project's, or a task's. */
export function Notes(): React.JSX.Element {
  const { state } = useAppStore()
  const linked = state.notes.filter((n) => n.taskId).length
  const hint = [shortcut('notes-search') && `${shortcut('notes-search')} search`, shortcut('notes-new') && `${shortcut('notes-new')} new`, '[[title]] links notes', 'task keys link tasks']
    .filter(Boolean)
    .join(' · ')
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
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)' }}>
        <NotesPane />
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
        hover={{ color: 'var(--t1)', borderColor: 'var(--bd-5)', background: 'var(--bg-panel)' }}
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
