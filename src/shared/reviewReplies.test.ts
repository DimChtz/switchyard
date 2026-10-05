import { describe, expect, it } from 'vitest'
import { parseReplies } from './reviewReplies'

describe('review replies', () => {
  it('takes the text after each number, up to the next', () => {
    const r = parseReplies('Done with the review.\n\n[1] Renamed it to `userId`.\n[2] Added a test\nfor the empty case.\n\nAnything else?', [1, 2])
    expect([...r]).toEqual([
      [1, 'Renamed it to `userId`.'],
      [2, 'Added a test\nfor the empty case.']
    ])
  })

  it('reads bold, bulleted and punctuated markers', () => {
    const r = parseReplies('- **[3]**: kept it - it is used by the importer\n> [4] - fixed\n[5]. split into two', [3, 4, 5])
    expect(r.get(3)).toBe('kept it - it is used by the importer')
    expect(r.get(4)).toBe('fixed')
    expect(r.get(5)).toBe('split into two')
  })

  it('leaves numbers it was not asked about, and ones in the middle of a line', () => {
    const r = parseReplies('See the docs [1] for this.\n[7] unrelated footnote\n[2] ok', [1, 2])
    expect([...r]).toEqual([[2, 'ok']])
  })

  it('the first answer to a number wins; empty ones are skipped', () => {
    const r = parseReplies('[1]\n[2] yes\n[2] again', [1, 2])
    expect([...r]).toEqual([[2, 'yes']])
  })
})
