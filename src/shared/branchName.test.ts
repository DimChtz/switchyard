import { describe, expect, it } from 'vitest'
import { branchProblem } from './branchName'

describe('branchProblem', () => {
  it('takes ordinary names', () => {
    for (const ok of ['feature/login-page-bug', 'fix-123', 'user/dimitris/x', 'release-1.2']) expect(branchProblem(ok)).toBe(null)
  })

  it("says what git won't allow", () => {
    expect(branchProblem('')).toMatch(/needs a name/)
    expect(branchProblem('-x')).toMatch(/start with “-”/)
    expect(branchProblem('a..b')).toMatch(/“\.\.”/)
    expect(branchProblem('a~1')).toMatch(/“~”/)
    expect(branchProblem('wip:x')).toMatch(/“:”/)
    expect(branchProblem('a@{b')).toMatch(/“@\{”/)
    expect(branchProblem('feature/')).toMatch(/Slashes/)
    expect(branchProblem('a//b')).toMatch(/Slashes/)
    expect(branchProblem('x.')).toMatch(/end with “\.”/)
    expect(branchProblem('feature/.hidden')).toMatch(/start with “\.”/)
    expect(branchProblem('foo.lock')).toMatch(/\.lock/)
  })

  it('finds clashes with branches that are there - but an exact one is reused', () => {
    expect(branchProblem('foo/bar', ['foo'])).toMatch(/can’t have both “foo” and “foo\/bar”/)
    expect(branchProblem('foo', ['foo/bar'])).toMatch(/can’t have both “foo” and “foo\/bar”/)
    expect(branchProblem('Fix-Login', ['fix-login'])).toMatch(/only in case/)
    expect(branchProblem('foo', ['foo'])).toBe(null)
    expect(branchProblem('foobar', ['foo'])).toBe(null)
  })
})
