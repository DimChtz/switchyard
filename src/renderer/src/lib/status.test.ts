import { describe, expect, it } from 'vitest'
import { statusLabel, waitingText } from './status'

describe('a waiting agent in words', () => {
  it('tells an approval, a question and a finished turn apart', () => {
    expect(statusLabel({ st: 'waiting', askKind: 'permission', ask: 'Run npm test?' })).toBe('needs approval')
    expect(statusLabel({ st: 'waiting', askKind: 'input', ask: 'Should I open the PR?' })).toBe('has a question')
    expect(statusLabel({ st: 'waiting', askKind: 'input', ask: null })).toBe('finished its turn')
    expect(waitingText('input', null)).toBe('finished its turn')
    expect(waitingText('permission', 'Allow?')).toBe('needs your approval')
  })

  it('keeps the plain labels', () => {
    expect(statusLabel('working')).toBe('working')
    expect(statusLabel({ st: 'paused' })).toBe('paused')
    expect(statusLabel(null)).toBe('')
  })
})
