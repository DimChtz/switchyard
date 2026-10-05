import { describe, expect, it } from 'vitest'
import { closingQuestion } from './closingQuestion'

describe('closingQuestion', () => {
  it('is null when the turn just finished', () => {
    expect(closingQuestion('Done. I added the toggle and the tests pass.')).toBeNull()
    expect(closingQuestion('Is it fine?\n\nAll set - the PR is ready.')).toBeNull()
    expect(closingQuestion('')).toBeNull()
    expect(closingQuestion(null)).toBeNull()
  })

  it('is the question the turn ended on', () => {
    expect(closingQuestion('I found two ways to do it. Should I use the feature flag or a setting?')).toBe('Should I use the feature flag or a setting?')
    expect(closingQuestion('Summary of the changes:\n- a\n- b\n\n**Want me to open the pull request?**')).toBe('Want me to open the pull request?')
  })
})
