import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSet, RangeValue, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import type { Blame } from '@shared/types'

/**
 * Blame on the line the cursor is on, as VS Code shows it: faint, after the
 * line - "You, 3 days ago • Fix the login (SYT-12)". Pointing at it shows
 * the commit, to open, copy or see on the website. It follows edits: a line
 * changed since is "not committed yet".
 */

export interface InlineBlameActions {
  /** A commit subject's task key (SYT-12), if a task made it. */
  taskOf: (subject: string) => string | null
  /** The commit, in the Changes tab. */
  open: (sha: string) => void
  /** Its page on origin's website, if it has one. */
  webUrl: (sha: string) => Promise<string | null>
}

/** The file's blame (of the file as saved, the editor's text being that), or null to show none. */
export const setInlineBlame = StateEffect.define<Blame | null>()

class LineMark extends RangeValue {
  constructor(readonly n: number) {
    super()
  }
  eq(o: LineMark): boolean {
    return o.n === this.n
  }
}

interface BlameState {
  blame: Blame | null
  /** Where each blamed line starts now (followed through edits), by its line number then. */
  starts: RangeSet<LineMark>
  /** The lines as they were, to tell a line edited since. */
  was: string[]
}

const blameField = StateField.define<BlameState>({
  create: () => ({ blame: null, starts: RangeSet.empty, was: [] }),
  update(s, tr) {
    for (const e of tr.effects)
      if (e.is(setInlineBlame)) {
        if (!e.value) return { blame: null, starts: RangeSet.empty, was: [] }
        const doc = tr.state.doc
        const marks: Range<LineMark>[] = []
        const was: string[] = []
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i)
          marks.push(new LineMark(i - 1).range(line.from))
          was.push(line.text)
        }
        return { blame: e.value, starts: RangeSet.of(marks), was }
      }
    return tr.docChanged && s.blame ? { ...s, starts: s.starts.map(tr.changes) } : s
  }
})

const NOT_COMMITTED = /^0+$/

/** "just now", "5 minutes ago", "3 days ago", "2 years ago". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000)
  const steps: [number, string][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [86400 * 30, 'day'],
    [86400 * 365, 'month'],
    [Infinity, 'year']
  ]
  const div: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, month: 86400 * 30, year: 86400 * 365 }
  if (s < 45) return 'just now'
  for (const [limit, unit] of steps)
    if (s < limit) {
      const n = Math.max(1, Math.round(s / div[unit]))
      return `${n} ${unit}${n > 1 ? 's' : ''} ago`
    }
  return ''
}

/** What the cursor's line says: its commit (null when not committed yet). */
function blameAt(state: EditorView['state']): { sha: string | null; blame: Blame } | null {
  const s = state.field(blameField, false)
  if (!s?.blame) return null
  const line = state.doc.lineAt(state.selection.main.head)
  let n = -1
  s.starts.between(line.from, line.from, (from, _to, v) => {
    if (from === line.from) n = v.n
  })
  // A new line, or one changed since: not in any commit yet.
  if (n < 0 || s.was[n] !== line.text) return { sha: null, blame: s.blame }
  const sha = s.blame.lines[n]
  return { sha: !sha || NOT_COMMITTED.test(sha) ? null : sha, blame: s.blame }
}

class BlameWidget extends WidgetType {
  constructor(
    readonly sha: string | null,
    readonly text: string,
    readonly blame: Blame,
    readonly actions: InlineBlameActions
  ) {
    super()
  }
  eq(o: BlameWidget): boolean {
    return o.sha === this.sha && o.text === this.text
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'sy-inline-blame'
    el.textContent = this.text
    if (this.sha) hoverCard(el, this.sha, this.blame, this.actions)
    return el
  }
  ignoreEvent(): boolean {
    return true
  }
}

let card: HTMLElement | null = null
let closing: ReturnType<typeof setTimeout> | undefined

/** The commit, shown while the blame (or the card) is pointed at. */
function hoverCard(anchor: HTMLElement, sha: string, blame: Blame, actions: InlineBlameActions): void {
  const close = (): void => {
    clearTimeout(closing)
    closing = setTimeout(() => {
      card?.remove()
      card = null
    }, 180)
  }
  anchor.addEventListener('mouseleave', close)
  anchor.addEventListener('mouseenter', () => {
    clearTimeout(closing)
    card?.remove()
    const c = blame.commits[sha]
    const key = actions.taskOf(c?.subject ?? '')
    const el = document.createElement('div')
    el.className = 'sy-blame-card'
    const row = (cls: string, text: string): HTMLElement => {
      const d = document.createElement('div')
      d.className = cls
      d.textContent = text
      el.appendChild(d)
      return d
    }
    row('sy-blame-card-who', `${c?.you ? 'You' : (c?.author ?? '')} · ${c ? `${ago(c.at)} (${new Date(c.at).toLocaleString()})` : ''}`)
    row('sy-blame-card-subject', c?.subject ?? '')
    row('sy-blame-card-meta', `${sha.slice(0, 8)}${key ? ` · ${key}` : ''}`)
    const bar = document.createElement('div')
    bar.className = 'sy-blame-card-actions'
    const button = (label: string, run: (b: HTMLElement) => void): HTMLElement => {
      const b = document.createElement('span')
      b.textContent = label
      b.onclick = (e) => {
        e.preventDefault()
        run(b)
      }
      bar.appendChild(b)
      return b
    }
    button('Open commit', () => {
      card?.remove()
      card = null
      actions.open(sha)
    })
    button('Copy SHA', (b) => {
      window.api.sys.copy(sha)
      b.textContent = 'Copied'
    })
    const web = button('Open on the website', () => {})
    web.style.display = 'none'
    actions
      .webUrl(sha)
      .then((url) => {
        if (!url) return
        web.style.display = ''
        web.onclick = () => window.api.sys.openExternal(url)
      })
      .catch(() => {})
    el.appendChild(bar)
    el.addEventListener('mouseenter', () => clearTimeout(closing))
    el.addEventListener('mouseleave', close)
    document.body.appendChild(el)
    // Under the blame, kept inside the window.
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`
    el.style.top = `${r.bottom + 4 + el.offsetHeight > window.innerHeight ? r.top - el.offsetHeight - 4 : r.bottom + 4}px`
    card = el
  })
}

/** The inline blame (see above), with what its card can do. */
export function inlineBlame(actions: InlineBlameActions): Extension {
  const decorate = (view: EditorView): DecorationSet => {
    const at = blameAt(view.state)
    if (!at) return Decoration.none
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const c = at.sha ? at.blame.commits[at.sha] : null
    const key = c ? actions.taskOf(c.subject) : null
    const text = c ? `${c.you ? 'You' : c.author}, ${ago(c.at)} • ${c.subject}${key ? ` (${key})` : ''}` : 'You · Not committed yet'
    return Decoration.set([Decoration.widget({ widget: new BlameWidget(at.sha, text, at.blame, actions), side: 1 }).range(line.to)])
  }
  return [
    blameField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = decorate(view)
        }
        update(u: ViewUpdate): void {
          const changed = u.transactions.some((t) => t.effects.some((e) => e.is(setInlineBlame)))
          if (u.docChanged || u.selectionSet || changed) this.decorations = decorate(u.view)
        }
        destroy(): void {
          card?.remove()
          card = null
        }
      },
      { decorations: (p) => p.decorations }
    ),
    EditorView.theme({
      '.sy-inline-blame': { marginLeft: '3em', color: 'var(--t4)', fontStyle: 'italic', opacity: 0.75, whiteSpace: 'pre', cursor: 'default', userSelect: 'none' },
      '.sy-inline-blame:hover': { opacity: 1 }
    })
  ]
}

// The card's look (it's on the page, not in an editor).
const style = document.createElement('style')
style.textContent = `
.sy-blame-card { position: fixed; z-index: 200; max-width: 460px; padding: 10px 12px; border-radius: 6px; background: var(--bg-menu); border: 1px solid var(--bd-4); box-shadow: 0 10px 28px color-mix(in srgb, var(--sh) 45%, transparent); font: 12.5px/1.45 var(--font-ui); color: var(--t1); display: flex; flex-direction: column; gap: 4px; }
.sy-blame-card-who { color: var(--t2); font-size: 12px; }
.sy-blame-card-subject { font-weight: 500; overflow-wrap: anywhere; }
.sy-blame-card-meta { font: 11.5px var(--font-mono); color: var(--t4); }
.sy-blame-card-actions { display: flex; gap: 14px; margin-top: 4px; font-size: 12px; }
.sy-blame-card-actions span { color: var(--c-blue); cursor: pointer; }
`
document.head.appendChild(style)
