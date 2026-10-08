import { describe, expect, it } from 'vitest'
import type { DiffLine } from '@shared/types'
import { gapsOf, highlightLines, hunkAt, hunkLabel, pairLines, segmentsOf, splitRows, wordDiff } from './diffView'

const L = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, text, oldLine, newLine })

// Two hunks: line 3 changed, line 20 removed and two added.
const lines: DiffLine[] = [
  L('@', '@@ -2,3 +2,3 @@ function main() {', null, null),
  L(' ', 'a', 2, 2),
  L('-', 'const x = 1', 3, null),
  L('+', 'const x = 2', null, 3),
  L(' ', 'b', 4, 4),
  L('@', '@@ -19,3 +19,4 @@', null, null),
  L(' ', 'c', 19, 19),
  L('-', 'old', 20, null),
  L('+', 'new one', null, 20),
  L('+', 'new two', null, 21),
  L(' ', 'd', 21, 22)
]

describe('the diff view', () => {
  it('pairs a removed line with the added line that replaced it', () => {
    const p = pairLines(lines)
    expect([p.get(2), p.get(3), p.get(7), p.get(8), p.get(9)]).toEqual([3, 2, 8, 7, undefined])
  })

  it('puts them side by side', () => {
    expect(splitRows(lines)).toEqual([
      { left: null, right: null, hunk: 0 },
      { left: 1, right: 1 },
      { left: 2, right: 3 },
      { left: 4, right: 4 },
      { left: null, right: null, hunk: 5 },
      { left: 6, right: 6 },
      { left: 7, right: 8 },
      { left: null, right: 9 },
      { left: 10, right: 10 }
    ])
  })

  it('marks the words that changed - not when the whole line did', () => {
    expect(wordDiff('const x = 1', 'const x = 2')).toEqual({ a: [[10, 11]], b: [[10, 11]] })
    expect(wordDiff('return fetchUser(id)', 'return fetchAccount(id, true)')).toEqual({ a: [[7, 16]], b: [[7, 19], [22, 28]] })
    expect(wordDiff('alpha beta gamma', 'one two three')).toBe(null)
  })

  it('finds the unchanged lines between hunks', () => {
    expect(gapsOf(lines, 30)).toEqual([
      { before: 0, from: 1, to: 1, oldShift: 0 },
      { before: 5, from: 5, to: 18, oldShift: 0 },
      { before: 11, from: 23, to: 30, oldShift: -1 }
    ])
    // A new file's numbering past an all-new hunk.
    expect(gapsOf([L('@', '@@ -0,0 +1,2 @@', null, null), L('+', 'x', null, 1), L('+', 'y', null, 2)], 2)).toEqual([])
  })

  it('reads a hunk and its "@@" line', () => {
    expect(hunkAt(lines, 5).length).toBe(6)
    expect(hunkLabel(lines[0].text)).toEqual({ where: 'lines 2-4', context: 'function main() {' })
    expect(hunkLabel('@@ -1 +1 @@')).toEqual({ where: 'line 1', context: '' })
  })

  it('colors code across lines and cuts it with the changed words', () => {
    const hl = highlightLines('x.ts', ['const s = "hi" /* a', 'b */ + 1'])!
    expect(hl[0].some(([, , c]) => c === 'syn-k')).toBe(true)
    // The comment carries on to the second line.
    expect(hl[1][0]).toEqual([0, 4, 'syn-c'])
    expect(highlightLines('notes.unknown', ['x'])).toBe(null)
    expect(segmentsOf('const x = 2', [[0, 5, 'syn-k']], [[10, 11]])).toEqual([
      { text: 'const', cls: 'syn-k', mark: false },
      { text: ' x = ', cls: '', mark: false },
      { text: '2', cls: '', mark: true }
    ])
  })
})
