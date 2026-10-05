import { afterEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ sent: [] as [string, string][] }))
vi.mock('./pty', () => ({ exists: () => true, sendText: (id: string, text: string) => data.sent.push([id, text]) }))

import { deliver, flush, reset, setReadiness, waiting } from './inbox'

afterEach(() => {
  reset()
  data.sent = []
  vi.useRealTimers()
})

describe('inbox', () => {
  it('keeps messages until the agent waits for input, then types them as one', () => {
    vi.useFakeTimers()
    let ready = false
    setReadiness(() => ready)
    const done: string[] = []
    expect(deliver('T-1', 'first\nline', () => done.push('1'))).toBe('queued')
    expect(deliver('T-1', 'second', () => done.push('2'))).toBe('queued')
    expect(waiting('T-1')).toBe(2)
    flush('T-1')
    vi.advanceTimersByTime(1000)
    // Still busy: nothing typed into the middle of its turn.
    expect(data.sent).toEqual([])
    ready = true
    flush('T-1')
    vi.advanceTimersByTime(1000)
    // Lines stay lines (the pty sends them as one paste, or joins them where it can't).
    expect(data.sent).toEqual([['agent-T-1', 'first\nline\n\n---\n\nsecond']])
    expect(done).toEqual(['1', '2'])
    expect(waiting('T-1')).toBe(0)
  })
})
