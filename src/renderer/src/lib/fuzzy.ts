/**
 * Fuzzy file matching for Go to file, in VS Code's spirit: the query's
 * letters in order (not necessarily together), scored higher at word
 * starts ("wsf" → WorkSpaceFiles), for runs of consecutive letters, and in
 * the file name over its folders.
 */

export interface FuzzyMatch {
  score: number
  /** Indexes in the target of the matched letters, for highlighting. */
  positions: number[]
}

const SEPARATORS = '/\\_-. '

function charBonus(target: string, j: number): number {
  if (j === 0) return 8
  const prev = target[j - 1]
  if (SEPARATORS.includes(prev)) return 8
  // camelCase: the capital after a lower-case letter starts a word.
  const c = target[j]
  if (c !== c.toLowerCase() && prev === prev.toLowerCase() && prev !== prev.toUpperCase()) return 7
  return 0
}

/**
 * The best way to find the query's letters, in order, in the target - null
 * if they aren't all there. (`targetLower`: the target lower-cased, when the
 * caller has it already.)
 */
export function fuzzyMatch(query: string, target: string, targetLower?: string): FuzzyMatch | null {
  const q = lower(query)
  const t = targetLower ?? target.toLowerCase()
  const n = q.length
  const m = t.length
  if (!n) return { score: 0, positions: [] }
  if (n > m) return null

  // Quick reject: every letter somewhere, in order.
  for (let i = 0, j = 0; i < n; i++, j++) {
    j = t.indexOf(q[i], j)
    if (j < 0) return null
  }

  // score[i*m+j]: best score with query letter i at target position j;
  // from[i*m+j]: where letter i-1 was. Buffers are reused - this runs for
  // every file of a big repository on each key press.
  const size = n * m
  if (scoreBuf.length < size) {
    scoreBuf = new Float64Array(size * 2)
    fromBuf = new Int32Array(size * 2)
  }
  const score = scoreBuf
  const from = fromBuf
  const NEG = -Infinity
  for (let i = 0; i < n; i++) {
    const row = i * m
    const prev = row - m
    // Best of the previous row up to j-2 (a gap), with where it was.
    let bestPrev = NEG
    let bestAt = -1
    for (let j = 0; j < m; j++) {
      score[row + j] = NEG
      from[row + j] = -1
      if (j < i) continue
      if (i > 0 && j >= 2 && score[prev + j - 2] > bestPrev) {
        bestPrev = score[prev + j - 2]
        bestAt = j - 2
      }
      if (t.charCodeAt(j) !== q.charCodeAt(i)) continue
      const base = 1 + charBonus(target, j) + (target[j] === query[i] ? 1 : 0)
      if (i === 0) {
        // Starting later in the target costs a little.
        score[row + j] = base - Math.min(j, 20) * 0.05
        continue
      }
      const run = score[prev + j - 1] > NEG ? score[prev + j - 1] + 5 : NEG
      const gap = bestPrev > NEG ? bestPrev - 1 : NEG
      if (run === NEG && gap === NEG) continue
      if (run >= gap) {
        score[row + j] = base + run
        from[row + j] = j - 1
      } else {
        score[row + j] = base + gap
        from[row + j] = bestAt
      }
    }
  }

  const last = (n - 1) * m
  let end = -1
  let best = NEG
  for (let j = 0; j < m; j++) {
    if (score[last + j] > best) {
      best = score[last + j]
      end = j
    }
  }
  if (end < 0) return null
  const positions: number[] = new Array(n)
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions[i] = j
    j = from[i * m + j]
  }
  return { score: best, positions }
}

let scoreBuf = new Float64Array(4096)
let fromBuf = new Int32Array(4096)

/**
 * A file path against a query: the file name first (a match there ranks
 * higher), else the whole path. Spaces are ignored; a query with "/" is
 * matched against the whole path.
 */
export function matchPath(query: string, path: string, pathLower = path.toLowerCase()): FuzzyMatch | null {
  const q = compact(query)
  if (!q) return { score: 0, positions: [] }
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  if (!q.includes('/')) {
    const nameLower = pathLower.slice(slash + 1)
    const inName = fuzzyMatch(q, name, nameLower)
    if (inName) {
      // The same match in a shorter name, and one that starts the name, rank first.
      const ql = lower(q)
      const exact = nameLower === ql ? 20 : 0
      const prefix = nameLower.startsWith(ql) ? 10 : 0
      return { score: inName.score * 2 + 40 + exact + prefix - name.length * 0.1 - path.length * 0.01, positions: inName.positions.map((p) => p + slash + 1) }
    }
  }
  const whole = fuzzyMatch(q, path, pathLower)
  return whole ? { score: whole.score - path.length * 0.05, positions: whole.positions } : null
}

// The same query is matched against every file of a checkout: normalize it once.
let lastLower = ['', '']
let lastCompact = ['', '']
function lower(s: string): string {
  if (lastLower[0] !== s) lastLower = [s, s.toLowerCase()]
  return lastLower[1]
}
function compact(s: string): string {
  if (lastCompact[0] !== s) lastCompact = [s, s.replace(/\s+/g, '')]
  return lastCompact[1]
}
