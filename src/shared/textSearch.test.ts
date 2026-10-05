import { describe, expect, it } from 'vitest'
import { matchLines, pathFilter, replaceMatches, searchRegex } from './textSearch'

const rx = (query: string, o: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean } = {}): RegExp =>
  searchRegex({ query, regex: !!o.regex, caseSensitive: !!o.caseSensitive, wholeWord: !!o.wholeWord }).rx!

describe('searchRegex', () => {
  it('takes plain text literally, case-insensitive unless asked', () => {
    expect(rx('a.b').test('a.b')).toBe(true)
    expect(rx('a.b').test('axb')).toBe(false)
    expect(rx('Foo').test('foo')).toBe(true)
    expect(rx('Foo', { caseSensitive: true }).test('foo')).toBe(false)
  })

  it('whole word, and regular expressions', () => {
    expect(rx('use', { wholeWord: true }).test('reuse')).toBe(false)
    expect(rx('use', { wholeWord: true }).test('we use it')).toBe(true)
    expect(rx('fo+', { regex: true }).test('fooo')).toBe(true)
  })

  it('reports a broken regular expression, and nothing for an empty query', () => {
    expect(searchRegex({ query: '(', regex: true, caseSensitive: false, wholeWord: false }).error).toBe('Invalid regular expression')
    expect(searchRegex({ query: '', regex: false, caseSensitive: false, wholeWord: false })).toEqual({ rx: null, error: null })
  })
})

describe('pathFilter', () => {
  it('include and exclude, as globs or plain text', () => {
    const f = pathFilter({ include: 'src/**/*.ts, *.md', exclude: '**/*.test.ts, vendor' })
    expect(f('src/a.ts')).toBe(true)
    expect(f('src/lib/deep/b.ts')).toBe(true)
    expect(f('README.md')).toBe(true)
    expect(f('src/a.test.ts')).toBe(false)
    expect(f('src/vendor/x.ts')).toBe(false)
    expect(f('lib/a.ts')).toBe(false)
    expect(pathFilter({ include: '', exclude: '' })('anything')).toBe(true)
  })
})

describe('matchLines', () => {
  it('lists each matching line with every match in it', () => {
    const lines = matchLines('const a = 1\nno\r\na + a', rx('a'))
    expect(lines).toEqual([
      { line: 0, text: 'const a = 1', ranges: [[6, 1]] },
      { line: 2, text: 'a + a', ranges: [[0, 1], [4, 1]] }
    ])
  })

  it('skips empty matches instead of looping', () => {
    expect(matchLines('abc', rx('x*', { regex: true }))).toEqual([])
  })
})

describe('replaceMatches', () => {
  it('replaces literally, or with $1 for regular expressions', () => {
    expect(replaceMatches('cost $5, cost $6', rx('cost'), 'price $&', false)).toEqual({ text: 'price $& $5, price $& $6', count: 2 })
    expect(replaceMatches('foo(1) foo(2)', rx('foo\\((\\d)\\)', { regex: true }), 'bar[$1]', true)).toEqual({ text: 'bar[1] bar[2]', count: 2 })
  })
})
