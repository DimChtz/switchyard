/**
 * Where two versions of a file differ, line by line: the blocks of lines the
 * new one added, changed or removed. For the editor's change markers.
 */

/** A changed block: old lines [oldFrom, oldTo) became new lines [newFrom, newTo) (0-based). */
export interface LineHunk {
  oldFrom: number
  oldTo: number
  newFrom: number
  newTo: number
}

export type HunkKind = 'add' | 'mod' | 'del'

export const hunkKind = (h: LineHunk): HunkKind => (h.oldFrom === h.oldTo ? 'add' : h.newFrom === h.newTo ? 'del' : 'mod')

/** Past this many edits the middle is shown as one changed block (it's a rewrite anyway). */
const MAX_EDITS = 2000

/** Myers' diff of a and b: which of a's lines were removed and which of b's were added. Null when they differ too much. */
function myers(a: Int32Array, b: Int32Array): { removed: Uint8Array; added: Uint8Array } | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let end = -1
  outer: for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    // v as it was before this step, for k in [-d-1, d+1].
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        end = d
        break outer
      }
    }
  }
  if (end < 0) return null
  const removed = new Uint8Array(n)
  const added = new Uint8Array(m)
  let x = n
  let y = m
  for (let d = end; d > 0; d--) {
    const prev = trace[d]
    const at = (k: number): number => prev[k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
    }
    if (prevK === k + 1) added[prevY] = 1
    else removed[prevX] = 1
    x = prevX
    y = prevY
  }
  return { removed, added }
}

export function diffLines(oldLines: string[], newLines: string[]): LineHunk[] {
  let start = 0
  const minLen = Math.min(oldLines.length, newLines.length)
  while (start < minLen && oldLines[start] === newLines[start]) start++
  let endOld = oldLines.length
  let endNew = newLines.length
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--
    endNew--
  }
  if (start === endOld && start === endNew) return []
  if (start === endOld || start === endNew) return [{ oldFrom: start, oldTo: endOld, newFrom: start, newTo: endNew }]

  // Lines as numbers, so comparing is cheap.
  const ids = new Map<string, number>()
  const idOf = (s: string): number => {
    let id = ids.get(s)
    if (id === undefined) ids.set(s, (id = ids.size))
    return id
  }
  const a = Int32Array.from(oldLines.slice(start, endOld), idOf)
  const b = Int32Array.from(newLines.slice(start, endNew), idOf)
  const result = myers(a, b)
  if (!result) return [{ oldFrom: start, oldTo: endOld, newFrom: start, newTo: endNew }]

  const { removed, added } = result
  const hunks: LineHunk[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && !removed[i] && !added[j]) {
      i++
      j++
      continue
    }
    const oi = i
    const nj = j
    while ((i < a.length && removed[i]) || (j < b.length && added[j])) {
      if (i < a.length && removed[i]) i++
      else j++
    }
    hunks.push({ oldFrom: start + oi, oldTo: start + i, newFrom: start + nj, newTo: start + j })
  }
  return hunks
}
