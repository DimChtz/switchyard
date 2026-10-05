import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { tags } from '@lezer/highlight'
import { StateEffect, StateField, type EditorState, type Extension, type Range, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { parseTable, wikiLink, type CellAlign } from '../../lib/noteText'
import { codeLanguage } from '../../lib/fileLang'
import type { Note, Task } from '@shared/types'

/**
 * Live preview, as in Obsidian: the note shows rendered - headings,
 * bold, checkboxes, links, tables, code - and the line being edited shows
 * its Markdown. The text stays plain Markdown; only its look changes.
 * `links` is read when a link is drawn or clicked, so it can change.
 */
export interface LiveLinks {
  /** The note titled so ([[title]]), if there is one. */
  findNote: (title: string) => Note | undefined
  /** [[title]]: open that note, or make it. */
  openNote: (title: string) => void
  /** A task key in the text (MS-38). */
  findTask: (key: string) => Task | undefined
  openTask: (task: Task) => void
  openUrl: (url: string) => void
}

/** Redraw (the notes or tasks changed: which [[links]] and keys resolve). */
export const refreshLive = StateEffect.define<null>()

const TASK_KEY = /\b[A-Z][A-Z0-9]{1,4}-\d+\b/g
const WIKI = /\[\[([^\]\n]+)\]\]/g

/* ---------- what shows its Markdown: the lines being edited ---------- */

const setFocus = StateEffect.define<boolean>()
const setPointer = StateEffect.define<boolean>()

interface Reveal {
  focus: boolean
  /** A mouse button is down: what shows stays put until it's released, so text doesn't move under the pointer. */
  pointer: boolean
  /** Lines showing their Markdown. */
  lines: Set<number>
  /** The selection those were worked out from. */
  ranges: { from: number; to: number }[]
}

function reveal(state: EditorState, focus: boolean, pointer: boolean): Reveal {
  const lines = new Set<number>()
  // Read-only (the Split and Preview modes): all of it rendered, always.
  const ranges = focus && !state.readOnly ? state.selection.ranges.map((r) => ({ from: r.from, to: r.to })) : []
  for (const r of ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    // A selection over several lines shows them rendered: revealing them all at once jumps.
    if (a === b) lines.add(a)
  }
  return { focus, pointer, lines, ranges }
}

const revealField = StateField.define<Reveal>({
  create: (s) => reveal(s, false, false),
  update(v, tr: Transaction) {
    let { focus, pointer } = v
    for (const e of tr.effects) {
      if (e.is(setFocus)) focus = e.value
      if (e.is(setPointer)) pointer = e.value
    }
    // A selection made with the mouse: held until the button comes up.
    if (tr.isUserEvent('select.pointer')) pointer = true
    const released = v.pointer && !pointer
    if (tr.docChanged || released || focus !== v.focus || (tr.selection && !pointer)) return reveal(tr.state, focus, pointer)
    return pointer === v.pointer ? v : { ...v, pointer }
  }
})

/** Whether the (settled) selection touches a..b. */
function touches(r: Reveal, a: number, b: number): boolean {
  return r.ranges.some((x) => x.from <= b && x.to >= a)
}

/* ---------- widgets ---------- */

class Bullet extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.textContent = '•'
    return s
  }
}

class Rule extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-hr'
    return s
  }
}

/** A checkbox for "- [ ]"; a click ticks it in the text. */
class Checkbox extends WidgetType {
  constructor(
    readonly done: boolean,
    readonly at: number
  ) {
    super()
  }
  eq(o: Checkbox): boolean {
    return o.done === this.done && o.at === this.at
  }
  toDOM(view: EditorView): HTMLElement {
    const s = document.createElement('span')
    s.className = `cm-lp-check${this.done ? ' cm-lp-check-on' : ''}`
    s.textContent = this.done ? '✓' : ''
    s.setAttribute('role', 'checkbox')
    s.setAttribute('aria-checked', String(this.done))
    s.onmousedown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      // The marker's "[ ]" / "[x]": its middle character flips.
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.done ? ' ' : 'x' } })
    }
    return s
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** A [[note link]] drawn as its label; a click opens (or makes) the note. */
class WikiLink extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly exists: boolean,
    readonly links: { current: LiveLinks }
  ) {
    super()
  }
  eq(o: WikiLink): boolean {
    return o.target === this.target && o.label === this.label && o.exists === this.exists
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = `cm-lp-wiki${this.exists ? '' : ' cm-lp-wiki-new'}`
    s.textContent = this.label
    s.title = this.exists ? `Open “${this.target}”` : `Create note “${this.target}”`
    s.onmousedown = (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.links.current.openNote(this.target)
    }
    return s
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Copies a code block's text; says so for a moment. */
function copyButton(code: string): HTMLElement {
  const b = document.createElement('span')
  b.className = 'cm-lp-copy'
  b.textContent = 'Copy'
  b.title = 'Copy the code'
  b.setAttribute('role', 'button')
  let t: ReturnType<typeof setTimeout> | undefined
  b.onmousedown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    window.api.sys.copy(code)
    b.textContent = 'Copied'
    b.classList.add('cm-lp-copy-done')
    clearTimeout(t)
    t = setTimeout(() => {
      b.textContent = 'Copy'
      b.classList.remove('cm-lp-copy-done')
    }, 1400)
  }
  return b
}

/** A code block's top line, rendered: its language, and Copy. */
class FenceHead extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: string
  ) {
    super()
  }
  eq(o: FenceHead): boolean {
    return o.lang === this.lang && o.code === this.code
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-fence-head'
    const l = document.createElement('span')
    l.className = 'cm-lp-fence-lang'
    l.textContent = this.lang
    const b = copyButton(this.code)
    b.classList.add('cm-lp-copy-float')
    s.append(l, b)
    return s
  }
  ignoreEvent(e: Event): boolean {
    return e.type === 'mousedown' && !!(e.target as HTMLElement).closest('.cm-lp-copy')
  }
}

/** Copy on a code block's top line while it's being edited (the fence shows as text). */
class CopyOnly extends WidgetType {
  constructor(readonly code: string) {
    super()
  }
  eq(o: CopyOnly): boolean {
    return o.code === this.code
  }
  toDOM(): HTMLElement {
    const s = copyButton(this.code)
    s.classList.add('cm-lp-copy-float')
    return s
  }
  ignoreEvent(): boolean {
    return true
  }
}

// Images read once per session (they come from disk as data: URLs).
/** An image read from disk and decoded - its size known, so its line is measured right when drawn. */
type Loaded = { src: string; w: number; h: number } | null
const images = new Map<string, Loaded | 'loading'>()

/** The image, if it's ready; otherwise starts reading it and redraws the editor when it is. */
function loadImage(url: string, view: EditorView): Loaded | 'loading' {
  const got = images.get(url)
  if (got !== undefined) return got
  images.set(url, 'loading')
  window.api.notes
    .image(url)
    .catch(() => null)
    .then(async (src) => {
      if (!src) return null
      const img = new Image()
      img.src = src
      await img.decode()
      return { src, w: img.naturalWidth, h: img.naturalHeight }
    })
    .catch(() => null)
    .then((loaded) => {
      images.set(url, loaded)
      if (view.dom.isConnected) view.dispatch({ effects: refreshLive.of(null) })
    })
  return 'loading'
}

/** ![alt](path): the image (from disk or the notes folder); a web image as a link, as they aren't loaded. */
class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
    readonly image: Loaded | 'loading',
    readonly links: { current: LiveLinks }
  ) {
    super()
  }
  eq(o: ImageWidget): boolean {
    return o.url === this.url && o.alt === this.alt && o.image === this.image
  }
  toDOM(): HTMLElement {
    const chip = (text: string, title: string): HTMLElement => {
      const c = document.createElement('span')
      c.className = 'cm-lp-image-chip'
      c.textContent = text
      c.title = title
      return c
    }
    if (/^https?:\/\//i.test(this.url)) {
      const c = chip(`▣ ${this.alt || 'image'}`, `${this.url} - web images open in the browser`)
      c.onmousedown = (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.links.current.openUrl(this.url)
      }
      return c
    }
    if (this.image === 'loading') return chip(`▣ ${this.alt || this.url}`, 'Loading…')
    if (!this.image) return chip(`▣ ${this.alt || this.url}`, `Image not found: ${this.url}`)
    const box = document.createElement('span')
    box.className = 'cm-lp-image'
    const img = document.createElement('img')
    // Its size up front (scaled down by CSS, keeping its shape), so the line's height is right at once.
    img.width = this.image.w
    img.height = this.image.h
    img.src = this.image.src
    img.alt = this.alt
    img.title = this.alt || this.url
    box.append(img)
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** A table, rendered; a click puts the cursor in it to edit its Markdown. */
class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number
  ) {
    super()
  }
  eq(o: TableWidget): boolean {
    return o.source === this.source && o.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-table-wrap'
    const t = parseTable(this.source.split('\n'))
    if (!t) return wrap
    const table = document.createElement('table')
    table.className = 'cm-lp-table'
    const row = (cells: string[], tag: 'th' | 'td', align: CellAlign[]): HTMLTableRowElement => {
      const tr = document.createElement('tr')
      cells.forEach((c, i) => {
        const cell = document.createElement(tag)
        if (align[i]) cell.style.textAlign = align[i]!
        inlineDom(cell, c)
        tr.append(cell)
      })
      return tr
    }
    const thead = document.createElement('thead')
    thead.append(row(t.head, 'th', t.align))
    const tbody = document.createElement('tbody')
    for (const r of t.rows) tbody.append(row(r, 'td', t.align))
    table.append(thead, tbody)
    wrap.append(table)
    wrap.title = 'Click to edit the table'
    wrap.onmousedown = (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      view.focus()
      view.dispatch({ selection: { anchor: this.from } })
    }
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** A table cell's inline Markdown as DOM: bold, italic, code, links (their text). */
function inlineDom(el: HTMLElement, text: string): void {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) el.append(text.slice(last, m.index))
    const k = m[0]
    const s = document.createElement('span')
    if (k.startsWith('**')) {
      s.className = 'cm-lp-strong'
      s.textContent = k.slice(2, -2)
    } else if (k[0] === '`') {
      s.className = 'cm-lp-code'
      s.textContent = k.slice(1, -1)
    } else if (k.startsWith('[[')) {
      s.className = 'cm-lp-wiki'
      s.textContent = wikiLink(k.slice(2, -2)).label
    } else if (k[0] === '[') {
      s.className = 'cm-lp-link'
      s.textContent = /^\[([^\]]+)\]/.exec(k)![1]
    } else {
      s.style.fontStyle = 'italic'
      s.textContent = k.slice(1, -1)
    }
    el.append(s)
    last = m.index! + k.length
  }
  if (last < text.length) el.append(text.slice(last))
}

/* ---------- decorations ---------- */

const hide = Decoration.replace({})
const line = (cls: string): Decoration => Decoration.line({ class: cls })

/** The text inside a fenced code block (without its fences). */
function fenceCode(state: EditorState, first: number, last: number, closed: boolean): string {
  const a = first + 1
  const b = closed ? last - 1 : last
  if (b < a) return ''
  return state.doc.sliceString(state.doc.line(a).from, state.doc.line(b).to)
}

function build(view: EditorView, links: { current: LiveLinks }): DecorationSet {
  const { state } = view
  const r = state.field(revealField)
  const lineOf = (pos: number): number => state.doc.lineAt(pos).number
  const isActive = (pos: number): boolean => r.lines.has(lineOf(pos))
  const out: Range<Decoration>[] = []
  // Code (fenced or inline) where [[links]] and task keys aren't links.
  const code: [number, number][] = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n): false | undefined => {
        const name = n.name
        const heading = /^(ATX|Setext)Heading(\d)$/.exec(name)
        if (heading) {
          const lv = Math.min(3, Number(heading[2]))
          out.push(line(`cm-lp-h${lv}`).range(state.doc.lineAt(n.from).from))
          return undefined
        }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(n.from)) return undefined
            // "## " at the start (the space too), or closing "##" at the end.
            const next = state.doc.sliceString(n.to, n.to + 1)
            const prev = state.doc.sliceString(n.from - 1, n.from)
            const a = prev === ' ' && n.from > state.doc.lineAt(n.from).from ? n.from - 1 : n.from
            const b = next === ' ' ? n.to + 1 : n.to
            if (b > a) out.push(hide.range(a, b))
            return undefined
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(n.from)) out.push(hide.range(n.from, n.to))
            return undefined
          case 'InlineCode':
            code.push([n.from, n.to])
            out.push(Decoration.mark({ class: 'cm-lp-code' }).range(n.from, n.to))
            if (!isActive(n.from)) for (const m of n.node.getChildren('CodeMark')) out.push(hide.range(m.from, m.to))
            return false
          case 'FencedCode': {
            code.push([n.from, n.to])
            const first = lineOf(n.from)
            const last = lineOf(n.to)
            const lastLine = state.doc.line(last)
            const closed = last > first && /^\s*(```|~~~)/.test(lastLine.text)
            const editing = touches(r, n.from, n.to)
            const text = fenceCode(state, first, last, closed)
            const info = n.node.getChild('CodeInfo')
            const lang = info ? state.doc.sliceString(info.from, info.to) : ''
            for (let i = first; i <= last; i++) {
              const l = state.doc.line(i)
              const cls = ['cm-lp-fence']
              if (i === first) cls.push('cm-lp-fence-top')
              if (i === last) cls.push('cm-lp-fence-bottom')
              if (i === last && closed && !editing) cls.push('cm-lp-fence-close')
              out.push(line(cls.join(' ')).range(l.from))
            }
            const top = state.doc.line(first)
            if (editing) out.push(Decoration.widget({ widget: new CopyOnly(text), side: 1 }).range(top.to))
            else {
              out.push(Decoration.replace({ widget: new FenceHead(lang, text) }).range(top.from, top.to))
              if (closed && lastLine.length) out.push(hide.range(lastLine.from, lastLine.to))
            }
            return false
          }
          case 'Blockquote': {
            for (let i = lineOf(n.from); i <= lineOf(n.to); i++) out.push(line('cm-lp-quote').range(state.doc.line(i).from))
            return undefined
          }
          case 'QuoteMark': {
            if (isActive(n.from)) return undefined
            const b = state.doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
            out.push(hide.range(n.from, b))
            return undefined
          }
          case 'HorizontalRule':
            if (!isActive(n.from)) out.push(Decoration.replace({ widget: new Rule() }).range(n.from, n.to))
            return undefined
          case 'ListMark': {
            const item = n.node.parent
            const task = item?.getChild('Task')
            const marker = task?.getChild('TaskMarker')
            if (marker) {
              // "- [ ] ": a checkbox, unless the cursor is in that bit.
              const end = state.doc.sliceString(marker.to, marker.to + 1) === ' ' ? marker.to + 1 : marker.to
              const done = /x/i.test(state.doc.sliceString(marker.from, marker.to))
              if (!touches(r, n.from, end)) out.push(Decoration.replace({ widget: new Checkbox(done, marker.from) }).range(n.from, end))
              if (done && task!.to > end) out.push(Decoration.mark({ class: 'cm-lp-done' }).range(end, task!.to))
              return undefined
            }
            if (item?.parent?.name === 'BulletList' && !isActive(n.from)) out.push(Decoration.replace({ widget: new Bullet() }).range(n.from, n.to))
            return undefined
          }
          case 'Image': {
            const url = n.node.getChild('URL')
            if (!url || isActive(n.from)) return false
            const marks = n.node.getChildren('LinkMark')
            const alt = marks.length >= 2 ? state.doc.sliceString(marks[0].to, marks[1].from) : ''
            const src = state.doc.sliceString(url.from, url.to)
            const image = /^https?:\/\//i.test(src) ? null : loadImage(src, view)
            out.push(Decoration.replace({ widget: new ImageWidget(src, alt, image, links) }).range(n.from, n.to))
            return false
          }
          case 'Link': {
            const marks = n.node.getChildren('LinkMark')
            const url = n.node.getChild('URL')
            if (!url || marks.length < 3) return undefined
            const text: [number, number] = [marks[0].to, marks[1].from]
            if (text[1] <= text[0]) return undefined
            const href = state.doc.sliceString(url.from, url.to)
            if (!isActive(n.from)) {
              out.push(hide.range(n.from, text[0]))
              out.push(hide.range(text[1], n.to))
            }
            out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': href, title: href } }).range(text[0], text[1]))
            return false
          }
          case 'URL': {
            // A bare address (GFM autolink).
            if (n.node.parent?.name === 'Link') return undefined
            const href = state.doc.sliceString(n.from, n.to)
            if (/^https?:\/\//i.test(href)) out.push(Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-url': href, title: href } }).range(n.from, n.to))
            return undefined
          }
          case 'Table':
            // Drawn by the table field (a block); inside it, no inline marks.
            code.push([n.from, n.to])
            return false
        }
        return undefined
      }
    })

    // [[links]] and task keys aren't Markdown syntax: found line by line.
    const inCode = (a: number, b: number): boolean => code.some(([x, y]) => a < y && b > x)
    for (let pos = from; pos <= to; ) {
      const l = state.doc.lineAt(pos)
      const taken: [number, number][] = []
      for (const m of l.text.matchAll(WIKI)) {
        const a = l.from + m.index!
        const b = a + m[0].length
        if (inCode(a, b)) continue
        taken.push([a, b])
        const { target, label } = wikiLink(m[1])
        if (r.lines.has(l.number)) out.push(Decoration.mark({ class: 'cm-lp-wiki-src' }).range(a, b))
        else out.push(Decoration.replace({ widget: new WikiLink(target, label, !!links.current.findNote(target), links) }).range(a, b))
      }
      if (!r.lines.has(l.number)) {
        for (const m of l.text.matchAll(TASK_KEY)) {
          const a = l.from + m.index!
          const b = a + m[0].length
          if (inCode(a, b) || taken.some(([x, y]) => a < y && b > x)) continue
          const task = links.current.findTask(m[0])
          if (task) out.push(Decoration.mark({ class: 'cm-lp-task', attributes: { 'data-task': m[0], title: `${task.title} · ${task.projectId}` } }).range(a, b))
        }
      }
      pos = l.to + 1
    }
  }
  return Decoration.set(out, true)
}

/** Tables span lines, so they're drawn from a state field (block widgets can't come from a view plugin). */
function tables(state: EditorState): DecorationSet {
  const r = state.field(revealField)
  const out: Range<Decoration>[] = []
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    if (n.name !== 'Table') continue
    const from = state.doc.lineAt(n.from).from
    const to = state.doc.lineAt(n.to).to
    if (touches(r, from, to)) {
      // Being edited: its Markdown, in columns that line up.
      for (let i = state.doc.lineAt(from).number; i <= state.doc.lineAt(to).number; i++) out.push(line('cm-lp-table-src').range(state.doc.line(i).from))
    } else out.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(from, to), from), block: true }).range(from, to))
  }
  return Decoration.set(out, true)
}

const tableField = StateField.define<DecorationSet>({
  create: tables,
  update(v, tr) {
    if (tr.docChanged || tr.state.field(revealField) !== tr.startState.field(revealField) || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return tables(tr.state)
    return v
  },
  provide: (f) => EditorView.decorations.from(f)
})

function livePlugin(links: { current: LiveLinks }): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private up: () => void
      constructor(readonly view: EditorView) {
        this.decorations = build(view, links)
        // A mouse button released anywhere: show what the new selection edits.
        this.up = () => {
          if (view.state.field(revealField).pointer) view.dispatch({ effects: setPointer.of(false) })
        }
        window.addEventListener('mouseup', this.up)
      }
      update(u: ViewUpdate): void {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.state.field(revealField) !== u.startState.field(revealField) ||
          syntaxTree(u.state) !== syntaxTree(u.startState) ||
          u.transactions.some((t) => t.effects.some((e) => e.is(refreshLive)))
        )
          this.decorations = build(u.view, links)
      }
      destroy(): void {
        window.removeEventListener('mouseup', this.up)
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e) {
          // Links and task keys drawn as such open on a click (on the line being edited they're text).
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-url], [data-task]')
          if (el && e.button === 0) {
            e.preventDefault()
            const url = el.dataset.url
            if (url) links.current.openUrl(url)
            else {
              const task = links.current.findTask(el.dataset.task!)
              if (task) links.current.openTask(task)
            }
            return true
          }
          return false
        }
      }
    }
  )
}

const MONO = "var(--font-mono)"

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600', color: 'var(--t1)' },
  { tag: tags.strong, fontWeight: '600', color: 'var(--t1)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--t-dim)' },
  { tag: tags.link, color: 'var(--c-blue)' },
  { tag: tags.url, color: 'var(--t3)' },
  { tag: tags.monospace, fontFamily: MONO, color: 'var(--c-code)' },
  { tag: tags.quote, color: 'var(--t2)' },
  // The Markdown marks themselves (#, **, `, >, -) where they show.
  { tag: [tags.processingInstruction, tags.contentSeparator], color: 'var(--t4)' },
  // Code in fenced blocks.
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--syn-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syn-type)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syn-property)' },
  { tag: [tags.tagName, tags.meta], color: 'var(--syn-tag)' }
])

const theme = EditorView.theme(
  {
    '&': { color: 'var(--t-body)', background: 'transparent', font: '400 14px/1.65 var(--font-ui)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.65', overflow: 'visible' },
    '.cm-content': { padding: '14px 0 28px', caretColor: 'var(--c-blue)' },
    '.cm-line': { padding: '1px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--c-blue)', borderLeftWidth: '1.5px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'color-mix(in srgb, var(--c-blue) 22%, transparent) !important' },
    '.cm-placeholder': { color: 'var(--t4)' },
    '.cm-lp-h1': { fontSize: '20px', lineHeight: '1.3', fontWeight: '600', color: 'var(--t1)', paddingTop: '14px !important' },
    '.cm-lp-h2': { fontSize: '16px', lineHeight: '1.4', fontWeight: '600', color: 'var(--t1)', paddingTop: '10px !important' },
    '.cm-lp-h3': { fontSize: '14px', lineHeight: '1.45', fontWeight: '600', color: 'var(--t1)', paddingTop: '8px !important' },
    '.cm-lp-strong': { fontWeight: '600', color: 'var(--t1)' },
    '.cm-lp-bullet': { display: 'inline-block', width: '1.1em', color: 'var(--t3)', fontFamily: MONO, fontSize: '13px' },
    '.cm-lp-check': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '14px',
      height: '14px',
      boxSizing: 'border-box',
      margin: '0 9px -2px 0',
      borderRadius: '3px',
      border: '1.5px solid var(--bd-6)',
      color: 'var(--c-green)',
      font: '700 9px/1 var(--font-ui)',
      cursor: 'pointer',
      verticalAlign: 'baseline'
    },
    '.cm-lp-check-on': { borderColor: 'var(--c-green)', background: 'color-mix(in srgb, var(--c-green) 16%, transparent)' },
    '.cm-lp-done': { color: 'var(--t-dim)', textDecoration: 'line-through', textDecorationColor: 'var(--t5)' },
    '.cm-lp-quote': { borderLeft: '2px solid var(--bd-5)', paddingLeft: '12px !important', color: 'var(--t2)' },
    '.cm-lp-hr': { display: 'inline-block', width: '100%', height: '1px', background: 'var(--bd-2)', verticalAlign: 'middle' },
    '.cm-lp-code': { fontFamily: MONO, fontSize: '0.88em', background: 'color-mix(in srgb, var(--ov) 7%, transparent)', padding: '1px 5px', borderRadius: '3px', color: 'var(--c-code)' },
    // Code blocks: a padded box, its language and Copy on top. (No margins on lines: the editor
    // doesn't count them when it measures, and clicks below would land a line off.)
    '.cm-lp-fence': {
      position: 'relative',
      fontFamily: MONO,
      fontSize: '12.5px',
      lineHeight: '1.7',
      background: 'var(--bg-panel-2)',
      borderLeft: '1px solid var(--bd-2)',
      borderRight: '1px solid var(--bd-2)',
      padding: '0 20px !important'
    },
    '.cm-lp-fence .cm-lp-code': { background: 'none', padding: '0' },
    '.cm-lp-fence-top': { borderTop: '1px solid var(--bd-2)', borderTopLeftRadius: '7px', borderTopRightRadius: '7px', paddingTop: '10px !important', paddingRight: '72px !important' },
    '.cm-lp-fence-bottom': { borderBottom: '1px solid var(--bd-2)', borderBottomLeftRadius: '7px', borderBottomRightRadius: '7px', paddingBottom: '12px !important' },
    '.cm-lp-fence-close': { lineHeight: '0', fontSize: '0', paddingBottom: '14px !important' },
    '.cm-lp-fence-head': { display: 'inline-block', minHeight: '20px', verticalAlign: 'top' },
    '.cm-lp-fence-lang': { font: `11px ${MONO}`, color: 'var(--t4)', letterSpacing: '0.02em' },
    '.cm-lp-copy': {
      font: '500 11px var(--font-ui)',
      color: 'var(--t-icon)',
      border: '1px solid var(--bd-3)',
      borderRadius: '4px',
      padding: '1px 8px',
      background: 'var(--bg-menu)',
      cursor: 'pointer',
      userSelect: 'none',
      lineHeight: '18px'
    },
    '.cm-lp-copy:hover': { color: 'var(--t1)', borderColor: 'var(--bd-5)' },
    '.cm-lp-copy-done': { color: 'var(--c-green) !important', borderColor: 'color-mix(in srgb, var(--c-green) 40%, transparent) !important' },
    '.cm-lp-copy-float': { position: 'absolute', right: '12px', top: '9px' },
    // Tables: rendered, or their Markdown in columns while being edited.
    '.cm-lp-table-wrap': { padding: '6px 0 10px', overflowX: 'auto', cursor: 'text' },
    '.cm-lp-table': { borderCollapse: 'collapse', font: '13px/1.5 var(--font-ui)', color: 'var(--t-body)' },
    '.cm-lp-table th, .cm-lp-table td': { border: '1px solid var(--bd-2)', padding: '6px 12px', textAlign: 'left', verticalAlign: 'top' },
    '.cm-lp-table th': { background: 'var(--bg-panel-2)', color: 'var(--t1)', fontWeight: '600' },
    '.cm-lp-table-src': { fontFamily: MONO, fontSize: '12.5px' },
    '.cm-lp-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'top' },
    '.cm-lp-image img': { display: 'block', maxWidth: 'min(100%, 720px)', height: 'auto', maxHeight: '420px', objectFit: 'contain', objectPosition: 'left', borderRadius: '6px', border: '1px solid var(--bd-2)', margin: '4px 0' },
    '.cm-lp-image-chip': { font: `12px ${MONO}`, color: 'var(--c-blue)', background: 'color-mix(in srgb, var(--c-blue) 10%, transparent)', borderRadius: '4px', padding: '1px 7px', cursor: 'pointer' },
    '.cm-lp-link': { color: 'var(--c-blue)', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' },
    '.cm-lp-wiki': { color: 'var(--c-blue)', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' },
    '.cm-lp-wiki-new': { color: 'var(--t3)' },
    '.cm-lp-wiki-src': { color: 'var(--c-blue)' },
    '.cm-lp-task': { fontFamily: MONO, fontSize: '0.84em', background: 'color-mix(in srgb, var(--c-blue) 12%, transparent)', color: 'var(--c-blue)', padding: '1px 5px', borderRadius: '3px', cursor: 'pointer' }
  },
  { dark: true }
)

/** The whole live editor setup, but for history and keys (the editor adds those). */
export function livePreview(links: { current: LiveLinks }): Extension {
  return [
    markdown({ base: markdownLanguage, codeLanguages: (info) => codeLanguage(info) }),
    syntaxHighlighting(highlight),
    theme,
    EditorView.lineWrapping,
    revealField,
    EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)),
    tableField,
    livePlugin(links)
  ]
}
