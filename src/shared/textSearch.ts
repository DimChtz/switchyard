/**
 * Search in files (the explorer's search, Ctrl+Shift+F): the query as a
 * regular expression, include/exclude globs, the matches in a file, and
 * replacing them. Shared by the main process (which reads the files) and
 * the page (which replaces in unsaved editor text).
 */

export interface TextSearchOptions {
  query: string
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  /** Comma-separated globs ("src/**\/*.ts, *.tsx") or plain text a path must contain. */
  include: string
  exclude: string
}

export interface LineMatch {
  /** 0-based line. */
  line: number
  /** The line (cut at MAX_LINE characters). */
  text: string
  /** [start, length] of each match in the line. */
  ranges: [number, number][]
}

export interface FileMatches {
  path: string
  count: number
  lines: LineMatch[]
}

export interface TextSearchResult {
  files: FileMatches[]
  total: number
  /** Stopped at the result limit. */
  truncated: boolean
  error?: string
}

const MAX_LINE = 400

/** The query as a global RegExp - or why it isn't one. Empty query: null, no error. */
export function searchRegex(o: Pick<TextSearchOptions, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>): { rx: RegExp | null; error: string | null } {
  if (!o.query) return { rx: null, error: null }
  const src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return { rx: new RegExp(o.wholeWord ? `\\b(?:${src})\\b` : src, `g${o.caseSensitive ? '' : 'i'}m`), error: null }
  } catch {
    return { rx: null, error: 'Invalid regular expression' }
  }
}

/**
 * "src/**\/*.ts, *.tsx, node_modules" as path tests: a glob matches the whole
 * path or its end at a folder boundary; plain text matches anywhere in it.
 */
export function globMatchers(list: string): ((path: string) => boolean)[] {
  return list
    .split(',')
    .map((g) => g.trim().replace(/^\.\//, ''))
    .filter(Boolean)
    .map((g) => {
      if (!/[*?]/.test(g)) return (path: string) => path.includes(g)
      const body = g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        // eslint-disable-next-line no-control-regex -- placeholders for ** and * while the rest is escaped
        .replace(/\u0000/g, '(.*/)?')
        // eslint-disable-next-line no-control-regex
        .replace(/\u0001/g, '.*')
      const rx = new RegExp(`(^|/)${body}$`)
      return (path: string) => rx.test(path)
    })
}

/** Whether a path passes "files to include" and "files to exclude". */
export function pathFilter(o: Pick<TextSearchOptions, 'include' | 'exclude'>): (path: string) => boolean {
  const inc = globMatchers(o.include)
  const exc = globMatchers(o.exclude)
  return (path) => (!inc.length || inc.some((f) => f(path))) && !exc.some((f) => f(path))
}

/** The matching lines of a text, with every match in each. */
export function matchLines(text: string, rx: RegExp, limit = Infinity): LineMatch[] {
  const out: LineMatch[] = []
  const lines = text.split(/\r?\n/)
  let found = 0
  for (let i = 0; i < lines.length && found < limit; i++) {
    const line = lines[i]
    rx.lastIndex = 0
    const ranges: [number, number][] = []
    let m: RegExpExecArray | null
    while ((m = rx.exec(line))) {
      if (m[0] === '') {
        rx.lastIndex++
        continue
      }
      ranges.push([m.index, m[0].length])
      if (++found >= limit) break
    }
    if (ranges.length) out.push({ line: i, text: line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line, ranges: ranges.filter(([s]) => s < MAX_LINE) })
  }
  return out
}

/**
 * The text with every match replaced; with a regular expression, $1 and the
 * like work, otherwise the replacement is taken as it is. And how many.
 */
export function replaceMatches(text: string, rx: RegExp, replacement: string, regex: boolean): { text: string; count: number } {
  let count = 0
  const out = text.replace(rx, (...args) => {
    const match = args[0] as string
    if (match === '') return match
    count++
    if (!regex) return replacement
    // Expand $1, $&… against this match alone.
    const one = new RegExp(rx.source, rx.flags.replace('g', ''))
    return match.replace(one, replacement)
  })
  return { text: out, count }
}
