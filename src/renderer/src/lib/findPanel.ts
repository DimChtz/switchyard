import { EditorView, keymap, runScopeHandlers, showPanel, type Panel, type ViewUpdate } from '@codemirror/view'
import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { filterSymbols, symbolsOf, type CodeSymbol, type SymbolKind } from './symbols'
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, searchPanelOpen, setSearchQuery } from '@codemirror/search'

/** Counting stops here, so a huge file doesn't stall typing. */
const COUNT_LIMIT = 5000

const ICONS = {
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  more: '<path d="M6 4l4 4-4 4"/>',
  // A match turning into its replacement: the arrow from the old text into the new.
  replace: '<path d="M2.5 3.5h4v3h-4z"/><path d="M4.5 9v1.5a2 2 0 002 2H9"/><path d="M8 11l1.5 1.5L8 14"/><path d="M10.5 9.5h3v4h-3z"/>',
  replaceAll: '<path d="M2.5 2.5h4v3h-4zM2.5 7h4v3h-4z" opacity=".7"/><path d="M7.5 6h1.5a2 2 0 012 2v1"/><path d="M9.5 8.5L11 10l1.5-1.5"/><path d="M9.5 11h4v3h-4z"/>'
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

function iconButton(icon: keyof typeof ICONS, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'sy-find-icon', { type: 'button', title, 'aria-label': title })
  b.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = onClick
  return b
}

function toggle(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'sy-find-tog', { type: 'button', title, 'aria-label': title, 'aria-pressed': 'false' })
  b.textContent = label
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = onClick
  return b
}

/** Places a control in the widget's grid (so the buttons stay put whatever the count says). */
function at<T extends HTMLElement>(e: T, row: number, col: number): T {
  e.style.gridRow = String(row)
  e.style.gridColumn = String(col)
  return e
}

/** How many matches, and which one the selection is on (0 when it's on none). */
function countMatches(state: EditorState, q: SearchQuery): { total: number; at: number; capped: boolean } {
  const sel = state.selection.main
  const cursor = q.getCursor(state)
  let total = 0
  let at = 0
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++
    if (r.value.from === sel.from && r.value.to === sel.to) at = total
    if (total >= COUNT_LIMIT) return { total, at, capped: true }
  }
  return { total, at, capped: false }
}

/** The find (and replace) widget, floating at the editor's top right, in the app's own controls. */
function findPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state)
  const readOnly = view.state.readOnly
  let replaceOpen = !readOnly && !!query.replace

  const dom = el('div', 'sy-float sy-find')

  const more = at(
    iconButton('more', 'Toggle replace', () => {
      replaceOpen = !replaceOpen
      show()
      if (replaceOpen) replaceInput.focus()
    }),
    1,
    1
  )
  more.classList.add('sy-find-more')

  const findField = at(el('div', 'sy-find-field'), 1, 2)
  const findInput = el('input', '', { placeholder: 'Find', 'aria-label': 'Find', 'main-field': 'true', spellcheck: 'false' })
  const caseTog = toggle('Aa', 'Match case', () => flip('caseSensitive'))
  const wordTog = toggle('ab', 'Match whole word', () => flip('wholeWord'))
  wordTog.classList.add('sy-find-word')
  const reTog = toggle('.*', 'Use regular expression', () => flip('regexp'))
  findField.append(findInput, caseTog, wordTog, reTog)

  const count = at(el('span', 'sy-find-count'), 1, 3)
  const prev = at(iconButton('up', 'Previous match (Shift+Enter)', () => findPrevious(view)), 1, 4)
  const next = at(iconButton('down', 'Next match (Enter)', () => findNext(view)), 1, 5)
  const close = at(iconButton('close', 'Close (Escape)', () => closeSearchPanel(view)), 1, 6)

  const replaceField = at(el('div', 'sy-find-field'), 2, 2)
  const replaceInput = el('input', '', { placeholder: 'Replace', 'aria-label': 'Replace', spellcheck: 'false' })
  replaceField.append(replaceInput)
  const replaceButtons = at(el('div', 'sy-find-btns'), 2, 3)
  const replaceOne = iconButton('replace', 'Replace (Enter)', () => replaceNext(view))
  const replaceEvery = iconButton('replaceAll', 'Replace all (Ctrl+Alt+Enter)', () => replaceAll(view))
  replaceButtons.append(replaceOne, replaceEvery)

  dom.append(more, findField, count, prev, next, close, replaceField, replaceButtons)

  const commit = (): void => {
    const q = new SearchQuery({
      search: findInput.value,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      replace: replaceInput.value
    })
    if (q.eq(query)) return
    query = q
    view.dispatch({ effects: setSearchQuery.of(q) })
  }
  const flip = (key: 'caseSensitive' | 'wholeWord' | 'regexp'): void => {
    query = new SearchQuery({
      search: findInput.value,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      replace: replaceInput.value,
      [key]: !query[key]
    })
    view.dispatch({ effects: setSearchQuery.of(query) })
    fill()
  }

  const fill = (): void => {
    if (findInput.value !== query.search) findInput.value = query.search
    if (replaceInput.value !== query.replace) replaceInput.value = query.replace
    caseTog.setAttribute('aria-pressed', String(query.caseSensitive))
    wordTog.setAttribute('aria-pressed', String(query.wholeWord))
    reTog.setAttribute('aria-pressed', String(query.regexp))
    recount()
  }
  const recount = (): void => {
    const bad = !!query.search && !query.valid
    findField.classList.toggle('sy-invalid', bad)
    let none = false
    if (!query.search) count.textContent = ''
    else if (bad) count.textContent = 'Bad pattern'
    else {
      const { total, at, capped } = countMatches(view.state, query)
      none = total === 0
      count.textContent = none ? 'No results' : `${at ? `${at} of ` : ''}${total}${capped ? '+' : ''}`
    }
    count.title = count.textContent
    count.classList.toggle('sy-none', none || bad)
    prev.disabled = next.disabled = !query.search || bad || none
    replaceOne.disabled = replaceEvery.disabled = prev.disabled
  }
  const show = (): void => {
    replaceField.style.display = replaceButtons.style.display = replaceOpen ? '' : 'none'
    more.style.visibility = readOnly ? 'hidden' : ''
    more.classList.toggle('sy-open', replaceOpen)
  }

  const keys = (e: KeyboardEvent, onEnter: () => void): void => {
    if (runScopeHandlers(view, e, 'search-panel')) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter()
    }
  }
  findInput.oninput = commit
  replaceInput.oninput = commit
  findInput.onkeydown = (e) => keys(e, () => (e.shiftKey ? findPrevious(view) : findNext(view)))
  replaceInput.onkeydown = (e) => keys(e, () => (e.ctrlKey && e.altKey ? replaceAll(view) : replaceNext(view)))

  fill()
  show()

  return {
    dom,
    top: true,
    mount() {
      findInput.select()
    },
    update(u: ViewUpdate) {
      // A new query - ours (typing, toggles) or Ctrl+F on a selection - or an edit or a move: recount.
      const q = u.transactions.flatMap((tr) => tr.effects.filter((e) => e.is(setSearchQuery))).pop()
      if (q) {
        query = q.value
        fill()
      } else if (u.docChanged || u.selectionSet) recount()
    }
  }
}

// ── Go to line (Ctrl+G) ──

const toggleGoto = StateEffect.define<boolean>()

const gotoOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const e of tr.effects) if (e.is(toggleGoto)) open = e.value
    // Find and Go to line share the corner: opening one closes the other.
    if (open && searchPanelOpen(tr.state)) open = false
    return open
  },
  provide: (f) => showPanel.from(f, (open) => (open ? gotoPanel : null))
})

/** "12", "12:5" (line and column), or "+3" / "-3" (relative to the cursor's line). */
export function parseGoto(text: string, current: number, lines: number): { line: number; col: number } | null {
  const m = /^\s*([+-]?)(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(text)
  if (!m) return null
  const n = Number(m[2])
  const line = m[1] === '+' ? current + n : m[1] === '-' ? current - n : n
  return { line: Math.min(Math.max(line, 1), lines), col: m[3] ? Math.max(Number(m[3]), 1) : 1 }
}

function gotoPanel(view: EditorView): Panel {
  const dom = el('div', 'sy-float sy-goto')
  const field = at(el('div', 'sy-find-field'), 1, 1)
  const input = el('input', '', { 'aria-label': 'Go to line', spellcheck: 'false' })
  field.append(input)
  const hint = at(el('span', 'sy-find-count'), 1, 2)
  const close = at(iconButton('close', 'Close (Escape)', () => done(false)), 1, 3)
  dom.append(field, hint, close)

  const describe = (): void => {
    const doc = view.state.doc
    const line = doc.lineAt(view.state.selection.main.head).number
    input.placeholder = `Line 1–${doc.lines}, or line:column`
    hint.textContent = `line ${line}`
    hint.title = `The cursor is on line ${line} of ${doc.lines}`
  }
  const target = (): { line: number; col: number } | null => {
    const doc = view.state.doc
    return parseGoto(input.value, doc.lineAt(view.state.selection.main.head).number, doc.lines)
  }
  const done = (go: boolean): void => {
    const t = go ? target() : null
    const effects: StateEffect<unknown>[] = [toggleGoto.of(false)]
    if (t) {
      const line = view.state.doc.line(t.line)
      const pos = line.from + Math.min(t.col - 1, line.length)
      view.dispatch({ selection: EditorSelection.cursor(pos), effects: [...effects, EditorView.scrollIntoView(pos, { y: 'center' })] })
    } else view.dispatch({ effects })
    view.focus()
  }
  input.oninput = () => field.classList.toggle('sy-invalid', !!input.value.trim() && !target())
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      done(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      done(false)
    }
  }
  describe()
  return {
    dom,
    top: true,
    mount() {
      input.focus()
    },
    update(u) {
      if (u.selectionSet || u.docChanged) describe()
    }
  }
}

function openGoto(view: EditorView): boolean {
  if (view.state.field(gotoOpen, false)) {
    ;(view.dom.querySelector('.sy-goto input') as HTMLInputElement | null)?.select()
    return true
  }
  if (searchPanelOpen(view.state)) closeSearchPanel(view)
  view.dispatch({ effects: [toggleSymbols.of(false), toggleGoto.of(true)] })
  return true
}

// ── Go to symbol (Ctrl+Shift+O) ──

const toggleSymbols = StateEffect.define<boolean>()

const symbolsOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const e of tr.effects) if (e.is(toggleSymbols)) open = e.value
    if (open && searchPanelOpen(tr.state)) open = false
    return open
  },
  provide: (f) => showPanel.from(f, (open) => (open ? symbolPanel : null))
})

const KIND_MARK: Record<SymbolKind, [string, string]> = {
  function: ['ƒ', 'var(--syn-function)'],
  method: ['m', 'var(--syn-function)'],
  class: ['C', 'var(--syn-type)'],
  interface: ['I', 'var(--syn-type)'],
  type: ['T', 'var(--syn-type)'],
  enum: ['E', 'var(--syn-type)'],
  property: ['p', 'var(--syn-property)'],
  variable: ['v', 'var(--t3)'],
  heading: ['#', 'var(--t2)'],
  rule: ['{}', 'var(--syn-tag)']
}

function symbolPanel(view: EditorView): Panel {
  const dom = el('div', 'sy-float sy-sym')
  const field = el('div', 'sy-find-field')
  const input = el('input', '', { 'aria-label': 'Go to symbol', spellcheck: 'false' })
  field.append(input)
  const list = el('div', 'sy-sym-list')
  dom.append(field, list)

  const state = view.state
  const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state)
  const all = symbolsOf(tree, state.doc.toString())
  const head = state.selection.main.head
  let shown: CodeSymbol[] = all
  // Starts on the symbol the cursor is in (or the last one before it).
  let index = Math.max(0, all.reduce((at, s, i) => (s.from <= head ? i : at), -1))
  input.placeholder = all.length ? `Go to symbol (${all.length})` : 'Go to symbol'

  const close = (jump: CodeSymbol | null): void => {
    view.dispatch(
      jump
        ? { selection: EditorSelection.range(jump.from, jump.to), effects: [toggleSymbols.of(false), EditorView.scrollIntoView(jump.from, { y: 'center' })] }
        : { effects: toggleSymbols.of(false) }
    )
    view.focus()
  }
  const render = (): void => {
    list.replaceChildren()
    if (!shown.length) {
      const empty = el('div', 'sy-sym-empty')
      empty.textContent = all.length ? 'No symbol matches.' : 'No symbols in this file.'
      list.append(empty)
      return
    }
    const flat = !!input.value.trim()
    shown.slice(0, 400).forEach((s, i) => {
      const row = el('div', `sy-sym-row${i === index ? ' sy-on' : ''}`, { 'data-i': String(i) })
      const [mark, color] = KIND_MARK[s.kind]
      const kind = el('span', 'sy-sym-kind', { title: s.kind })
      kind.textContent = mark
      kind.style.color = color
      const name = el('span', 'sy-sym-name')
      name.textContent = s.name
      name.title = s.name
      if (!flat) name.style.paddingLeft = `${Math.min(s.depth, 6) * 12}px`
      const line = el('span', 'sy-sym-line')
      line.textContent = String(state.doc.lineAt(s.from).number)
      row.append(kind, name, line)
      row.onmousedown = (e) => e.preventDefault()
      row.onclick = () => close(s)
      row.onmousemove = (e) => {
        if ((e.movementX || e.movementY) && i !== index) move(i)
      }
      list.append(row)
    })
  }
  const move = (i: number): void => {
    if (!shown.length) return
    index = (i + shown.length) % shown.length
    list.querySelectorAll('.sy-on').forEach((r) => r.classList.remove('sy-on'))
    const row = list.querySelector<HTMLElement>(`[data-i="${index}"]`)
    row?.classList.add('sy-on')
    row?.scrollIntoView({ block: 'nearest' })
    // A look at it, without moving the cursor.
    view.dispatch({ effects: EditorView.scrollIntoView(shown[index].from, { y: 'center' }) })
  }
  input.oninput = () => {
    shown = filterSymbols(all, input.value)
    index = 0
    render()
  }
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(index + (e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      close(shown[index] ?? null)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close(null)
    }
  }
  render()
  return {
    dom,
    top: true,
    mount() {
      input.focus()
      list.querySelector<HTMLElement>('.sy-on')?.scrollIntoView({ block: 'nearest' })
    }
  }
}

function openSymbols(view: EditorView): boolean {
  if (view.state.field(symbolsOpen, false)) {
    ;(view.dom.querySelector('.sy-sym input') as HTMLInputElement | null)?.select()
    return true
  }
  if (searchPanelOpen(view.state)) closeSearchPanel(view)
  view.dispatch({ effects: [toggleGoto.of(false), toggleSymbols.of(true)] })
  return true
}

const floatTheme = EditorView.theme({
  // The top panels float over the code at the top right (as VS Code's find widget) instead of pushing it down.
  '.cm-panels.cm-panels-top': {
    position: 'absolute',
    top: '0',
    left: 'auto',
    right: '18px',
    zIndex: 20,
    background: 'transparent',
    border: 'none',
    pointerEvents: 'none'
  },
  '.sy-float': {
    pointerEvents: 'auto',
    display: 'grid',
    alignItems: 'center',
    columnGap: '2px',
    rowGap: '5px',
    padding: '5px 5px 5px 4px',
    background: 'var(--bg-menu)',
    border: '1px solid var(--bd-4)',
    borderTop: 'none',
    borderRadius: '0 0 6px 6px',
    boxShadow: '0 6px 18px color-mix(in srgb, var(--sh) 40%, transparent)',
    font: '12px var(--font-ui)'
  },
  // chevron | find field | count | ↑ | ↓ | ×
  '.sy-find': { gridTemplateColumns: '22px minmax(0, 1fr) 86px 24px 24px 24px', width: 'min(440px, calc(100vw - 80px))' },
  '.sy-sym': { gridTemplateColumns: 'minmax(0, 1fr)', width: 'min(420px, calc(100vw - 80px))', paddingLeft: '5px' },
  '.sy-sym-list': { maxHeight: '320px', overflow: 'auto', margin: '0 -1px' },
  '.sy-sym-row': { display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto', alignItems: 'center', columnGap: '6px', height: '24px', padding: '0 8px 0 4px', borderRadius: '4px', cursor: 'pointer' },
  '.sy-sym-row.sy-on': { background: 'color-mix(in srgb, var(--c-blue) 16%, transparent)' },
  '.sy-sym-kind': { font: '600 11px var(--font-mono)', textAlign: 'center' },
  '.sy-sym-name': { font: '12.5px var(--font-mono)', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.sy-sym-line': { font: '11px var(--font-mono)', color: 'var(--t4)' },
  '.sy-sym-empty': { padding: '8px 10px', color: 'var(--t4)', font: '12px var(--font-ui)' },
  '.sy-goto': { gridTemplateColumns: 'minmax(0, 1fr) 80px 24px', width: 'min(340px, calc(100vw - 80px))', paddingLeft: '5px' },
  '.sy-find-field': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: 0,
    height: '26px',
    boxSizing: 'border-box',
    padding: '0 3px 0 8px',
    background: 'var(--bg-app)',
    border: '1px solid var(--bd-3)',
    borderRadius: '5px'
  },
  '.sy-find-field:focus-within': { borderColor: 'color-mix(in srgb, var(--c-blue) 60%, transparent)' },
  '.sy-find-field.sy-invalid': { borderColor: 'var(--c-red)' },
  '.sy-find-field input': { flex: 1, minWidth: 0, height: '100%', padding: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--t1)', font: '12.5px var(--font-mono)' },
  '.sy-find-field input::placeholder': { color: 'var(--t4)', fontFamily: 'var(--font-ui)' },
  '.sy-find-tog': {
    flex: 'none',
    minWidth: '22px',
    height: '20px',
    padding: '0 4px',
    borderRadius: '3px',
    border: '1px solid transparent',
    color: 'var(--t3)',
    font: '11px var(--font-mono)'
  },
  '.sy-find-tog:hover': { color: 'var(--t1)', background: 'color-mix(in srgb, var(--ov) 6%, transparent)' },
  '.sy-find-tog[aria-pressed=true]': {
    color: 'var(--c-blue)',
    background: 'color-mix(in srgb, var(--c-blue) 14%, transparent)',
    borderColor: 'color-mix(in srgb, var(--c-blue) 40%, transparent)'
  },
  '.sy-find-word': { textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.sy-find-count': { padding: '0 6px', font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.sy-find-count.sy-none': { color: 'var(--c-red)' },
  '.sy-find-btns': { display: 'flex', gap: '2px', paddingLeft: '4px' },
  '.sy-find-icon': { width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', color: 'var(--t3)' },
  '.sy-find-icon:hover:not(:disabled)': { color: 'var(--t1)', background: 'color-mix(in srgb, var(--ov) 7%, transparent)' },
  '.sy-find-icon:disabled': { opacity: 0.35, cursor: 'default' },
  '.sy-find-more svg': { transition: 'transform 120ms' },
  '.sy-find-more.sy-open svg': { transform: 'rotate(90deg)' }
})

/** Ctrl+F's find widget, Ctrl+G's go to line and Ctrl+Shift+O's go to symbol, styled like the rest of the app. */
export const findBar: Extension = [
  search({ top: true, createPanel: findPanel }),
  gotoOpen,
  symbolsOpen,
  // Ctrl+G (on the Mac too, as VS Code) - instead of CodeMirror's "find next" there; ⌘G stays find next.
  // Ctrl+Shift+O / ⇧⌘O: go to symbol.
  Prec.highest(
    keymap.of([
      { key: 'Ctrl-g', run: openGoto, preventDefault: true },
      { key: 'Mod-Shift-o', run: openSymbols, preventDefault: true }
    ])
  ),
  Prec.highest(floatTheme)
]
