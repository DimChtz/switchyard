import { Decoration, EditorView, GutterMarker, WidgetType, gutter, type DecorationSet } from '@codemirror/view'
import { RangeSet, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { diffLines, hunkKind, type HunkKind, type LineHunk } from './lineDiff'

/**
 * Change markers: a bar beside the lines changed since the last commit (green
 * added, blue changed, a red notch where lines were removed). Click one to see
 * what was there before, step through the changes, or put a change back.
 */

/** Past this many lines the file isn't compared (markers off). */
const MAX_LINES = 50_000

/** What the file was at the last commit (its lines), or null for no markers (a new file, not in git). */
export const setChangeBase = StateEffect.define<string | null>()
const openHunk = StateEffect.define<number | null>()

interface ChangeState {
  base: string[] | null
  hunks: LineHunk[]
  /** The change whose "before" is shown, by its index in hunks. */
  open: number | null
  markers: RangeSet<GutterMarker>
}

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: HunkKind | 'spacer') {
    super()
  }
  eq(o: ChangeMarker): boolean {
    return o.kind === this.kind
  }
  toDOM(): Node {
    const el = document.createElement('div')
    el.className = `sy-chg sy-chg-${this.kind}`
    return el
  }
}

const MARKERS = { add: new ChangeMarker('add'), mod: new ChangeMarker('mod'), del: new ChangeMarker('del') }

/** The line (0-based) a change's marker and "before" view go on - a removal's is the line after it. */
const anchorLine = (h: LineHunk, lines: number): number => (hunkKind(h) === 'del' ? Math.min(h.newFrom, lines - 1) : h.newFrom)

function compute(state: EditorState, base: string[] | null): Pick<ChangeState, 'hunks' | 'markers'> {
  const doc = state.doc
  if (!base || doc.lines > MAX_LINES || base.length > MAX_LINES) return { hunks: [], markers: RangeSet.empty }
  const lines: string[] = []
  for (const text of doc.iterLines()) lines.push(text)
  const hunks = diffLines(base, lines)
  const ranges: Range<GutterMarker>[] = []
  for (const h of hunks) {
    const kind = hunkKind(h)
    if (kind === 'del') ranges.push(MARKERS.del.range(doc.line(anchorLine(h, doc.lines) + 1).from))
    else for (let i = h.newFrom; i < h.newTo; i++) ranges.push(MARKERS[kind].range(doc.line(i + 1).from))
  }
  return { hunks, markers: RangeSet.of(ranges, true) }
}

/** Puts a change back to what the last commit had. */
function revert(view: EditorView, h: LineHunk, base: string[]): void {
  const doc = view.state.doc
  const old = base.slice(h.oldFrom, h.oldTo).join('\n')
  const kind = hunkKind(h)
  let change: { from: number; to?: number; insert?: string }
  if (kind === 'mod') change = { from: doc.line(h.newFrom + 1).from, to: doc.line(h.newTo).to, insert: old }
  else if (kind === 'add')
    change =
      h.newTo < doc.lines
        ? { from: doc.line(h.newFrom + 1).from, to: doc.line(h.newTo + 1).from }
        : { from: h.newFrom > 0 ? doc.line(h.newFrom).to : 0, to: doc.length }
  else change = h.newFrom < doc.lines ? { from: doc.line(h.newFrom + 1).from, insert: old + '\n' } : { from: doc.length, insert: (doc.length ? '\n' : '') + old }
  view.dispatch({ changes: change, effects: openHunk.of(null), userEvent: 'revert.change' })
}

/** Shows the change at `index` (wrapping round), scrolled into view. */
function showHunk(view: EditorView, index: number): void {
  const { hunks } = view.state.field(changeState)
  if (!hunks.length) return
  const i = ((index % hunks.length) + hunks.length) % hunks.length
  const pos = view.state.doc.line(anchorLine(hunks[i], view.state.doc.lines) + 1).from
  view.dispatch({ effects: [openHunk.of(i), EditorView.scrollIntoView(pos, { y: 'center' })] })
}

class PeekWidget extends WidgetType {
  constructor(
    readonly hunk: LineHunk,
    readonly index: number,
    readonly total: number,
    readonly old: string[]
  ) {
    super()
  }
  eq(o: PeekWidget): boolean {
    return o.index === this.index && o.total === this.total && o.hunk.oldFrom === this.hunk.oldFrom && o.hunk.oldTo === this.hunk.oldTo && o.hunk.newFrom === this.hunk.newFrom && o.hunk.newTo === this.hunk.newTo
  }
  toDOM(view: EditorView): HTMLElement {
    const kind = hunkKind(this.hunk)
    const box = document.createElement('div')
    box.className = `sy-peek sy-peek-${kind}`
    const head = document.createElement('div')
    head.className = 'sy-peek-head'
    const title = document.createElement('span')
    const n = this.hunk.newTo - this.hunk.newFrom
    const o = this.hunk.oldTo - this.hunk.oldFrom
    title.textContent =
      kind === 'add' ? `${n} line${n === 1 ? '' : 's'} added` : kind === 'del' ? `${o} line${o === 1 ? '' : 's'} removed` : `Changed - ${o} line${o === 1 ? '' : 's'} before`
    const of = document.createElement('span')
    of.className = 'sy-peek-of'
    of.textContent = `${this.index + 1} of ${this.total} since the last commit`
    const gap = document.createElement('span')
    gap.style.flex = '1'
    const button = (label: string, tip: string, onClick: () => void, cls = ''): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `sy-peek-btn ${cls}`
      b.textContent = label
      b.title = tip
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = onClick
      return b
    }
    head.append(
      title,
      of,
      gap,
      button('↑', 'Previous change', () => showHunk(view, this.index - 1), 'sy-peek-icon'),
      button('↓', 'Next change', () => showHunk(view, this.index + 1), 'sy-peek-icon'),
      button(kind === 'add' ? 'Remove' : 'Revert', kind === 'add' ? 'Remove the added lines' : 'Put back what the last commit had here', () => {
        const base = view.state.field(changeState).base
        if (base) revert(view, this.hunk, base)
      }),
      button('✕', 'Close (Escape)', () => view.dispatch({ effects: openHunk.of(null) }), 'sy-peek-icon')
    )
    box.append(head)
    if (this.old.length) {
      const pre = document.createElement('div')
      pre.className = 'sy-peek-old'
      for (const line of this.old.slice(0, 200)) {
        const row = document.createElement('div')
        row.textContent = line || ' '
        pre.append(row)
      }
      if (this.old.length > 200) {
        const more = document.createElement('div')
        more.className = 'sy-peek-more'
        more.textContent = `… ${this.old.length - 200} more`
        pre.append(more)
      }
      box.append(pre)
    }
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

function peekDecorations(state: EditorState, s: ChangeState): DecorationSet {
  if (s.open === null || !s.base) return Decoration.none
  const h = s.hunks[s.open]
  if (!h) return Decoration.none
  const doc = state.doc
  const widget = new PeekWidget(h, s.open, s.hunks.length, s.base.slice(h.oldFrom, h.oldTo))
  // Below a changed block; above the line after a removal (or at the end).
  if (hunkKind(h) === 'del' && h.newFrom < doc.lines) return Decoration.set(Decoration.widget({ widget, block: true, side: -1 }).range(doc.line(h.newFrom + 1).from))
  const at = hunkKind(h) === 'del' ? doc.length : doc.line(h.newTo).to
  return Decoration.set(Decoration.widget({ widget, block: true, side: 1 }).range(at))
}

const changeState = StateField.define<ChangeState>({
  create: () => ({ base: null, hunks: [], open: null, markers: RangeSet.empty }),
  update(s, tr) {
    let { base, open } = s
    let rebase = false
    for (const e of tr.effects) {
      if (e.is(setChangeBase)) {
        base = e.value === null ? null : e.value.replace(/\r\n?/g, '\n').split('\n')
        rebase = true
      }
      if (e.is(openHunk)) open = e.value
    }
    if (!rebase && !tr.docChanged) return open === s.open ? s : { ...s, open }
    const next = compute(tr.state, base)
    // An edit closes the "before" view (its change may have moved or gone).
    if (tr.docChanged && !tr.effects.some((e) => e.is(openHunk))) open = null
    if (open !== null && open >= next.hunks.length) open = null
    return { base, open, ...next }
  }
})

/** The "before" view of the open change (a block widget, so a field of its own: it needs the document). */
const peekField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    const s = tr.state.field(changeState)
    if (s === tr.startState.field(changeState) && !tr.docChanged) return deco
    return peekDecorations(tr.state, s)
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** The change on a line (0-based) - a removal's notch counts for the line it sits on. */
function hunkAtLine(s: ChangeState, line: number, lines: number): number {
  return s.hunks.findIndex((h) => (hunkKind(h) === 'del' ? anchorLine(h, lines) === line : h.newFrom <= line && line < h.newTo))
}

export const changeGutter: Extension = [
  changeState,
  peekField,
  gutter({
    class: 'cm-change-gutter',
    markers: (view) => view.state.field(changeState).markers,
    initialSpacer: () => new ChangeMarker('spacer'),
    domEventHandlers: {
      mousedown(view, line) {
        const s = view.state.field(changeState)
        const i = hunkAtLine(s, view.state.doc.lineAt(line.from).number - 1, view.state.doc.lines)
        if (i < 0) return false
        view.dispatch({ effects: openHunk.of(s.open === i ? null : i) })
        return true
      }
    }
  }),
  EditorView.domEventHandlers({
    keydown(e, view) {
      if (e.key === 'Escape' && view.state.field(changeState).open !== null) {
        view.dispatch({ effects: openHunk.of(null) })
        return true
      }
      return false
    }
  }),
  EditorView.theme({
    '.cm-change-gutter .cm-gutterElement': { padding: '0' },
    '.cm-change-gutter': { cursor: 'pointer' },
    '.sy-chg': { width: '7px', height: '100%', boxSizing: 'border-box', position: 'relative' },
    '.sy-chg-add': { borderLeft: '3px solid color-mix(in srgb, var(--c-green) 75%, transparent)' },
    '.sy-chg-mod': { borderLeft: '3px solid color-mix(in srgb, var(--c-blue) 75%, transparent)' },
    // A removal: a small red notch on the line below where the lines were.
    '.sy-chg-del::before': {
      content: '""',
      position: 'absolute',
      left: '0',
      top: '-4px',
      borderLeft: '5px solid var(--c-red)',
      borderTop: '4px solid transparent',
      borderBottom: '4px solid transparent'
    },
    '.sy-chg-add:hover, .sy-chg-mod:hover': { borderLeftWidth: '5px' },
    '.sy-peek': {
      margin: '4px 12px 6px 0',
      border: '1px solid var(--bd-4)',
      borderLeftWidth: '3px',
      borderRadius: '5px',
      background: 'var(--bg-menu)',
      font: '12px var(--font-ui)',
      overflow: 'hidden'
    },
    '.sy-peek-add': { borderLeftColor: 'var(--c-green)' },
    '.sy-peek-mod': { borderLeftColor: 'var(--c-blue)' },
    '.sy-peek-del': { borderLeftColor: 'var(--c-red)' },
    '.sy-peek-head': { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px 4px 10px', color: 'var(--t1)' },
    '.sy-peek-of': { color: 'var(--t4)', font: '11px var(--font-mono)' },
    '.sy-peek-btn': {
      height: '22px',
      padding: '0 8px',
      borderRadius: '4px',
      border: '1px solid var(--bd-3)',
      color: 'var(--t2)',
      font: '11.5px var(--font-ui)'
    },
    '.sy-peek-btn:hover': { borderColor: 'var(--bd-5)', color: 'var(--t1)' },
    '.sy-peek-icon': { width: '22px', padding: '0', border: '1px solid transparent', color: 'var(--t3)' },
    '.sy-peek-icon:hover': { borderColor: 'transparent', background: 'color-mix(in srgb, var(--ov) 7%, transparent)' },
    '.sy-peek-old': {
      maxHeight: '240px',
      overflow: 'auto',
      padding: '4px 0',
      borderTop: '1px solid var(--bd-2)',
      background: 'color-mix(in srgb, var(--c-red) 7%, var(--bg-console))',
      fontFamily: 'inherit'
    },
    '.sy-peek-old > div': { padding: '0 10px', whiteSpace: 'pre', color: 'color-mix(in srgb, var(--c-red) 55%, var(--t1))', fontFamily: 'var(--font-mono)', fontSize: '0.95em' },
    '.sy-peek-more': { color: 'var(--t4) !important', fontStyle: 'italic' }
  })
]
