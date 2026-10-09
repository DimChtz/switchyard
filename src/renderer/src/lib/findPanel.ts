import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'
import type { EditorState, Extension } from '@codemirror/state'
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, setSearchQuery } from '@codemirror/search'

/** Counting stops here, so a huge file doesn't stall typing. */
const COUNT_LIMIT = 5000

const ICONS = {
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  more: '<path d="M6 4l4 4-4 4"/>'
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

function iconButton(icon: keyof typeof ICONS, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'sy-find-icon', { type: 'button', title, 'aria-label': title })
  b.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`
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

function textButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'sy-find-btn', { type: 'button', title })
  b.textContent = label
  b.onmousedown = (e) => e.preventDefault()
  b.onclick = onClick
  return b
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

/** The find (and replace) bar, in the app's own controls instead of CodeMirror's. */
function findPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state)
  const readOnly = view.state.readOnly
  let replaceOpen = !readOnly && !!query.replace

  const dom = el('div', 'sy-find')
  const findRow = el('div', 'sy-find-row')
  const replaceRow = el('div', 'sy-find-row')

  const more = iconButton('more', 'Toggle replace', () => {
    replaceOpen = !replaceOpen
    show()
    if (replaceOpen) replaceInput.focus()
  })
  more.classList.add('sy-find-more')

  const findField = el('div', 'sy-find-field')
  const findInput = el('input', '', { placeholder: 'Find', 'aria-label': 'Find', 'main-field': 'true', spellcheck: 'false' })
  const caseTog = toggle('Aa', 'Match case', () => flip('caseSensitive'))
  const wordTog = toggle('ab', 'Match whole word', () => flip('wholeWord'))
  wordTog.classList.add('sy-find-word')
  const reTog = toggle('.*', 'Use regular expression', () => flip('regexp'))
  findField.append(findInput, caseTog, wordTog, reTog)

  const count = el('span', 'sy-find-count')
  const prev = iconButton('up', 'Previous match (Shift+Enter)', () => findPrevious(view))
  const next = iconButton('down', 'Next match (Enter)', () => findNext(view))
  const close = iconButton('close', 'Close (Escape)', () => closeSearchPanel(view))
  findRow.append(more, findField, count, prev, next, el('span', 'sy-find-gap'), close)

  const replaceField = el('div', 'sy-find-field')
  const replaceInput = el('input', '', { placeholder: 'Replace', 'aria-label': 'Replace', spellcheck: 'false' })
  replaceField.append(replaceInput)
  const replaceOne = textButton('Replace', 'Replace this match (Enter)', () => replaceNext(view))
  const replaceEvery = textButton('Replace all', 'Replace every match (Ctrl+Alt+Enter)', () => replaceAll(view))
  replaceRow.append(el('span', 'sy-find-indent'), replaceField, replaceOne, replaceEvery)

  dom.append(findRow, replaceRow)

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
    count.classList.toggle('sy-none', none || bad)
    prev.disabled = next.disabled = !query.search || bad || none
    replaceOne.disabled = replaceEvery.disabled = prev.disabled
  }
  const show = (): void => {
    replaceRow.style.display = replaceOpen ? '' : 'none'
    more.style.display = readOnly ? 'none' : ''
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

const findTheme = EditorView.theme({
  '.sy-find': { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 12px 6px 8px', font: '12px var(--font-ui)' },
  '.sy-find-row': { display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 },
  '.sy-find-gap': { flex: 1 },
  '.sy-find-indent': { width: '24px', flex: 'none' },
  '.sy-find-field': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flex: '0 1 340px',
    minWidth: '120px',
    height: '26px',
    boxSizing: 'border-box',
    padding: '0 3px 0 9px',
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
  '.sy-find-count': { flex: 'none', minWidth: '70px', padding: '0 6px', font: '11.5px var(--font-mono)', color: 'var(--t3)', whiteSpace: 'nowrap' },
  '.sy-find-count.sy-none': { color: 'var(--c-red)' },
  '.sy-find-icon': { flex: 'none', width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', color: 'var(--t3)' },
  '.sy-find-icon:hover:not(:disabled)': { color: 'var(--t1)', background: 'color-mix(in srgb, var(--ov) 6%, transparent)' },
  '.sy-find-icon:disabled': { opacity: 0.4, cursor: 'default' },
  '.sy-find-more svg': { transition: 'transform 120ms' },
  '.sy-find-more.sy-open svg': { transform: 'rotate(90deg)' },
  '.sy-find-btn': {
    flex: 'none',
    height: '24px',
    padding: '0 10px',
    borderRadius: '4px',
    border: '1px solid var(--bd-3)',
    color: 'var(--t2)',
    font: '12px var(--font-ui)',
    whiteSpace: 'nowrap'
  },
  '.sy-find-btn:hover:not(:disabled)': { borderColor: 'var(--bd-5)', color: 'var(--t1)' },
  '.sy-find-btn:disabled': { opacity: 0.45, cursor: 'default' }
})

/** Ctrl+F's find bar, styled like the rest of the app. */
export const findBar: Extension = [search({ top: true, createPanel: findPanel }), findTheme]
