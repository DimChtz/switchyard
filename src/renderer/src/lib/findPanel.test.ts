import { describe, expect, it } from 'vitest'
import { parseGoto } from './findPanel'

describe('parseGoto', () => {
  it('reads a line, and a line with a column', () => {
    expect(parseGoto('12', 1, 100)).toEqual({ line: 12, col: 1 })
    expect(parseGoto(' 12:5 ', 1, 100)).toEqual({ line: 12, col: 5 })
    expect(parseGoto('12,5', 1, 100)).toEqual({ line: 12, col: 5 })
  })
  it('moves relative to the cursor with + and -', () => {
    expect(parseGoto('+3', 10, 100)).toEqual({ line: 13, col: 1 })
    expect(parseGoto('-3', 10, 100)).toEqual({ line: 7, col: 1 })
  })
  it('keeps to the lines the file has', () => {
    expect(parseGoto('500', 1, 100)).toEqual({ line: 100, col: 1 })
    expect(parseGoto('0', 1, 100)).toEqual({ line: 1, col: 1 })
    expect(parseGoto('-50', 10, 100)).toEqual({ line: 1, col: 1 })
  })
  it('refuses anything else', () => {
    expect(parseGoto('', 1, 100)).toBeNull()
    expect(parseGoto('abc', 1, 100)).toBeNull()
    expect(parseGoto('1:2:3', 1, 100)).toBeNull()
  })
})
