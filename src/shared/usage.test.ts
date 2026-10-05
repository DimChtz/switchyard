import { describe, expect, it } from 'vitest'
import { costOf, formatCost, formatTokens, periodStart, priceOf, spendAlerts, sumUsage, usageCsv, type UsageEntry } from './usage'

const t = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })

describe('usage', () => {
  it('prices known models by id, the longest match first; others need a price', () => {
    expect(priceOf('claude-opus-4-5-20251101')?.input).toBe(5)
    expect(priceOf('claude-opus-4-20250514')?.input).toBe(15)
    expect(priceOf('claude-opus-4-6')).toBeNull()
    expect(priceOf('claude-opus-5-5', { 'claude-opus-5': { input: 5, output: 25 } })?.output).toBe(25)
  })

  it('costs input, output and the cache (writes 1.25×, reads 0.1× input by default)', () => {
    // 1M in, 1M out, 1M cache read, 1M cache write on Sonnet 4.5: 3 + 15 + 0.3 + 3.75
    expect(costOf(t(1e6, 1e6, 1e6, 1e6), 'claude-sonnet-4-5-20250929')).toBeCloseTo(22.05)
    expect(costOf(t(1e6, 0), 'mystery')).toBeNull()
  })

  it('sums by project, task, model or day, from a day on', () => {
    const e = (taskId: string, projectId: string, days: UsageEntry['days']): UsageEntry => ({ sessionId: `s-${taskId}`, taskId, taskKey: taskId, title: taskId, projectId, days, updatedAt: 0 })
    const entries = [
      e('A-1', 'web', { '2026-09-01': { 'claude-sonnet-4-5': t(1e6, 0) }, '2026-09-20': { 'claude-sonnet-4-5': t(0, 1e6) } }),
      e('B-1', 'api', { '2026-09-20': { 'claude-opus-4-5': t(1e6, 0), 'mystery-model': t(500, 500) } })
    ]
    const all = sumUsage(entries).get('')!
    expect([all.cost, all.unpriced, all.sessions]).toEqual([3 + 15 + 5, 1000, 2])
    const recent = sumUsage(entries, { since: '2026-09-10', by: 'project' })
    expect([recent.get('web')!.cost, recent.get('api')!.cost]).toEqual([15, 5])
    expect([...sumUsage(entries, { by: 'day' }).keys()].sort()).toEqual(['2026-09-01', '2026-09-20'])
    expect(sumUsage(entries, { by: 'model' }).get('mystery-model')!.unpriced).toBe(1000)
  })

  it('exports a row per session, day and model', () => {
    const csv = usageCsv(
      [{ sessionId: 's1', taskId: 'A-1', taskKey: 'A-1', title: 'Fix "login", now', projectId: 'web', days: { '2026-09-02': { 'claude-sonnet-4-5': t(1e6, 0) }, '2026-09-01': { mystery: t(10, 5) } }, updatedAt: 0 }],
      {},
      (id) => id.toUpperCase()
    )
    expect(csv.split('\n')).toEqual([
      'date,project,task,title,session,model,input,output,cache_read,cache_write,cost_usd',
      '2026-09-01,WEB,A-1,"Fix ""login"", now",s1,mystery,10,5,0,0,',
      '2026-09-02,WEB,A-1,"Fix ""login"", now",s1,claude-sonnet-4-5,1000000,0,0,0,3.0000',
      ''
    ])
  })

  it('formats', () => {
    expect([formatCost(0), formatCost(0.004), formatCost(3.456), formatCost(1234.5)]).toEqual(['$0', '<$0.01', '$3.46', '$1,235'])
    expect([formatTokens(950), formatTokens(12_345), formatTokens(1_234_567)]).toEqual(['950', '12k', '1.23M'])
  })
})

describe('spending alerts', () => {
  const e = (projectId: string, days: UsageEntry['days']): UsageEntry => ({ sessionId: `s-${projectId}`, taskId: projectId, taskKey: projectId, title: '', projectId, days, updatedAt: 0 })
  // Wednesday 30 September 2026, noon.
  const now = new Date(2026, 8, 30, 12).getTime()
  const entries = [
    e('web', { '2026-09-30': { 'claude-sonnet-4-5': t(1e6, 0) }, '2026-09-28': { 'claude-sonnet-4-5': t(0, 1e6) }, '2026-09-02': { 'claude-opus-4-5': t(4e6, 0) } }),
    e('api', { '2026-08-31': { 'claude-opus-4-5': t(10e6, 0) } })
  ]

  it('starts weeks on Monday, months on the 1st', () => {
    expect([periodStart('day', now), periodStart('week', now), periodStart('month', now)]).toEqual(['2026-09-30', '2026-09-28', '2026-09-01'])
    expect(periodStart('week', new Date(2026, 9, 4).getTime())).toBe('2026-09-28')
  })

  it('says which limits were reached, once per period', () => {
    // Today $3, this week $18, this month $38; api's $50 was last month.
    const a = spendAlerts(entries, { now, limits: { day: 3, week: 20, month: 30 }, budgets: { web: 35, api: 10 } })
    expect(a.map((x) => [x.key, x.cost])).toEqual([
      ['day:2026-09-30', 3],
      ['month:2026-09-01', 38],
      ['budget:web:2026-09-01', 38]
    ])
    expect(spendAlerts(entries, { now, limits: {} })).toEqual([])
  })
})
