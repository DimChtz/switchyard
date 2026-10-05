import { describe, expect, it } from 'vitest'
import { ago, joinNote, linksTo, parseTable, plainText, splitNote } from './noteText'

describe('parseTable', () => {
  it('reads a GFM table: header, alignments, rows padded to the header', () => {
    expect(parseTable(['| Name | Qty |', '|:-----|----:|', '| a \\| b | 1 |', '| c |'])).toEqual({
      head: ['Name', 'Qty'],
      align: ['left', 'right'],
      rows: [
        ['a | b', '1'],
        ['c', '']
      ]
    })
    expect(parseTable(['a | b', '--- | :-:'])!.align).toEqual([null, 'center'])
    expect(parseTable(['| a |', 'not a delimiter'])).toBeNull()
  })
})

describe('splitNote / joinNote', () => {
  it('takes a leading "# " heading as the title', () => {
    expect(splitNote('# Plan\n\n- [ ] one\n')).toEqual({ title: 'Plan', text: '- [ ] one\n' })
    expect(splitNote('\n# Plan  \nbody')).toEqual({ title: 'Plan', text: 'body' })
    expect(splitNote('# ')).toEqual({ title: '', text: '' })
  })

  it('leaves a note without one alone', () => {
    expect(splitNote('just text\n# later')).toEqual({ title: '', text: 'just text\n# later' })
    expect(splitNote('## Sub\ntext')).toEqual({ title: '', text: '## Sub\ntext' })
  })

  it('writes the title back as the first line, and round-trips', () => {
    expect(joinNote('Plan', 'body')).toBe('# Plan\n\nbody')
    expect(joinNote('  Plan ', '')).toBe('# Plan\n')
    expect(joinNote('', 'body')).toBe('body')
    const body = '# Deploy notes\n\n1. build\n2. ship\n'
    const s = splitNote(body)
    expect(joinNote(s.title, s.text)).toBe(body)
  })
})

describe('plainText', () => {
  it('drops Markdown marks for snippets', () => {
    expect(plainText('[[Plan|the plan]] and [[Plan#Risks]]')).toBe('the plan and Plan › Risks')
    expect(plainText('| A | B |\n|---|:-:|\n| 1 | [[N|two]] |')).toBe('A B 1 two')
    expect(linksTo('see [[plan#x|y]]', 'Plan')).toBe(true)
    expect(linksTo('see [[planning]]', 'Plan')).toBe(false)
    expect(plainText('- [ ] **ship** it, see [[Plan]] and [docs](https://x.y)\n```\ncode\n```')).toBe('ship it, see Plan and docs')
  })
})

describe('ago', () => {
  it('reads like the design', () => {
    const now = 10_000_000
    expect(ago(now - 5_000, now)).toBe('now')
    expect(ago(now - 5 * 60_000, now)).toBe('5m')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h')
  })
})
