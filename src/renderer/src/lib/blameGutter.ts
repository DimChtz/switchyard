import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { Blame } from '@shared/types'
import { timeAgo } from './status'

const NOT_COMMITTED = /^0+$/

/** One line's blame: shown in full where a commit's run of lines starts, as a bar below. */
class BlameMarker extends GutterMarker {
  constructor(
    readonly sha: string,
    readonly label: string,
    readonly tip: string,
    readonly first: boolean,
    readonly tint: string
  ) {
    super()
  }
  eq(o: BlameMarker): boolean {
    return o.sha === this.sha && o.first === this.first && o.label === this.label
  }
  toDOM(): Node {
    const el = document.createElement('div')
    el.className = `sy-blame${this.first ? ' first' : ''}`
    el.style.borderLeftColor = this.tint
    // (The lines below a commit's first keep the bar: a space, so the line has its height.)
    el.textContent = this.first ? this.label : ' '
    el.title = this.tip
    return el
  }
}

/** Older is fainter: a bar from blue (today) to grey (a year or more). */
function tintFor(at: number): string {
  const days = (Date.now() - at) / 86_400_000
  const k = Math.max(0, Math.min(1, Math.log10(1 + days) / Math.log10(366)))
  return `color-mix(in srgb, var(--c-blue) ${Math.round(80 - k * 65)}%, var(--bd-2))`
}

/**
 * A gutter saying who last changed each line, when, and in which task (`taskOf`: a commit
 * subject's task key). Clicking a line's blame opens its commit (`onOpen`).
 */
export function blameGutter(blame: Blame, taskOf: (subject: string) => string | null, onOpen: (sha: string) => void): Extension {
  const markers = blame.lines.map((sha, i) => {
    const first = i === 0 || blame.lines[i - 1] !== sha
    if (NOT_COMMITTED.test(sha)) return new BlameMarker(sha, 'not committed yet', 'Changed in the worktree, not committed yet', first, 'var(--c-amber)')
    const c = blame.commits[sha]
    const key = taskOf(c?.subject ?? '')
    const label = `${timeAgo(c?.at ?? 0)} ${key ?? c?.author ?? ''}`.trim()
    const tip = `${sha.slice(0, 7)} · ${c?.author ?? ''} · ${c ? new Date(c.at).toLocaleString() : ''}\n${c?.subject ?? ''}${key ? `\n(${key})` : ''}\n\nClick to see the commit`
    return new BlameMarker(sha, `${sha.slice(0, 7)} ${label}`, tip, first, tintFor(c?.at ?? 0))
  })
  return [
    gutter({
      class: 'cm-blame-gutter',
      lineMarker(view, line) {
        const n = view.state.doc.lineAt(line.from).number
        return markers[n - 1] ?? null
      },
      lineMarkerChange: () => false,
      initialSpacer: () => new BlameMarker('', '0000000 30d SYT-000', '', true, 'transparent'),
      domEventHandlers: {
        click(view, line) {
          const sha = blame.lines[view.state.doc.lineAt(line.from).number - 1]
          if (sha && !NOT_COMMITTED.test(sha)) onOpen(sha)
          return true
        }
      }
    }),
    EditorView.theme({
      '.cm-blame-gutter': { borderRight: '1px solid var(--bd-1)', cursor: 'pointer' },
      '.sy-blame': { width: '168px', padding: '0 8px 0 6px', borderLeft: '2px solid transparent', font: '11px var(--font-mono)', color: 'var(--t4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' },
      '.sy-blame.first': { color: 'var(--t3)' },
      '.sy-blame:hover': { color: 'var(--t1)' }
    })
  ]
}
