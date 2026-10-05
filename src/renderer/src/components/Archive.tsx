import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/AppStore'
import { Button, Modal, ModalFooter, ModalHeader, TextInput, confirm } from './ui'
import { plainText } from '../lib/noteText'
import { timeAgo } from '../lib/status'
import type { Task } from '@shared/types'

/**
 * Finished tasks, off the board but kept: searchable by key, title,
 * description and how they finished; back to Done, or deleted for good.
 */
export function ArchiveModal(): React.JSX.Element | null {
  const { state } = useAppStore()
  const project = state.projects.find((p) => p.id === state.archiveFor)
  if (!project) return null
  return <Body projectId={project.id} name={project.name} />
}

function matches(t: Task, q: string): boolean {
  if (!q) return true
  const hay = `${t.key} ${t.title} ${t.desc ?? ''} ${t.doneNote ?? ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

function Body({ projectId, name }: { projectId: string; name: string }): React.JSX.Element {
  const { state, dispatch } = useAppStore()
  const [q, setQ] = useState('')
  const close = (): void => dispatch({ type: 'OPEN_ARCHIVE', projectId: null })
  const archived = useMemo(
    () => state.tasks.filter((t) => t.projectId === projectId && t.archivedAt).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [state.tasks, projectId]
  )
  const shown = archived.filter((t) => matches(t, q.trim()))
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // A confirm over it (a second dialog) or a menu takes Esc itself.
      if (e.key !== 'Escape' || document.querySelectorAll('[role=dialog][aria-modal=true]').length > 1 || document.querySelector('[role=menu]')) return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  const remove = async (t: Task): Promise<void> => {
    const ok = await confirm({ title: `Delete ${t.key} for good?`, body: 'It leaves the archive. Its key stays used, so a new task never gets it.', confirmLabel: 'Delete', danger: true })
    if (ok) dispatch({ type: 'DELETE_TASK', taskId: t.id, toast: `Deleted ${t.key}.` })
  }
  return (
    <Modal width={720} top={64} onClose={close}>
      <ModalHeader kicker={`Archive · ${name}`} title={`${archived.length} finished task${archived.length === 1 ? '' : 's'}`} />
      <div style={{ padding: '4px 20px 10px' }}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search key, title, description…" autoFocus />
      </div>
      <div style={{ flex: 1, minHeight: 120, maxHeight: 460, overflow: 'auto', padding: '0 12px 12px' }}>
        {!shown.length ? (
          <div style={{ padding: 16, font: '13px var(--font-ui)', color: 'var(--t3)' }}>{archived.length ? 'Nothing matches.' : 'Nothing archived yet - Archive in the Done column puts finished tasks here.'}</div>
        ) : (
          shown.map((t) => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 12, alignItems: 'center', padding: '8px 8px', borderBottom: '1px solid var(--bd-row)' }}>
              <span style={{ font: '12px var(--font-mono)', color: 'var(--t3)' }}>{t.key}</span>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: '500 13px var(--font-ui)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                <span style={{ font: '12px var(--font-ui)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {[t.doneNote, t.archivedAt ? `archived ${timeAgo(t.archivedAt)}` : null, t.desc ? plainText(t.desc).slice(0, 120) : null].filter(Boolean).join(' · ')}
                </span>
              </div>
              <span style={{ display: 'flex', gap: 6 }}>
                <Button onClick={() => dispatch({ type: 'UNARCHIVE_TASK', taskId: t.id })}>Restore</Button>
                <Button onClick={() => remove(t)}>Delete</Button>
              </span>
            </div>
          ))
        )}
      </div>
      <ModalFooter>
        <span style={{ flex: 1 }} />
        <Button size="lg" onClick={close}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}
