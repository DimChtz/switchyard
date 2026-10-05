import React, { useEffect, useMemo, useState } from 'react'
import { codeTheme } from '../lib/codeTheme'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useAppStore } from '../store/AppStore'
import { editorBasicSetup, editorExtensions } from '../lib/editorPrefs'
import { languageFor } from '../lib/fileLang'
import { prefsFor } from '../lib/projectPrefs'
import { SEP } from '../lib/paths'
import { errText } from '../lib/errors'
import { revealLabel } from '../lib/keys'
import { Button, FooterNote, Modal } from './ui'

/**
 * A file of a project's main checkout, from Go to file outside a task:
 * shown read-only - agents and edits belong in task worktrees - with the
 * external editor a key away.
 */
export function FilePreview(): React.JSX.Element | null {
  const { state, dispatch } = useAppStore()
  const fp = state.filePreview
  const project = fp ? state.projects.find((p) => p.id === fp.projectId) : undefined
  const abs = project && fp ? `${project.repoPath.split(/[\\/]/).join(SEP)}${SEP}${fp.path.split('/').join(SEP)}` : ''
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const prefs = prefsFor(state, fp?.projectId)
  const path = fp?.path ?? ''
  const extensions = useMemo(() => [...languageFor(path), ...editorExtensions(prefs), EditorState.readOnly.of(true), EditorView.editable.of(false)], [path, prefs])

  useEffect(() => {
    setText(null)
    setError(null)
    if (!abs) return
    let live = true
    window.api.fs
      .read(abs)
      .then((t) => live && setText(t))
      .catch((err: unknown) => live && setError(errText(err)))
    return () => {
      live = false
    }
  }, [abs])

  const close = (): void => dispatch({ type: 'CLOSE_FILE_PREVIEW' })
  const toastErr = (err: unknown): void => dispatch({ type: 'TOAST', text: errText(err) })
  const openInEditor = (): void => {
    window.api.sys.openInEditor(abs).catch(toastErr)
    close()
  }

  // Ctrl/Cmd+Enter: the external editor (Esc is the app's).
  useEffect(() => {
    if (!fp) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        openInEditor()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp, abs])

  if (!fp || !project) return null
  const binary = text !== null && text.includes('\u0000')

  return (
    <Modal
      width={980}
      top={48}
      kicker={`${project.name} › main checkout · ⎇ ${project.defaultBranch ?? 'main'} · read-only`}
      title={fp.path}
      onClose={close}
      footer={
        <>
          <FooterNote>Edits and agents belong in a task’s worktree - this checkout is only shown here.</FooterNote>
          <Button size="lg" onClick={() => window.api.sys.copy(abs)}>
            Copy path
          </Button>
          <Button size="lg" onClick={() => window.api.sys.showItem(abs).catch(toastErr)}>
            {revealLabel}
          </Button>
          <Button size="lg" variant="primary" hint="⌘↵" onClick={openInEditor}>
            Open in editor
          </Button>
        </>
      }
    >
      <div style={{ height: 'min(620px, calc(100vh - 300px))', overflow: 'auto', background: 'var(--bg-code, var(--bg-console))' }}>
        {error ? (
          <Note tone="danger">Could not read the file: {error}</Note>
        ) : text === null ? (
          <Note>Loading…</Note>
        ) : binary ? (
          <Note>A binary file - open it in the editor or the file manager.</Note>
        ) : (
          <CodeMirror value={text} height="100%" theme={codeTheme} extensions={extensions} basicSetup={{ ...editorBasicSetup(prefs), highlightActiveLine: false }} editable={false} autoFocus />
        )}
      </div>
    </Modal>
  )
}

function Note({ tone, children }: { tone?: 'danger'; children: React.ReactNode }): React.JSX.Element {
  return <div style={{ padding: 28, font: '13px var(--font-ui)', color: tone === 'danger' ? 'var(--c-red)' : 'var(--t3)' }}>{children}</div>
}
