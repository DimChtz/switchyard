import { describe, expect, it } from 'vitest'
import { fuzzyMatch, matchPath } from './fuzzy'

const rank = (query: string, paths: string[]): string[] =>
  paths
    .map((p) => ({ p, m: matchPath(query, p) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.p)

describe('fuzzyMatch', () => {
  it('finds the letters in order, and nothing when one is missing or out of order', () => {
    expect(fuzzyMatch('wsf', 'WorkspaceFiles.tsx')).not.toBeNull()
    expect(fuzzyMatch('fsw', 'WorkspaceFiles.tsx')).toBeNull()
    expect(fuzzyMatch('xyz', 'WorkspaceFiles.tsx')).toBeNull()
  })

  it('prefers word starts and runs of letters', () => {
    expect(fuzzyMatch('wf', 'WorkspaceFiles.tsx')!.positions).toEqual([0, 9])
    expect(fuzzyMatch('files', 'WorkspaceFiles.tsx')!.positions).toEqual([9, 10, 11, 12, 13])
  })
})

describe('matchPath', () => {
  const paths = [
    'src/renderer/src/screens/workspace/WorkspaceFiles.tsx',
    'src/renderer/src/screens/workspace/WorkspaceChanges.tsx',
    'src/main/services/fs.ts',
    'src/renderer/src/lib/fileTree.ts',
    'docs/workspace-files.md',
    'README.md'
  ]

  it('ranks a match in the file name over one spread through the folders', () => {
    // Both files named workspace-files come before anything else in the workspace folder.
    expect(rank('wsfiles', paths).slice(0, 2).sort()).toEqual(['docs/workspace-files.md', 'src/renderer/src/screens/workspace/WorkspaceFiles.tsx'])
    expect(rank('WorkspaceFiles.tsx', paths)[0]).toBe('src/renderer/src/screens/workspace/WorkspaceFiles.tsx')
    expect(rank('fs', paths)[0]).toBe('src/main/services/fs.ts')
  })

  it('puts an exact file name first', () => {
    expect(rank('readme.md', paths)[0]).toBe('README.md')
  })

  it('matches folders too, and a query with "/" against the whole path', () => {
    expect(rank('main/fs', paths)).toEqual(['src/main/services/fs.ts'])
    expect(rank('lib tree', paths)[0]).toBe('src/renderer/src/lib/fileTree.ts')
  })

  it('highlights positions in the whole path', () => {
    const m = matchPath('fs', 'src/main/services/fs.ts')!
    expect(m.positions.map((i) => 'src/main/services/fs.ts'[i]).join('')).toBe('fs')
    expect(m.positions[0]).toBe('src/main/services/'.length)
  })
})
