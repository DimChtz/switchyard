import { describe, expect, it } from 'vitest'
import { conflictCount, parseConflicts, resolveConflict } from './mergeConflicts'

const file = ['a', '<<<<<<< HEAD', 'mine', '=======', 'theirs 1', 'theirs 2', '>>>>>>> develop', 'b', '<<<<<<< HEAD', 'x', '||||||| base', 'o', '=======', 'y', '>>>>>>> develop', 'c', ''].join('\n')

describe('conflicts', () => {
  it('reads the conflicts and their sides', () => {
    const parts = parseConflicts(file)
    expect(parts.map((p) => p.t)).toEqual(['text', 'conflict', 'text', 'conflict', 'text'])
    const c = parts[1]
    expect(c.t === 'conflict' && [c.ours, c.theirs, c.oursLabel, c.theirsLabel]).toEqual([['mine\n'], ['theirs 1\n', 'theirs 2\n'], 'HEAD', 'develop'])
    const d = parts[3]
    expect(d.t === 'conflict' && [d.ours, d.base, d.theirs]).toEqual([['x\n'], ['o\n'], ['y\n']])
    expect(conflictCount(file)).toBe(2)
  })

  it('settles one conflict at a time and leaves the rest as git wrote them', () => {
    const once = resolveConflict(file, 0, 'theirs')
    expect(once.startsWith('a\ntheirs 1\ntheirs 2\nb\n<<<<<<< HEAD\nx\n||||||| base\n')).toBe(true)
    expect(conflictCount(once)).toBe(1)
    expect(resolveConflict(once, 0, 'both')).toBe('a\ntheirs 1\ntheirs 2\nb\nx\ny\nc\n')
    expect(resolveConflict(file, 1, 'both-theirs-first').includes('b\ny\nx\nc\n')).toBe(true)
  })

  it('keeps Windows line ends, and a last line without one', () => {
    const crlf = 'a\r\n<<<<<<< HEAD\r\none\r\n=======\r\ntwo\r\n>>>>>>> x\r\n'
    expect(resolveConflict(crlf, 0, 'both')).toBe('a\r\none\r\ntwo\r\n')
    expect(resolveConflict('<<<<<<< HEAD\nm\n=======\nt\n>>>>>>> x', 0, 'ours')).toBe('m\n')
    // Markers that never close are just text.
    expect(conflictCount('<<<<<<< HEAD\nm\n')).toBe(0)
  })
})
