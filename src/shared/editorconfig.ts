import type { EditorConfigProps } from './types'

/**
 * .editorconfig (editorconfig.org): which settings apply to a file, from the
 * .editorconfig files in its folder and the folders above it - nearer files
 * win, later sections win, and a file with `root = true` stops the search.
 */

export interface EditorConfigFile {
  /** The folder it's in, with "/" separators. */
  dir: string
  content: string
}

interface Section {
  glob: string
  props: Record<string, string>
}

interface Parsed {
  root: boolean
  sections: Section[]
}

export function parseEditorConfig(content: string): Parsed {
  const out: Parsed = { root: false, sections: [] }
  let current: Section | null = null
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const head = line.match(/^\[(.*)\]$/)
    if (head) {
      current = { glob: head[1], props: {} }
      out.sections.push(current)
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    // A value ends at an inline comment (" #" or " ;").
    const value = line
      .slice(eq + 1)
      .replace(/\s[#;].*$/, '')
      .trim()
    if (!current) {
      if (key === 'root') out.root = value.toLowerCase() === 'true'
      continue
    }
    current.props[key] = value
  }
  return out
}

/** An EditorConfig glob as a regular expression over a path relative to the file's folder. */
export function globToRegExp(glob: string): RegExp {
  let g = glob
  // No "/" in it: matches the name in any folder. A leading "/" anchors at the folder.
  if (!g.includes('/')) g = `**/${g}`
  else if (g.startsWith('/')) g = g.slice(1)
  let i = 0
  let re = ''
  while (i < g.length) {
    const c = g[i]
    if (c === '\\' && i + 1 < g.length) {
      re += escape(g[i + 1])
      i += 2
      continue
    }
    if (c === '*') {
      if (g[i + 1] === '*') {
        // "**/" also matches no folder at all.
        if (g[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
        } else {
          re += '.*'
          i += 2
        }
      } else {
        re += '[^/]*'
        i++
      }
      continue
    }
    if (c === '?') {
      re += '[^/]'
      i++
      continue
    }
    if (c === '[') {
      const end = g.indexOf(']', i + 1)
      if (end > i + 1) {
        let body = g.slice(i + 1, end)
        const neg = body.startsWith('!')
        if (neg) body = body.slice(1)
        re += `[${neg ? '^' : ''}${body.replace(/\\/g, '\\\\').replace(/^\^/, '\\^')}]`
        i = end + 1
        continue
      }
      re += '\\['
      i++
      continue
    }
    if (c === '{') {
      const end = matchingBrace(g, i)
      if (end > 0) {
        const inner = g.slice(i + 1, end)
        const range = inner.match(/^([+-]?\d+)\.\.([+-]?\d+)$/)
        if (range) {
          const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y)
          re += b - a <= 2000 ? `(?:${Array.from({ length: b - a + 1 }, (_, k) => a + k).join('|')})` : '[+-]?\\d+'
          i = end + 1
          continue
        }
        const alts = splitTop(inner)
        if (alts.length > 1) {
          re += `(?:${alts.map((alt) => globToRegExp(`/${alt}`).source.slice(1, -1)).join('|')})`
          i = end + 1
          continue
        }
        re += `\\{${escapeAll(inner)}\\}`
        i = end + 1
        continue
      }
      re += '\\{'
      i++
      continue
    }
    re += escape(c)
    i++
  }
  return new RegExp(`^${re}$`)
}

function matchingBrace(s: string, from: number): number {
  let depth = 0
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** "a,{b,c},d" → ["a", "{b,c}", "d"]: commas not inside nested braces. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '')
      i++
      continue
    }
    if (c === '{') depth++
    if (c === '}') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

const escape = (c: string): string => c.replace(/[.+^$()|[\]{}\\/]/g, '\\$&')
const escapeAll = (s: string): string => [...s].map(escape).join('')

/**
 * The settings for `filePath` (absolute, "/" separators) from these
 * .editorconfig files, given nearest first (the search stops at a root one).
 */
export function editorConfigFor(filePath: string, files: EditorConfigFile[]): EditorConfigProps {
  const path = filePath.replace(/\\/g, '/')
  // Farthest first, so nearer files override.
  const chain: { dir: string; parsed: Parsed }[] = []
  for (const f of files) {
    const parsed = parseEditorConfig(f.content)
    chain.push({ dir: f.dir.replace(/\\/g, '/').replace(/\/+$/, ''), parsed })
    if (parsed.root) break
  }
  const raw: Record<string, string> = {}
  for (const { dir, parsed } of chain.reverse()) {
    const rel = path.toLowerCase().startsWith(dir.toLowerCase() + '/') ? path.slice(dir.length + 1) : null
    if (rel === null) continue
    for (const s of parsed.sections) {
      let re: RegExp
      try {
        re = globToRegExp(s.glob)
      } catch {
        continue
      }
      if (re.test(rel)) Object.assign(raw, s.props)
    }
  }
  return toProps(raw)
}

function toProps(raw: Record<string, string>): EditorConfigProps {
  const out: EditorConfigProps = {}
  const v = (k: string): string | undefined => {
    const x = raw[k]?.toLowerCase()
    return x === undefined || x === 'unset' ? undefined : x
  }
  const int = (k: string): number | undefined => {
    const n = Number(v(k))
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  const style = v('indent_style')
  if (style === 'tab' || style === 'space') out.indent_style = style
  const tabWidth = int('tab_width')
  const size = v('indent_size') === 'tab' ? (tabWidth ?? undefined) : int('indent_size')
  if (size) out.indent_size = size
  if (tabWidth) out.tab_width = tabWidth
  else if (size) out.tab_width = size
  if (v('indent_size') === 'tab' && !out.indent_style) out.indent_style = 'tab'
  const eol = v('end_of_line')
  if (eol === 'lf' || eol === 'crlf' || eol === 'cr') out.end_of_line = eol
  if (v('charset')) out.charset = v('charset')
  for (const k of ['trim_trailing_whitespace', 'insert_final_newline'] as const) {
    const b = v(k)
    if (b === 'true' || b === 'false') out[k] = b === 'true'
  }
  const max = int('max_line_length')
  if (max) out.max_line_length = max
  return out
}
