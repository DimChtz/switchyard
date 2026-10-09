import { describe, expect, it } from 'vitest'
import { needsYou, statusLabel, waitingText } from './status'

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

describe('what needs you', () => {
  it('a waiting or failed agent - not a scratchpad agent idle at its prompt', () => {
    expect(needsYou({ st: 'waiting', askKind: 'input' })).toBe(true)
    expect(needsYou({ st: 'failed' })).toBe(true)
    expect(needsYou({ st: 'working' })).toBe(false)
    expect(needsYou({ st: 'waiting', askKind: 'input', scratch: true })).toBe(false)
    // Still: it asks for approval, asks a question, or failed.
    expect(needsYou({ st: 'waiting', askKind: 'permission', scratch: true })).toBe(true)
    expect(needsYou({ st: 'waiting', askKind: 'input', ask: 'Which file?', scratch: true })).toBe(true)
    expect(needsYou({ st: 'failed', scratch: true })).toBe(true)
  })
})
