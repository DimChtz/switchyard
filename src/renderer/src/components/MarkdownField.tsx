import React, { useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { useAppStore } from '../store/AppStore'
import { keyLabel } from '../lib/keys'
import { noteTitle } from '../lib/noteText'
import { prefixLines, wrapWith, type MdEdit } from '../lib/mdEdit'
import { refreshLive, type LiveLinks } from './notes/livePreview'
import { applyEdit, liveEditing, liveReading } from './notes/liveSetup'
import { HoverBox } from './notes/NoteEditor'

const MONO = 'var(--font-mono)'

/**
 * What links in rendered Markdown do outside the Notes screen: [[note]]
 * opens the note, a task key its task, a web address the browser.
 * `leave` runs first (to close a sheet that's in the way).
 */
export function useLiveLinks(leave?: () => void): { current: LiveLinks } {
  const { state, dispatch } = useAppStore()
  const links: LiveLinks = {
    findNote: (name) => state.notes.find((x) => noteTitle(x).toLowerCase() === name.trim().toLowerCase()),
    openNote: (name) => {
      const hit = links.findNote(name)
      if (!hit) return dispatch({ type: 'TOAST', text: `No note titled “${name.trim()}”` })
      leave?.()
      dispatch({ type: 'OPEN_NOTE', id: hit.id })
    },
    findTask: (key) => state.tasks.find((t) => t.key === key),
    openTask: (t) => {
      leave?.()
      if (t.worktreePath) dispatch({ type: 'OPEN_TASK', taskId: t.id })
      else {
        dispatch({ type: 'NAV', view: 'board', projectId: t.projectId })
        dispatch({ type: 'SET_BOARD_FOCUS', id: t.id })
      }
    },
    openUrl: (url) => {
      if (/^https?:\/\//i.test(url)) window.api.sys.openExternal(url)
    }
  }
  const ref = useRef(links)
  ref.current = links
  return ref
}

/** Redraws the links when the notes or tasks they point at change. */
function useRefresh(view: React.RefObject<EditorView | null>): void {
  const { state } = useAppStore()
  useEffect(() => {
    view.current?.dispatch({ effects: refreshLive.of(null) })
  }, [state.notes, state.tasks, view])
}

const TOOLS: [string, string, string, MdEdit][] = [
  ['H', 'Heading', '600 12.5px var(--font-ui)', prefixLines('## ')],
  ['B', `Bold ${keyLabel('⌘B')}`, '700 12.5px var(--font-ui)', wrapWith('**', '**', 'bold')],
  ['I', `Italic ${keyLabel('⌘I')}`, 'italic 500 13px var(--font-ui)', wrapWith('*', '*', 'italic')],
  ['‹›', `Inline code ${keyLabel('⌘E')}`, `500 12px ${MONO}`, wrapWith('`', '`', 'code')],
  ['•', 'Bulleted list', '600 15px var(--font-ui)', prefixLines('- ')],
  ['1.', 'Numbered list', `500 11.5px ${MONO}`, prefixLines('1. ')],
  ['[ ]', 'Checklist', `500 11px ${MONO}`, prefixLines('- [ ] ')],
  ['“', 'Quote', '600 16px var(--font-ui)', prefixLines('> ')],
  ['{ }', 'Code block', `500 11px ${MONO}`, wrapWith('```\n', '\n```', 'code')]
]

/**
 * A Markdown text field: written and rendered in one, as in Notes (the line
 * being edited shows its Markdown), with a formatting bar. ⌘↵ is `onSubmit`.
 */
export function MarkdownField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  links,
  hint
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
  onSubmit?: () => void
  links: { current: LiveLinks }
  /** On the right of the formatting bar. */
  hint?: React.ReactNode
}): React.JSX.Element {
  const viewRef = useRef<EditorView | null>(null)
  const edit = useRef((fn: MdEdit) => viewRef.current && applyEdit(viewRef.current, fn))
  const submit = useRef<(() => void) | null>(onSubmit ?? null)
  submit.current = onSubmit ?? null
  const setup = useMemo(() => liveEditing({ placeholder, links, edit, submit }), [placeholder, links])
  useRefresh(viewRef)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 0 6px', margin: '0 -5px', borderBottom: '1px solid var(--bg-hover)' }}>
        {TOOLS.map(([l, tip, font, fn]) => (
          <HoverBox
            key={l}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => edit.current(fn)}
            title={tip}
            style={{ minWidth: 26, height: 24, padding: '0 5px', boxSizing: 'border-box', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-icon)', cursor: 'pointer', font, userSelect: 'none' }}
            hover={{ background: 'var(--bg-hover)', color: 'var(--t1)' }}
          >
            {l}
          </HoverBox>
        ))}
        <span style={{ flex: 1 }} />
        {hint ? <span style={{ font: `11px ${MONO}`, color: 'var(--t5)', whiteSpace: 'nowrap', paddingRight: 5 }}>{hint}</span> : null}
      </div>
      <div
        onMouseDown={(e) => {
          // Below the text: put the cursor at the end.
          const view = viewRef.current
          if (!view || e.target !== e.currentTarget) return
          e.preventDefault()
          view.focus()
          view.dispatch({ selection: { anchor: view.state.doc.length } })
        }}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', cursor: 'text' }}
      >
        <CodeMirror
          value={value}
          onChange={onChange}
          extensions={setup}
          basicSetup={false}
          theme="none"
          autoFocus={autoFocus}
          onCreateEditor={(view) => {
            viewRef.current = view
            // The cursor at the end of what's there.
            if (autoFocus) view.dispatch({ selection: { anchor: view.state.doc.length } })
          }}
        />
      </div>
    </div>
  )
}

// Smaller, for a side panel: the text size of the panel around it, no padding.
const compactTheme = Prec.highest(EditorView.theme({
  '&': { fontSize: '13px', lineHeight: '1.55', color: 'var(--t2)' },
  '.cm-scroller': { lineHeight: '1.55' },
  '.cm-content': { padding: '0' },
  '.cm-lp-h1': { fontSize: '15px', paddingTop: '6px !important' },
  '.cm-lp-h2': { fontSize: '14px', paddingTop: '6px !important' },
  '.cm-lp-h3': { fontSize: '13px', paddingTop: '4px !important' },
  '.cm-lp-fence': { fontSize: '11.5px', padding: '0 10px !important' },
  '.cm-lp-fence-top': { paddingTop: '6px !important' },
  '.cm-lp-fence-bottom': { paddingBottom: '6px !important' }
}))

/** Markdown, rendered (read-only; ticking a checkbox calls `onChange`). */
export function MarkdownView({ value, onChange, links, compact }: { value: string; onChange?: (v: string) => void; links: { current: LiveLinks }; compact?: boolean }): React.JSX.Element {
  const viewRef = useRef<EditorView | null>(null)
  const setup = useMemo(() => [liveReading(links), compact ? compactTheme : []], [links, compact])
  useRefresh(viewRef)
  return (
    <CodeMirror
      value={value}
      onChange={(v) => v !== value && onChange?.(v)}
      extensions={setup}
      basicSetup={false}
      theme="none"
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
    />
  )
}
