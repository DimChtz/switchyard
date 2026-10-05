import { EditorView } from '@codemirror/view'
import { codeFolding, foldGutter } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { isMac } from './keys'

/**
 * Folding in the code editors (as VS Code's): a chevron right after the line
 * number - pointing down on a block that can fold, right on a folded one -
 * and "⋯ N lines" where the folded text was.
 */

const SVG = 'http://www.w3.org/2000/svg'
const FOLD_KEY = isMac ? '⌥⌘[' : 'Ctrl+Shift+['
const UNFOLD_KEY = isMac ? '⌥⌘]' : 'Ctrl+Shift+]'

function chevron(open: boolean): HTMLElement {
  const box = document.createElement('span')
  box.className = `sy-fold ${open ? 'sy-fold-open' : 'sy-fold-closed'}`
  box.title = open ? `Fold (${FOLD_KEY})` : `Unfold (${UNFOLD_KEY})`
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.4')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', open ? 'M3 4.5 6 7.5 9 4.5' : 'M4.5 3 7.5 6 4.5 9')
  svg.appendChild(path)
  box.appendChild(svg)
  return box
}

const look = EditorView.theme({
  // The numbers hug the chevrons; the chevrons get a little room before the code.
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 2px 0 14px' },
  '.cm-foldGutter': { paddingRight: '6px' },
  '.cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', padding: '0' },
  '.sy-fold': {
    width: '18px',
    height: '18px',
    maxHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'color .1s, background-color .1s, opacity .12s'
  },
  // Blocks that can fold: quiet until the gutter is hovered.
  '.sy-fold-open': { color: 'var(--t4)', opacity: '0.45' },
  '.cm-gutters:hover .sy-fold-open': { opacity: '1' },
  // A folded block always shows.
  '.sy-fold-closed': { color: 'var(--t2)', backgroundColor: 'color-mix(in srgb, var(--ov) 6%, transparent)' },
  '.sy-fold:hover': { color: 'var(--t1)', backgroundColor: 'color-mix(in srgb, var(--ov) 10%, transparent)', opacity: '1' },
  '.cm-foldPlaceholder': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    margin: '0 4px',
    padding: '0 7px',
    border: '1px solid var(--bd-3)',
    borderRadius: '4px',
    backgroundColor: 'color-mix(in srgb, var(--ov) 5%, transparent)',
    color: 'var(--t3)',
    fontSize: '0.85em',
    lineHeight: '1.45',
    verticalAlign: 'middle',
    cursor: 'pointer'
  },
  '.cm-foldPlaceholder:hover': { color: 'var(--t1)', borderColor: 'var(--bd-5)', backgroundColor: 'color-mix(in srgb, var(--ov) 9%, transparent)' },
  '.sy-fold-count': { color: 'var(--t4)', fontFamily: 'var(--font-ui)' }
})

export const folding: Extension = [
  codeFolding({
    // "⋯ 12 lines" - how much is hidden.
    preparePlaceholder: (state, range) => state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
    placeholderDOM: (_view, onclick, lines: number) => {
      const el = document.createElement('span')
      el.className = 'cm-foldPlaceholder'
      el.title = `Unfold (${UNFOLD_KEY})`
      el.setAttribute('aria-label', 'folded code')
      el.onclick = onclick
      const dots = document.createElement('span')
      dots.textContent = '⋯'
      el.appendChild(dots)
      if (lines > 0) {
        const n = document.createElement('span')
        n.className = 'sy-fold-count'
        n.textContent = `${lines} line${lines > 1 ? 's' : ''}`
        el.appendChild(n)
      }
      return el
    }
  }),
  foldGutter({ markerDOM: chevron }),
  look
]
