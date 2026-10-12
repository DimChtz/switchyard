import { describe, expect, it } from 'vitest'
import { diffLines, hunkKind } from './lineDiff'

const L = (s: string): string[] => s.split('')

/** Applies the hunks to the old lines: must give the new ones. */
function apply(oldLines: string[], newLines: string[]): string[] {
  const hunks = diffLines(oldLines, newLines)
  const out: string[] = []
  let i = 0
  for (const h of hunks) {
    out.push(...oldLines.slice(i, h.oldFrom), ...newLines.slice(h.newFrom, h.newTo))
    i = h.oldTo
  }
  return [...out, ...oldLines.slice(i)]
}

describe('diffLines', () => {
  it('finds nothing in equal files', () => {
    expect(diffLines(L('abc'), L('abc'))).toEqual([])
  })
  it('finds an added, a changed and a removed block', () => {
    const hunks = diffLines(L('abcdefg'), L('abXcdeg'))
    expect(hunks.map(hunkKind)).toEqual(['add', 'del'])
    expect(hunks[0]).toEqual({ oldFrom: 2, oldTo: 2, newFrom: 2, newTo: 3 })
    expect(hunks[1]).toEqual({ oldFrom: 5, oldTo: 6, newFrom: 6, newTo: 6 })
    expect(diffLines(L('abcd'), L('aXYd')).map(hunkKind)).toEqual(['mod'])
  })
  it('handles changes at the start and the end', () => {
    expect(diffLines(L('abc'), L('Xabc'))).toEqual([{ oldFrom: 0, oldTo: 0, newFrom: 0, newTo: 1 }])
    expect(diffLines(L('abc'), L('ab'))).toEqual([{ oldFrom: 2, oldTo: 3, newFrom: 2, newTo: 2 }])
    expect(diffLines([], L('ab'))).toEqual([{ oldFrom: 0, oldTo: 0, newFrom: 0, newTo: 2 }])
  })
  it('always rebuilds the new file from the old one', () => {
    let seed = 7
    const rand = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2147483648) % n
    for (let round = 0; round < 300; round++) {
      const a = Array.from({ length: rand(30) }, () => 'abcde'[rand(5)])
      const b = a.slice()
      for (let e = rand(8); e > 0; e--) {
        const at = rand(b.length + 1)
        if (rand(2)) b.splice(at, 0, 'xyz'[rand(3)])
        else b.splice(at, 1)
      }
      expect(apply(a, b)).toEqual(b)
    }
  })
})
