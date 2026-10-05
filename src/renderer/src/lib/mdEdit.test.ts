import { describe, expect, it } from 'vitest'
import { checklistItems, minimalChange, prefixLines, wrapWith } from './mdEdit'

describe('checklistItems', () => {
  it('finds - [ ] items, ticked or not, outside code blocks', () => {
    const text = ['## Done when', '- [ ] Login works', '* [x] Tests pass  ', '- not a check', '```', '- [ ] in code', '```', '  - [ ] nested'].join('\n')
    expect(checklistItems(text)).toEqual([
      { text: 'Login works', done: false },
      { text: 'Tests pass', done: true },
      { text: 'nested', done: false }
    ])
  })
})

describe('prefixLines', () => {
  it('turns a line into a checklist item, and back', () => {
    const [v, a] = prefixLines('- [ ] ')('Login works', 3, 3)
    expect(v).toBe('- [ ] Login works')
    expect(a).toBe(9)
    expect(prefixLines('- [ ] ')(v, a, a)[0]).toBe('Login works')
  })
  it('swaps a bullet for a heading', () => {
    expect(prefixLines('## ')('- Title', 0, 0)[0]).toBe('## Title')
  })
})

describe('wrapWith', () => {
  it('wraps the selection, or a selected placeholder', () => {
    expect(wrapWith('**', '**', 'bold')('a b c', 2, 3)).toEqual(['a **b** c', 4, 5])
    expect(wrapWith('**', '**', 'bold')('', 0, 0)).toEqual(['**bold**', 2, 6])
  })
})

describe('minimalChange', () => {
  it('replaces only what differs', () => {
    expect(minimalChange('hello world', 'hello brave world')).toEqual([6, 6, 'brave '])
    expect(minimalChange('abc', 'abc')).toEqual([3, 3, ''])
  })
})
