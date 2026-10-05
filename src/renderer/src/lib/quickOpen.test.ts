import { describe, expect, it } from 'vitest'
import { searchFiles } from './quickOpen'

const list = {
  files: ['src/index.ts', 'src/lib/util.ts', 'src/lib/fileTree.ts', 'README.md', 'package.json'],
  changed: ['src/lib/util.ts'],
  truncated: false
}

describe('searchFiles', () => {
  it('with no query: recently opened, then changed, then the rest', () => {
    const hits = searchFiles(list, '', ['package.json', 'gone.ts'])
    expect(hits.map((h) => h.path)).toEqual(['package.json', 'src/lib/util.ts', 'src/index.ts', 'src/lib/fileTree.ts', 'README.md'])
    expect(hits[0]).toMatchObject({ recent: true, changed: false })
    expect(hits[1]).toMatchObject({ recent: false, changed: true })
  })

  it('with a query: fuzzy matches only, best first, with what matched', () => {
    const hits = searchFiles(list, 'ftree', [])
    expect(hits.map((h) => h.path)).toEqual(['src/lib/fileTree.ts'])
    expect(hits[0].positions).toHaveLength(5)
  })

  it('lifts a recently opened file among equal matches', () => {
    const plain = searchFiles(list, 'ts', []).map((h) => h.path)
    const withRecent = searchFiles(list, 'ts', ['src/lib/fileTree.ts']).map((h) => h.path)
    expect(withRecent[0]).toBe('src/lib/fileTree.ts')
    expect(plain[0]).not.toBe('src/lib/fileTree.ts')
  })

  it('stops at the limit', () => {
    expect(searchFiles(list, '', [], 2)).toHaveLength(2)
  })
})
