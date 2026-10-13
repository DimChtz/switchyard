import { describe, expect, it } from 'vitest'
import { stepIndex, withVisit } from './taskSwitcher'

describe('withVisit', () => {
  it('moves the task to the front, once', () => {
    expect(withVisit(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(withVisit(['a', 'b'], 'x')).toEqual(['x', 'a', 'b'])
  })
  it('keeps the 30 most recent', () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`)
    expect(withVisit(many, 'new')).toHaveLength(30)
    expect(withVisit(many, 'new').at(-1)).toBe('t28')
  })
})

describe('stepIndex', () => {
  it('opens on the task before the current one', () => {
    expect(stepIndex(false, 0, 1, 5, true)).toBe(1)
    // (Not on a task - the board, say: the most recent one.)
    expect(stepIndex(false, 0, 1, 5, false)).toBe(0)
    expect(stepIndex(false, 0, 1, 1, true)).toBe(0)
  })
  it('opens backwards on the oldest', () => {
    expect(stepIndex(false, 0, -1, 5, true)).toBe(4)
  })
  it('moves and wraps round once open', () => {
    expect(stepIndex(true, 3, 1, 5, true)).toBe(4)
    expect(stepIndex(true, 4, 1, 5, true)).toBe(0)
    expect(stepIndex(true, 0, -1, 5, true)).toBe(4)
  })
})
