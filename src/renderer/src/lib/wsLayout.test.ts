import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BARS,
  closeTab,
  closeWhere,
  defaultLayout,
  dropTab,
  evenOut,
  groupsOf,
  moveView,
  openBeside,
  openTab,
  place,
  readBars,
  readLayout,
  renameTabs,
  resize,
  splitGroup,
  toggleMax,
  toggleView,
  type Layout
} from './wsLayout'

const tabsOf = (L: Layout): string[][] => groupsOf(L.root).map((g) => g.tabs)

describe('editor groups', () => {
  it('opens a tab in the focused group, or shows it where it is', () => {
    let L = defaultLayout(['agent', 'shell:a'])
    L = openTab(L, 'file:src/a.ts')
    expect(tabsOf(L)).toEqual([['agent', 'shell:a', 'file:src/a.ts']])
    expect(groupsOf(L.root)[0].a).toBe('file:src/a.ts')
    L = openTab(L, 'agent')
    expect(tabsOf(L)).toEqual([['agent', 'shell:a', 'file:src/a.ts']])
    expect(groupsOf(L.root)[0].a).toBe('agent')
  })

  it('splits a file as a copy, a terminal by moving it', () => {
    let L = openTab(defaultLayout(['agent', 'shell:a']), 'file:x.ts')
    L = splitGroup(L, 'g1', 'right')!
    expect(tabsOf(L)).toEqual([['agent', 'shell:a', 'file:x.ts'], ['file:x.ts']])
    expect(L.focus).toBe('g2')
    L = openTab(L, 'shell:a', 'g2')
    expect(tabsOf(L)).toEqual([['agent', 'file:x.ts'], ['file:x.ts', 'shell:a']])
    // One terminal alone: nothing to split off.
    expect(splitGroup(defaultLayout(['agent']), 'g1', 'right')).toBeNull()
  })

  it('splits the same way twice into one row of three', () => {
    let L = openTab(defaultLayout(['agent']), 'file:x.ts')
    L = splitGroup(L, 'g1', 'right')!
    L = splitGroup(L, 'g2', 'right')!
    expect(L.root).toMatchObject({ d: 'row', z: [0.5, 0.25, 0.25] })
    L = splitGroup(L, 'g3', 'bottom')!
    expect(place(L).boxes.map((b) => [b.group.g, b.x, b.y, b.w, b.h])).toEqual([
      ['g1', 0, 0, 0.5, 1],
      ['g2', 0.5, 0, 0.25, 1],
      ['g3', 0.75, 0, 0.25, 0.5],
      ['g4', 0.75, 0.5, 0.25, 0.5]
    ])
  })

  it('closing a group’s last tab removes the group and merges its split away', () => {
    let L = openBeside(defaultLayout(['agent']), 'g1', 'bottom', 'shell:a')
    expect(tabsOf(L)).toEqual([['agent'], ['shell:a']])
    L = closeTab(L, 'shell:a')
    expect(L.root).toMatchObject({ g: 'g1', tabs: ['agent'] })
    expect(L.focus).toBe('g1')
    // The last tab of the last group: an empty group stays.
    L = closeTab(L, 'agent')
    expect(L.root).toMatchObject({ g: 'g1', tabs: [], a: null })
  })

  it('drops a tab into a group, before another, or beside it', () => {
    let L = openTab(openTab(defaultLayout(['agent']), 'file:a.ts'), 'file:b.ts')
    L = dropTab(L, 'file:b.ts', 'g1', 'g1', 'bar', 'agent')
    expect(tabsOf(L)).toEqual([['file:b.ts', 'agent', 'file:a.ts']])
    L = dropTab(L, 'agent', 'g1', 'g1', 'left')
    expect(tabsOf(L)).toEqual([['agent'], ['file:b.ts', 'file:a.ts']])
    expect(L.root).toMatchObject({ d: 'row' })
    // Its own group's only tab beside itself: no change.
    expect(dropTab(L, 'agent', 'g3', 'g3', 'right')).toEqual(L)
    // Back into the other group: the emptied one goes.
    L = dropTab(L, 'agent', 'g3', 'g1', 'center')
    expect(tabsOf(L)).toEqual([['file:b.ts', 'file:a.ts', 'agent']])
  })

  it('a file dragged from a side bar is a copy; a terminal moves', () => {
    let L = openBeside(openTab(defaultLayout(['agent']), 'file:a.ts'), 'g1', 'right', 'shell:s')
    L = dropTab(L, 'file:a.ts', null, 'g2', 'center')
    expect(tabsOf(L)).toEqual([['agent', 'file:a.ts'], ['shell:s', 'file:a.ts']])
    L = dropTab(L, 'agent', null, 'g2', 'top')
    expect(tabsOf(L)).toEqual([['file:a.ts'], ['agent'], ['shell:s', 'file:a.ts']])
  })

  it('maximizes, resizes and evens out', () => {
    let L = openBeside(defaultLayout(['agent']), 'g1', 'right', 'shell:s')
    L = toggleMax(L, 'g2')
    expect(place(L).boxes.map((b) => b.group.g)).toEqual(['g2'])
    L = toggleMax(L, 'g2')
    L = resize(L, [], 0, 0.7)
    expect((L.root as { z: number[] }).z).toEqual([0.7, 0.30000000000000004])
    L = evenOut(L, [], 0)
    expect((L.root as { z: number[] }).z).toEqual([0.5, 0.5])
    expect(place(L).splitters).toHaveLength(1)
  })

  it('closes tabs that are gone, and follows renamed files', () => {
    let L = openTab(openTab(defaultLayout(['agent', 'shell:old']), 'file:src/a.ts'), 'diff:src/a.ts')
    L = closeWhere(L, (id) => id === 'shell:old')
    L = renameTabs(L, (id) => id.replace(':src/', ':lib/'))
    expect(tabsOf(L)).toEqual([['agent', 'file:lib/a.ts', 'diff:lib/a.ts']])
    expect(groupsOf(L.root)[0].a).toBe('diff:lib/a.ts')
  })

  it('reads back only what is a layout', () => {
    const L = openBeside(defaultLayout(['agent']), 'g1', 'right', 'shell:s')
    expect(readLayout(JSON.parse(JSON.stringify(L)))).toEqual(L)
    expect(readLayout({ root: { d: 'row', c: [], z: [1] }, n: 1 })).toBeNull()
    expect(readLayout('nope')).toBeNull()
  })
})

describe('side bars', () => {
  it('toggles a view and moves one to the other side', () => {
    let b = toggleView(DEFAULT_BARS, 'explorer')
    expect(b.open).toEqual({ L: 'explorer', R: null })
    b = toggleView(b, 'explorer')
    expect(b.open.L).toBeNull()
    b = toggleView(b, 'changes')
    b = moveView(b, 'changes', 'R', 'activity')
    expect(b.views.filter((v) => v[1] === 'R').map((v) => v[0])).toEqual(['changes', 'activity'])
    // It was showing: it shows on its new side, and the old side closes.
    expect(b.open).toEqual({ L: null, R: 'changes' })
  })

  it('reads stored side bars, filling in what is missing', () => {
    const b = readBars({ views: [['activity', 'L'], ['bogus', 'R'], ['activity', 'R']], open: { L: 'activity', R: 'task' }, width: { L: 9999 } })
    expect(b.views.map((v) => v[0])).toEqual(['activity', 'task', 'explorer', 'search', 'changes', 'sessions'])
    expect(b.open).toEqual({ L: 'activity', R: null })
    expect(b.width).toEqual({ L: 640, R: 240 })
    expect(readBars(null)).toBe(DEFAULT_BARS)
  })
})
