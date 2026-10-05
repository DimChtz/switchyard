import { describe, expect, it } from 'vitest'
import { codexDailyUsage } from './codexUsage'

const L = (o: unknown): string => JSON.stringify(o)
const tc = (ts: string, input: number, cached: number, output: number): string =>
  L({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 10, total_tokens: input + output } } } })

describe('codexDailyUsage', () => {
  it('counts how much the running total grew, per day and model, cached input apart', () => {
    const text = [
      L({ timestamp: '2026-10-02T09:00:00Z', type: 'session_meta', payload: { id: 's', cwd: '/w' } }),
      L({ timestamp: '2026-10-02T09:00:01Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } }),
      tc('2026-10-02T09:01:00Z', 1000, 400, 200),
      // The same total again (an event repeated): nothing more.
      tc('2026-10-02T09:01:01Z', 1000, 400, 200),
      L({ timestamp: '2026-10-02T09:02:00Z', type: 'turn_context', payload: { model: 'gpt-5' } }),
      tc('2026-10-02T09:03:00Z', 3000, 1400, 500),
      L({ timestamp: '2026-10-02T09:04:00Z', type: 'event_msg', payload: { type: 'token_count', info: null } })
    ].join('\n')
    const days = codexDailyUsage(text)
    const day = Object.keys(days)[0]
    expect(days[day]['gpt-5-codex']).toEqual({ input: 600, output: 200, cacheRead: 400, cacheWrite: 0 })
    expect(days[day]['gpt-5']).toEqual({ input: 1000, output: 300, cacheRead: 1000, cacheWrite: 0 })
  })
})
