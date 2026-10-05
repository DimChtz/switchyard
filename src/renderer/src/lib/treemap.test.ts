import { describe, expect, it } from 'vitest'
import { buildTree, commonFolder, find, layout, placeOf, squarify, weight } from './treemap'

describe('treemap', () => {
  const files = [
    { path: 'src/app.ts', size: 30_000 },
    { path: 'src/util/a.ts', size: 2_000 },
    { path: 'src/util/b.ts', size: 1_000 },
    { path: 'README.md', size: 4_000 },
    { path: 'package-lock.json', size: 900_000 }
  ]

  it('builds folders with summed, capped weights, new files included', () => {
    const root = buildTree(files, ['src/util/new.ts'])
    // The lockfile is capped (48 KB, not 900), still more than src's few small files.
    expect(root.children!.map((c) => c.name)).toEqual(['package-lock.json', 'src', 'README.md'])
    expect(find(root, 'src')!.size).toBeLessThan(weight(900_000))
    expect(find(root, 'src/util')!.children!.map((c) => [c.name, !!c.isNew])).toEqual([
      ['new.ts', true],
      ['a.ts', false],
      ['b.ts', false]
    ])
    expect(find(root, 'package-lock.json')).toBeUndefined()
    expect(root.size).toBe(files.reduce((s, f) => s + weight(f.size), 0) + weight(2048))
  })

  it('fills the rectangle exactly, keeping proportions', () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 600, h: 400 })
    const area = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(Math.round(area)).toBe(240_000)
    expect(Math.round(rects[0].w * rects[0].h)).toBe(Math.round((6 / 24) * 240_000))
    for (const r of rects) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(4)
  })

  it('lays out folders before their files, folding ones too small to open', () => {
    const root = buildTree(files)
    const big = layout(root, { x: 0, y: 0, w: 800, h: 500 })
    const order = big.map((p) => p.node.path)
    expect(order.indexOf('src')).toBeLessThan(order.indexOf('src/app.ts'))
    expect(big.find((p) => p.node.path === 'src')!.header).toBe(16)
    const tiny = layout(root, { x: 0, y: 0, w: 60, h: 30 })
    expect(tiny.some((p) => p.folded)).toBe(true)
    const byPath = new Map(tiny.map((p) => [p.node.path, p]))
    expect(placeOf(byPath, 'src/util/a.ts')?.node.path).toMatch(/^src/)
  })

  it('finds the folder holding a set of files', () => {
    expect(commonFolder(['src/util/a.ts', 'src/util/b.ts'])).toBe('src/util')
    expect(commonFolder(['src/util/a.ts', 'src/app.ts'])).toBe('src')
    expect(commonFolder(['README.md', 'src/app.ts'])).toBe('')
  })
})
