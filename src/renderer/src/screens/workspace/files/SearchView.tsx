import React from 'react'
import { ExplorerSearch } from '../ExplorerSearch'
import { useFiles } from './FilesContext'
import { PanelHeader, type PanelChrome } from '../layout/PanelHeader'

/** The Search side bar view: search and replace in the task's files (Ctrl+Shift+F). */
export function SearchView({ chrome }: { chrome: PanelChrome }): React.JSX.Element {
  const f = useFiles()
  return (
    <>
      <PanelHeader title="Search" chrome={chrome} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ExplorerSearch
          taskId={f.task.id}
          root={f.root}
          focusKey={f.searchFocus}
          refreshKey={f.refreshKey}
          unsaved={f.unsaved}
          isDirty={f.isDirty}
          replaceInEditor={f.replaceInEditor}
          onReplaced={f.onReplaced}
          onOpenAt={f.jumpTo}
          // Esc in an empty box: back where you were.
          onExit={chrome.onClose}
        />
      </div>
    </>
  )
}
