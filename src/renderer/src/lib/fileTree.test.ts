import { describe, expect, it } from 'vitest'
import { allDirPaths, buildTree } from './fileTree'

const items = [
  { path: 'src/b.ts', status: 'modified' as const },
  { path: 'src/a.ts', status: 'unchanged' as const },
  { path: 'src/lib/util.ts', status: 'unchanged' as const },
  { path: 'README.md', status: 'unchanged' as const },
  { path: 'docs', status: 'unchanged' as const, isDir: true }
]

describe('buildTree', () => {
  it('lists folders first, then files, each sorted, with their depth', () => {
    const rows = buildTree(items, new Set())
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual(['docs', 'src', '  lib', '    util.ts', '  a.ts', '  b.ts', 'README.md'])
  })

  it('hides what is inside a collapsed folder, and marks folders with changes', () => {
    const rows = buildTree(items, new Set(['src']))
    expect(rows.map((r) => r.path)).toEqual(['docs', 'src', 'README.md'])
    expect(rows.find((r) => r.path === 'src')?.dirHasChanges).toBe(true)
    expect(rows.find((r) => r.path === 'docs')?.dirHasChanges).toBe(false)
  })
})

describe('allDirPaths', () => {
  it('finds every folder, empty ones too', () => {
    expect(allDirPaths(items).sort()).toEqual(['docs', 'src', 'src/lib'])
  })
})
