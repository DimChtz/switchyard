import { describe, expect, it } from 'vitest'
import { inCheckout, pathMatches } from './termLinks'

const paths = (text: string): [string, number | null, number | null][] => pathMatches(text).map((m) => [m.path, m.line, m.col])

describe('pathMatches', () => {
  it('finds paths with a line and column', () => {
    expect(paths('error at src/app.ts:42:7 - boom')).toEqual([['src/app.ts', 42, 7]])
    expect(paths('src\\app.ts(42,7): error TS2304')).toEqual([['src\\app.ts', 42, 7]])
    expect(paths('./lib/x.test.js:3')).toEqual([['./lib/x.test.js', 3, null]])
  })
  it('finds bare file names and absolute paths', () => {
    expect(paths('modified:   package.json')).toEqual([['package.json', null, null]])
    expect(paths('at C:\\work\\repo\\src\\a.tsx:1:2')).toEqual([['C:\\work\\repo\\src\\a.tsx', 1, 2]])
    expect(paths('/home/me/repo/a.py')).toEqual([['/home/me/repo/a.py', null, null]])
  })
  it("reads Python's tracebacks", () => {
    const [m] = pathMatches('  File "src/app.py", line 12, in main')
    expect([m.path, m.line]).toEqual(['src/app.py', 12])
  })
  it('ignores URLs, versions and sentence ends', () => {
    expect(paths('see https://example.com/a/b.html')).toEqual([])
    expect(paths('version 1.2.3 ok')).toEqual([])
    expect(paths('look in src/a.ts.')).toEqual([['src/a.ts', null, null]])
    expect(paths('mail me@x.com')).toEqual([])
  })
  it('gives where each match is', () => {
    const [m] = pathMatches('xx src/a.ts:3 yy')
    expect([m.start, m.end]).toEqual([3, 13])
  })
})

describe('inCheckout', () => {
  it('resolves relative paths from the terminal folder', () => {
    expect(inCheckout('a.ts', '/repo/src', '/repo', null, false)).toBe('src/a.ts')
    expect(inCheckout('../lib/b.ts', '/repo/src', '/repo', null, false)).toBe('lib/b.ts')
  })
  it('takes absolute paths inside the checkout only', () => {
    expect(inCheckout('/repo/x/y.ts', '/repo', '/repo', null, false)).toBe('x/y.ts')
    expect(inCheckout('/other/y.ts', '/repo', '/repo', null, false)).toBeNull()
    expect(inCheckout('../outside.ts', '/repo', '/repo', null, false)).toBeNull()
  })
  it('compares Windows paths without case, either slash', () => {
    expect(inCheckout('C:\\Work\\Repo\\src\\a.ts', 'C:\\Work\\Repo', 'c:\\work\\repo', null, true)).toBe('src/a.ts')
    expect(inCheckout('src\\a.ts', 'C:\\Work\\Repo', 'C:\\Work\\Repo', null, true)).toBe('src/a.ts')
  })
})
