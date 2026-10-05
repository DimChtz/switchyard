import React from 'react'
import { NotesPane } from '../../components/notes/NotesPane'
import type { Task } from '@shared/types'

/** A task's notes: its own, its project's, and the ones that mention it. */
export function WorkspaceNotes({ task }: { task: Task }): React.JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)' }}>
      <NotesPane key={task.id} task={task} />
    </div>
  )
}
