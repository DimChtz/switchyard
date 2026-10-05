import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { livePreview, type LiveLinks } from './livePreview'
import { indent, minimalChange, wrapWith, type MdEdit } from '../../lib/mdEdit'

/** Applies a Markdown edit to the editor's text and selection. */
export function applyEdit(view: EditorView, fn: MdEdit): void {
  const old = view.state.doc.toString()
  const sel = view.state.selection.main
  const [v, a, b] = fn(old, sel.from, sel.to)
  const [from, to, insert] = minimalChange(old, v)
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: a, head: b }, scrollIntoView: true })
  view.focus()
}

/**
 * The live Markdown editor (notes, task descriptions): rendered as you
 * write, with history, list-aware Enter and ⌘B / ⌘I / ⌘E / Tab. `edit`
 * is read when a key is pressed, so it can change; `submit` is ⌘↵.
 */
export function liveEditing(opts: { placeholder: string; links: { current: LiveLinks }; edit: { current: (fn: MdEdit) => void }; submit?: { current: (() => void) | null } }): Extension[] {
  const { edit, submit } = opts
  return [
    history(),
    drawSelection(),
    placeholder(opts.placeholder),
    livePreview(opts.links),
    Prec.highest(
      keymap.of([
        // Enter on an empty item ends the list or quote (Markdown's own Enter continues the rest).
        {
          key: 'Enter',
          run: (view) => {
            const sel = view.state.selection.main
            if (!sel.empty) return false
            const l = view.state.doc.lineAt(sel.head)
            if (sel.head !== l.to || !/^\s*([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)$/.test(l.text)) return false
            // A blank line after it, or the next line would still belong to it (Markdown's lazy continuation).
            view.dispatch({ changes: { from: l.from, to: l.to, insert: '\n' }, selection: { anchor: l.from + 1 } })
            return true
          }
        },
        { key: 'Mod-Enter', run: () => (submit?.current ? (submit.current(), true) : false) }
      ])
    ),
    keymap.of([
      { key: 'Mod-b', run: () => (edit.current(wrapWith('**', '**', 'bold')), true) },
      { key: 'Mod-i', run: () => (edit.current(wrapWith('*', '*', 'italic')), true) },
      { key: 'Mod-e', run: () => (edit.current(wrapWith('`', '`', 'code')), true) },
      { key: 'Tab', run: () => (edit.current(indent), true) },
      ...defaultKeymap,
      ...historyKeymap
    ]),
    // The app's own shortcuts mustn't also act on these.
    EditorView.domEventHandlers({
      keydown: (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ['b', 'i', 'e'].includes(e.key.toLowerCase())) e.stopPropagation()
        return false
      }
    })
  ]
}

/** The same rendering, read-only (checkboxes still tick). */
export function liveReading(links: { current: LiveLinks }): Extension[] {
  return [EditorState.readOnly.of(true), EditorView.editable.of(false), livePreview(links)]
}
