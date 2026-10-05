import { describe, expect, it } from 'vitest'
import { checksMessage, prSummary, reviewMessage, toPrDetails } from './pr'

const gh = {
  url: 'https://github.com/o/r/pull/7',
  number: 7,
  state: 'OPEN' as const,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'u1' },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'u2' },
    { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING', targetUrl: 'u3' },
    { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' }
  ],
  reviewDecision: 'CHANGES_REQUESTED',
  reviews: [
    { author: { login: 'ana' }, body: 'Please rename the helper.', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-02T10:00:00Z' },
    { author: { login: 'bo' }, body: '', state: 'COMMENTED', submittedAt: '2026-10-02T09:00:00Z' }
  ],
  comments: []
}
const lines = [{ id: 11, user: { login: 'ana' }, body: 'Off by one here', path: 'src/a.ts', line: 42, created_at: '2026-10-02T10:01:00Z', html_url: 'h' }]

describe('pull request details', () => {
  it('maps checks and comments', () => {
    const d = toPrDetails(gh, lines, 1)
    expect(d.checks.map((c) => [c.name, c.state])).toEqual([
      ['build', 'pass'],
      ['test', 'fail'],
      ['lint', 'pending'],
      ['ci/legacy', 'pending'],
      ['deploy', 'skipped']
    ])
    expect(d.comments.map((c) => [c.author, c.path, c.line])).toEqual([
      ['ana', null, null],
      ['ana', 'src/a.ts', 42]
    ])
    expect(prSummary(d)).toEqual({ text: '1 check failing · changes requested', tone: 'fail' })
  })

  it('says what to tell the agent', () => {
    const d = toPrDetails(gh, lines, 1)
    expect(checksMessage(d)).toContain('CI failed on pull request #7: test (u2)')
    const review = reviewMessage(d)!
    expect(review).toContain('(changes requested)')
    expect(review).toContain('- ana on src/a.ts:42: Off by one here')
    expect(reviewMessage(d, Date.parse('2026-10-02T10:00:30Z'))).not.toContain('rename the helper')
  })

  it('passing with no reviews', () => {
    const d = toPrDetails({ ...gh, statusCheckRollup: [gh.statusCheckRollup[0]], reviewDecision: null, reviews: [] }, [], 1)
    expect(prSummary(d)).toEqual({ text: 'checks passing', tone: 'pass' })
    expect(checksMessage(d)).toBeNull()
  })
})
