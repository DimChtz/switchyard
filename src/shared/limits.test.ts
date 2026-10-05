import { describe, expect, it } from 'vitest'
import { findLimit, parseReset } from './limits'

// 1 Oct 2026, 10:00 UTC.
const now = Date.UTC(2026, 9, 1, 10, 0)

describe('usage limits', () => {
  it('finds the message in the last lines, not earlier talk about rate limits', () => {
    const screen = ['Editing api.ts', 'const RATE_LIMIT_MS = 100 // usage limit for the client', ...Array(15).fill('…'), 'Claude usage limit reached. Your limit will reset at 3pm (UTC).', '> '].join('\n')
    const hit = findLimit(screen, now)
    expect(hit?.text).toBe('Claude usage limit reached. Your limit will reset at 3pm (UTC).')
    expect(hit?.resetAt).toBe(Date.UTC(2026, 9, 1, 15, 0))
    expect(findLimit('all good\n> ', now)).toBeNull()
  })

  it('reads the reset time in each shape', () => {
    // Relative.
    expect(parseReset("You've hit your usage limit. Try again in 2 hours 13 minutes.", now)).toBe(now + (2 * 60 + 13) * 60_000)
    expect(parseReset('Quota exceeded. Please retry in 30s.', now)).toBe(now + 30_000)
    expect(parseReset('Rate limit reached, try again in 1h 5m', now)).toBe(now + 65 * 60_000)
    // An epoch after a bar (Claude Code's older form).
    expect(parseReset('Claude AI usage limit reached|1767268800', now)).toBe(1767268800 * 1000)
    // A clock time in a zone; already past today means tomorrow.
    expect(parseReset('5-hour limit reached ∙ resets 9am (UTC)', now)).toBe(Date.UTC(2026, 9, 2, 9, 0))
    expect(parseReset('limit reached · resets 6:30pm (Asia/Tokyo)', now)).toBe(Date.UTC(2026, 9, 1, 9, 30) + 86_400_000)
    expect(parseReset('Weekly limit reached · resets Oct 3, 4pm (UTC)', now)).toBe(Date.UTC(2026, 9, 3, 16, 0))
    // Said nothing about when.
    expect(parseReset('You have exhausted your daily quota.', now)).toBeNull()
    expect(parseReset('resets 3', now)).toBeNull()
  })
})
