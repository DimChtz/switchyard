import { describe, expect, it } from 'vitest'
import { recentFirst } from './commandHistory'

describe('recentFirst', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  it('puts the recent ones first, newest first, and keeps the rest in order', () => {
    expect(recentFirst(items, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('skips recent ones that are not there', () => {
    expect(recentFirst(items, ['zz', 'd']).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c'])
  })
})
