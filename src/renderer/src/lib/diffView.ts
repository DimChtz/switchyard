import { Language, LanguageSupport } from '@codemirror/language'
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight'
import type { DiffLine } from '@shared/types'
import { languageFor } from './fileLang'

/** A stretch of a line: its text, its syntax class ('' for none), and whether it's a changed word. */
export interface Segment {
  text: string
  cls: string
  mark: boolean
}

/** [from, to) character ranges within a line. */
export type Ranges = [number, number][]

// ── Changed lines in pairs ───────────────────────────────────────────

/**
 * Which removed line became which added one: in each run of removed lines followed by added ones,
 * the first removed with the first added, and so on. Map both ways (line index → its partner).
 */
export function pairLines(lines: DiffLine[]): Map<number, number> {
  const pairs = new Map<number, number>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== '-') {
      i++
      continue
    }
    const delFrom = i
    while (i < lines.length && lines[i].kind === '-') i++
    const addFrom = i
    while (i < lines.length && lines[i].kind === '+') i++
    const n = Math.min(addFrom - delFrom, i - addFrom)
    for (let k = 0; k < n; k++) {
      pairs.set(delFrom + k, addFrom + k)
      pairs.set(addFrom + k, delFrom + k)
    }
  }
  return pairs
}

/** One row of the side-by-side view: the old side's line, the new side's (indexes into the diff's lines), or a hunk's "@@" line. */
export interface SplitRow {
  left: number | null
  right: number | null
  hunk?: number
}

/** The diff as side-by-side rows: unchanged lines on both sides, a removed line next to the added line that replaced it. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.kind === '@') {
      rows.push({ left: null, right: null, hunk: i })
      i++
    } else if (l.kind === ' ') {
      rows.push({ left: i, right: i })
      i++
    } else {
      const dels: number[] = []
      const adds: number[] = []
      while (i < lines.length && lines[i].kind === '-') dels.push(i++)
      while (i < lines.length && lines[i].kind === '+') adds.push(i++)
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    }
  }
  return rows
}

// ── Changed words ────────────────────────────────────────────────────

const MAX_WORD_DIFF = 400

/** Words, runs of spaces and single punctuation marks, as [from, to) ranges. */
function tokens(s: string): Ranges {
  const out: Ranges = []
  const re = /\w+|\s+|[^\w\s]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push([m.index, m.index + m[0].length])
  return out
}

/**
 * The words that differ between a removed line and the added line that replaced it: the ranges of
 * each that aren't in their longest common run of words. Null when the lines have too little in
 * common for it to help (or are too long to compare).
 */
export function wordDiff(a: string, b: string): { a: Ranges; b: Ranges } | null {
  if (a === b || a.length > MAX_WORD_DIFF || b.length > MAX_WORD_DIFF) return null
  const ta = tokens(a)
  const tb = tokens(b)
  const wa = ta.map(([f, to]) => a.slice(f, to))
  const wb = tb.map(([f, to]) => b.slice(f, to))
  // Longest common subsequence of the words.
  const n = wa.length
  const m = wb.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = wa[i] === wb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const keepA = new Array<boolean>(n).fill(false)
  const keepB = new Array<boolean>(m).fill(false)
  let same = 0
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (wa[i] === wb[j]) {
      keepA[i++] = true
      keepB[j++] = true
      same += wa[i - 1].trim() ? wa[i - 1].length : 0
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  // Mostly rewritten: marking nearly every word says nothing the colors don't.
  const solid = (s: string): number => s.replace(/\s/g, '').length
  if (same < Math.min(solid(a), solid(b)) * 0.3) return null
  const ranges = (tk: Ranges, keep: boolean[]): Ranges => {
    const out: Ranges = []
    tk.forEach(([f, to], k) => {
      if (keep[k]) return
      const last = out[out.length - 1]
      if (last && last[1] === f) last[1] = to
      else out.push([f, to])
    })
    return out
  }
  return { a: ranges(ta, keepA), b: ranges(tb, keepB) }
}

// ── Lines the diff leaves out ────────────────────────────────────────

/** Unchanged lines between hunks (or before the first, after the last), in the new file's numbering. */
export interface Gap {
  /** The diff's line index this gap comes before (lines.length: after the last hunk). */
  before: number
  /** The new file's lines from..to (1-based, inclusive). */
  from: number
  to: number
  /** old line = new line + this, for these lines. */
  oldShift: number
}

/**
 * Where a diff skips unchanged lines. `total`: the new file's line count, when known
 * (needed for the lines after the last hunk).
 */
export function gapsOf(lines: DiffLine[], total: number | null): Gap[] {
  const gaps: Gap[] = []
  let nextNew = 1
  let shift = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.kind !== '@') continue
    const m = l.text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!m) continue
    const oldStart = Number(m[1])
    const newStart = Number(m[3])
    // (An empty side's start is the line before: "-0,0", "+5,0".)
    const newFirst = m[4] === '0' ? newStart + 1 : newStart
    const oldFirst = m[2] === '0' ? oldStart + 1 : oldStart
    if (newFirst > nextNew) gaps.push({ before: i, from: nextNew, to: newFirst - 1, oldShift: oldFirst - newFirst })
    // Past this hunk.
    let lastNew = newFirst - 1
    let lastOld = oldFirst - 1
    for (let k = i + 1; k < lines.length && lines[k].kind !== '@'; k++) {
      if (lines[k].newLine != null) lastNew = lines[k].newLine!
      if (lines[k].oldLine != null) lastOld = lines[k].oldLine!
    }
    nextNew = lastNew + 1
    shift = lastOld - lastNew
  }
  if (total != null && lines.some((l) => l.kind === '@') && nextNew <= total) gaps.push({ before: lines.length, from: nextNew, to: total, oldShift: shift })
  return gaps
}

/** The lines of one hunk: its "@@" line and the ones after it, up to the next. */
export function hunkAt(lines: DiffLine[], at: number): DiffLine[] {
  let end = at + 1
  while (end < lines.length && lines[end].kind !== '@') end++
  return lines.slice(at, end)
}

/** A hunk's "@@" line as people read it: where it is, and the function or heading it's in. */
export function hunkLabel(text: string): { where: string; context: string } {
  const m = text.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/)
  if (!m) return { where: text, context: '' }
  const from = Number(m[3])
  const count = m[4] == null ? 1 : Number(m[4])
  return { where: count > 1 ? `lines ${from}-${from + count - 1}` : `line ${from}`, context: m[5].trim() }
}

// ── Syntax colors ────────────────────────────────────────────────────

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: 'syn-k' },
  { tag: [t.propertyName, t.attributeName], class: 'syn-p' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], class: 'syn-f' },
  { tag: [t.typeName, t.className, t.namespace, t.annotation, t.self], class: 'syn-t' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit, t.color, t.constant(t.name), t.standard(t.name)], class: 'syn-n' },
  { tag: [t.operator, t.url, t.escape, t.regexp, t.link, t.special(t.string), t.tagName], class: 'syn-o' },
  { tag: [t.meta, t.comment, t.lineComment, t.blockComment], class: 'syn-c' },
  { tag: [t.string, t.processingInstruction], class: 'syn-s' },
  { tag: t.heading, class: 'syn-h' },
  { tag: t.strong, class: 'syn-b' },
  { tag: t.emphasis, class: 'syn-i' }
])

/** Highlighting a side of a very big diff costs more than it gives. */
const MAX_HIGHLIGHT_CHARS = 600_000

function languageOf(path: string): Language | null {
  for (const e of languageFor(path.split('/').pop() ?? path)) {
    if (e instanceof LanguageSupport) return e.language
    if (e instanceof Language) return e
  }
  return null
}

/**
 * Syntax classes for each of these lines, read as one piece of code (one side of a diff, so a
 * comment or string spanning lines comes out right): per line, [from, to, class] ranges.
 */
export function highlightLines(path: string, texts: string[]): [number, number, string][][] | null {
  const lang = languageOf(path)
  if (!lang || !texts.length) return null
  const doc = texts.join('\n')
  if (doc.length > MAX_HIGHLIGHT_CHARS) return null
  const starts: number[] = []
  let at = 0
  for (const s of texts) {
    starts.push(at)
    at += s.length + 1
  }
  const out: [number, number, string][][] = texts.map(() => [])
  let line = 0
  try {
    highlightTree(lang.parser.parse(doc), highlighter, (from, to, cls) => {
      while (line + 1 < starts.length && starts[line + 1] <= from) line++
      // A range can run over line ends (a block comment): split it per line.
      for (let l = line, f = from; l < starts.length && f < to; l++) {
        const end = starts[l] + texts[l].length
        const a = Math.max(f, starts[l])
        const b = Math.min(to, end)
        if (b > a) out[l].push([a - starts[l], b - starts[l], cls])
        f = end + 1
      }
    })
  } catch {
    return null
  }
  return out
}

/** A line cut into stretches by its syntax classes and its changed words. */
export function segmentsOf(text: string, syntax: [number, number, string][] | undefined, marks: Ranges | undefined): Segment[] {
  if (!syntax?.length && !marks?.length) return [{ text, cls: '', mark: false }]
  const cuts = new Set<number>([0, text.length])
  for (const [f, to] of syntax ?? []) cuts.add(f).add(to)
  for (const [f, to] of marks ?? []) cuts.add(f).add(to)
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b)
  const out: Segment[] = []
  for (let k = 0; k + 1 < points.length; k++) {
    const f = points[k]
    const to = points[k + 1]
    if (to <= f) continue
    const cls = (syntax ?? []).filter(([a, b]) => a <= f && b >= to).map(([, , c]) => c).join(' ')
    const mark = (marks ?? []).some(([a, b]) => a <= f && b >= to)
    const last = out[out.length - 1]
    if (last && last.cls === cls && last.mark === mark) last.text += text.slice(f, to)
    else out.push({ text: text.slice(f, to), cls, mark })
  }
  return out
}
