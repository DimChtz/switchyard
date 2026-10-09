/**
 * A conflicted file's text, read into what's settled and what git left marked
 * (<<<<<<< ours ||||||| base ======= theirs >>>>>>>), and put back together
 * with one side, the other, or both for a conflict.
 */

/** Its lines keep their line ends, so the file goes back together as it was ("\r\n" too). */
export type Part = { t: 'text'; lines: string[] } | { t: 'conflict'; ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string; raw: string[] }

export type Choice = 'ours' | 'theirs' | 'both' | 'both-theirs-first'

const bare = (line: string): string => line.replace(/\r?\n$/, '')
const marker = (line: string, m: string): boolean => {
  const b = bare(line)
  return b === m || b.startsWith(`${m} `)
}

/** The text's lines, each with its line end. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

export function parseConflicts(text: string): Part[] {
  const parts: Part[] = []
  let plain: string[] = []
  const lines = linesOf(text)
  let i = 0
  while (i < lines.length) {
    if (!marker(lines[i], '<<<<<<<')) {
      plain.push(lines[i++])
      continue
    }
    // A conflict - unless its markers don't close (then it's just text).
    const start = i
    const oursLabel = bare(lines[i]).slice(8)
    const ours: string[] = []
    let base: string[] | null = null
    const theirs: string[] = []
    let where: 'ours' | 'base' | 'theirs' = 'ours'
    let theirsLabel = ''
    let closed = false
    for (i = i + 1; i < lines.length; i++) {
      const l = lines[i]
      if (where === 'ours' && marker(l, '|||||||')) {
        where = 'base'
        base = []
      } else if (where !== 'theirs' && bare(l) === '=======') where = 'theirs'
      else if (where === 'theirs' && marker(l, '>>>>>>>')) {
        theirsLabel = bare(l).slice(8)
        closed = true
        i++
        break
      } else (where === 'ours' ? ours : where === 'base' ? base! : theirs).push(l)
    }
    if (!closed) {
      plain.push(...lines.slice(start))
      break
    }
    if (plain.length) parts.push({ t: 'text', lines: plain })
    plain = []
    parts.push({ t: 'conflict', ours, base, theirs, oursLabel, theirsLabel, raw: lines.slice(start, i) })
  }
  if (plain.length) parts.push({ t: 'text', lines: plain })
  return parts
}

/** How many conflicts are left in the text. */
export function conflictCount(text: string): number {
  return parseConflicts(text).filter((p) => p.t === 'conflict').length
}

/** The lines a choice keeps; a side's last line gets a line end when another follows it. */
function chosen(c: Extract<Part, { t: 'conflict' }>, choice: Choice): string[] {
  const join = (a: string[], b: string[]): string[] => {
    if (!a.length) return b
    const last = a[a.length - 1]
    return [...a.slice(0, -1), last.endsWith('\n') ? last : `${last}${b[0]?.endsWith('\r\n') ? '\r\n' : '\n'}`, ...b]
  }
  if (choice === 'ours') return c.ours
  if (choice === 'theirs') return c.theirs
  return choice === 'both' ? join(c.ours, c.theirs) : join(c.theirs, c.ours)
}

/** The text with conflict number `n` (0-based) settled. */
export function resolveConflict(text: string, n: number, choice: Choice): string {
  let k = 0
  return parseConflicts(text)
    .map((p) => (p.t === 'text' ? p.lines.join('') : k++ === n ? chosen(p, choice).join('') : p.raw.join('')))
    .join('')
}

