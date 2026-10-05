import { describe, expect, it } from 'vitest'
import { commentMessage, followUpMessage, nextRefs, reviewMessage, where } from './review'
import { REPLY_ASK } from '@shared/reviewReplies'
import type { ReviewComment } from '@shared/types'

const c = (o: Partial<ReviewComment>): ReviewComment => ({ id: 'x', taskId: 'T', path: 'src/a.ts', line: 0, text: 'fix', createdAt: 0, ...o })

describe('review message', () => {
  it('says where each comment is', () => {
    expect(where(c({ newLine: 12 }))).toBe('src/a.ts line 12')
    expect(where(c({ newLine: 12, toLine: 14 }))).toBe('src/a.ts lines 12-14')
    expect(where(c({ oldLine: 8 }))).toBe('src/a.ts (removed line 8)')
  })

  it('numbers the comments by file and line, on one line, with the overall note first', () => {
    const msg = reviewMessage(
      [c({ path: 'src/b.ts', newLine: 3, text: 'rename\nthis', code: '  const x = 1' }), c({ newLine: 40, text: 'add a test' }), c({ newLine: 2, toLine: 5, text: 'too long' })],
      'Mostly good.\nTwo things.'
    )
    expect(msg).toBe(
      `Code review - 3 comments. Overall: Mostly good. Two things. Address each one: [1] src/a.ts lines 2-5: too long [2] src/a.ts line 40: add a test [3] src/b.ts line 3 (\`const x = 1\`): rename this ${REPLY_ASK}`
    )
    expect(msg.includes('\n')).toBe(false)
  })

  it('uses the numbers the comments were given', () => {
    expect(reviewMessage([c({ newLine: 9, ref: 5 }), c({ newLine: 1, ref: 4 })], '')).toContain('[4] src/a.ts line 1: fix [5] src/a.ts line 9: fix')
    expect(commentMessage(c({ newLine: 2, ref: 7 }))).toBe(`Review comment [7] on src/a.ts line 2: fix ${REPLY_ASK}`)
    expect(followUpMessage(c({ newLine: 2, ref: 7 }), 'Why\nnot a map?')).toBe('About review comment [7] on src/a.ts line 2: Why not a map? Answer on a line starting with [7].')
  })

  it('numbers new comments after the task’s highest', () => {
    expect(nextRefs([c({ ref: 3 }), c({}), c({ ref: 1 })], 2)).toEqual([4, 5])
    expect(nextRefs([], 1)).toEqual([1])
  })

  it('a note alone, or nothing', () => {
    expect(reviewMessage([], 'Looks good - ship it.')).toBe('Code review: Looks good - ship it.')
    expect(reviewMessage([], '  ')).toBe('')
  })
})
