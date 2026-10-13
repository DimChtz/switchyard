/**
 * File paths in a terminal's output - "src/app.ts:42:7", "src\app.ts(42,7)",
 * Python's 'File "app.py", line 42' - for Ctrl+click to open them at that line.
 */

export interface PathMatch {
  /** Where in the line (string indexes, end exclusive). */
  start: number
  end: number
  path: string
  line: number | null
  col: number | null
}

const PATH = /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/~])?(?:[\w@.+-]+[\\/])*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,9}(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?/g

export function pathMatches(text: string): PathMatch[] {
  const out: PathMatch[] = []
  for (const m of text.matchAll(PATH)) {
    const start = m.index ?? 0
    // Not the middle of something else (a URL, an email, a version like 1.2.3).
    const before = text[start - 1] ?? ''
    if (/[\w:/@.]/.test(before)) continue
    if (/^[\w.-]+:\/\//.test(text.slice(start))) continue
    // (An email address; a scoped package's path has a slash.)
    if (m[0].includes('@') && !/[\\/]/.test(m[0])) continue
    let end = start + m[0].length
    const lineCol = m[1] ?? m[3]
    const colStr = m[2] ?? m[4]
    const path = m[0].slice(0, m[0].length - (lineCol ? m[0].length - m[0].search(/(?::\d|\(\d)/) : 0))
    let line = lineCol ? Number(lineCol) : null
    // Python: File "app.py", line 42
    const py = !line ? /^", line (\d+)/.exec(text.slice(end)) : null
    if (py) {
      line = Number(py[1])
      end += py[0].length
    }
    out.push({ start, end, path, line, col: colStr ? Number(colStr) : null })
  }
  return out
}

/** "a/./b/../c" → "a/c", with forward slashes. */
function normalize(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '.' || (seg === '' && parts.length)) continue
    if (seg === '..' && parts.length && parts[parts.length - 1] !== '..' && parts[parts.length - 1] !== '') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * A path from the output as a path in the checkout (forward slashes, from
 * its root) - relative ones from the terminal's folder. Null when it's
 * outside the checkout.
 */
export function inCheckout(path: string, cwd: string, root: string, home: string | null, windows: boolean): string | null {
  const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(path) ? path : path.startsWith('~') && home ? `${home}/${path.slice(1)}` : `${cwd}/${path}`
  const full = normalize(abs)
  const base = normalize(root).replace(/\/$/, '')
  const same = windows ? full.toLowerCase().startsWith(base.toLowerCase() + '/') : full.startsWith(base + '/')
  return same ? full.slice(base.length + 1) : null
}
