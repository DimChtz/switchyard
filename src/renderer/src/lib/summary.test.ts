import { describe, expect, it } from 'vitest'
import { buildSummary, gist, periodRange, summaryMarkdown } from './summary'
import type { ActivityEvent, Task } from '@shared/types'
import type { UsageEntry } from '@shared/usage'

const NOW = new Date(2026, 9, 1, 10, 0).getTime()
const H = 60 * 60 * 1000

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  key: id,
  projectId: 'p',
  title: `Task ${id}`,
  col: 'progress',
  agentKind: 'claude',
  st: 'working',
  worktreeId: null,
  worktreePath: '/wt',
  branch: `b-${id}`,
  ask: null,
  doneNote: null,
  firstMessage: null,
  createdAt: 0,
  startedAt: 0,
  lastActivityAt: NOW - H,
  ...over
})
const ev = (taskId: string, kind: ActivityEvent['kind'], at: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({ at, kind, taskId, taskKey: taskId, title: `Task ${taskId}`, projectId: 'p', agentKind: 'claude', ...over })

describe('periodRange', () => {
  it('covers today, yesterday, a week and since the last look', () => {
    const midnight = new Date(2026, 9, 1).getTime()
    expect(periodRange('today', NOW, 0)).toMatchObject({ from: midnight, to: NOW })
    expect(periodRange('yesterday', NOW, 0)).toMatchObject({ from: new Date(2026, 8, 30).getTime(), to: midnight })
    expect(periodRange('week', NOW, 0).from).toBe(new Date(2026, 8, 25).getTime())
    expect(periodRange('since', NOW, NOW - 3 * H)).toMatchObject({ from: NOW - 3 * H, to: NOW })
    expect(periodRange('since', NOW, 0).label).toBe('Today')
  })
})

describe('gist', () => {
  it('keeps the first paragraph, cut at a sentence', () => {
    expect(gist('Done. I **added** mul().\n\n## Details\n- a')).toBe('Done. I added mul().')
    const long = `${'word '.repeat(30)}end. ${'more '.repeat(40)}`
    expect(gist(long, 160)!.endsWith('end.')).toBe(true)
  })
})

describe('buildSummary', () => {
  const tasks = [
    task('A', { col: 'review', st: 'done' }),
    task('B', { st: 'waiting', askKind: 'permission', ask: 'Run npm install?' }),
    task('C', { col: 'done', st: null, agentKind: null, worktreePath: null, doneNote: 'Merged into main' }),
    task('D', { col: 'ready', st: null, agentKind: null, worktreePath: null, branch: null, queued: { agentKind: 'codex', branch: 'b', message: 'm', at: 1 }, buildsOn: 'B' }),
    task('E', { col: 'ready', st: null, agentKind: null, worktreePath: null, branch: null })
  ]
  const events = [
    ev('A', 'turn', NOW - 5 * H, { files: ['a.ts', 'b.ts'], added: 10, deleted: 2, said: 'First pass.' }),
    ev('A', 'turn', NOW - 4 * H, { files: ['a.ts'], added: 5, deleted: 1, said: 'Added the tests.' }),
    ev('A', 'review', NOW - 4 * H),
    ev('C', 'turn', NOW - 3 * H, { files: ['c.ts'], added: 1, deleted: 0 }),
    ev('C', 'finished', NOW - 2 * H, { note: 'Merged into main' }),
    ev('B', 'turn', NOW - 30 * H, { files: ['old.ts'] }), // before the period
    ev('X', 'turn', NOW - 2 * H, { projectId: 'q' })
  ]
  const usage: UsageEntry[] = [{ sessionId: 's', taskId: 'A', taskKey: 'A', title: '', projectId: 'p', days: { '2026-10-01': { 'claude-sonnet-4-5': { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } } }, updatedAt: NOW }]
  const s = buildSummary({ tasks, events, usage, from: NOW - 10 * H, to: NOW, now: NOW, projectId: 'p' })

  it('counts the work in the period', () => {
    expect(s.totals).toMatchObject({ turns: 3, tasks: 2, files: 3, added: 16, deleted: 3, finished: 1, review: 1 })
    expect(s.totals.cost).toBeGreaterThan(0)
    const a = s.worked.find((r) => r.taskId === 'A')!
    expect(a).toMatchObject({ turns: 2, files: 2, toReview: true, said: 'Added the tests.' })
    expect(s.finished.map((r) => r.taskId)).toEqual(['C'])
    expect(s.worked.some((r) => r.taskId === 'X' || r.taskId === 'B')).toBe(false)
  })

  it('says what needs you, what is in Review and what is next', () => {
    expect(s.attention.map((a) => [a.task.id, a.tone])).toEqual([['B', 'amber']])
    expect(s.attention[0].why).toContain('Run npm install?')
    expect(s.review.map((t) => t.id)).toEqual(['A'])
    expect(s.next.map((n) => n.task.id)).toEqual(['D', 'E'])
    expect(s.next[0].why).toBe('queued for Codex - after B is in Review')
  })

  it('reads as Markdown', () => {
    const md = summaryMarkdown(s, 'Today', () => 'demo', NOW)
    expect(md).toContain('# Switchyard summary · Today')
    expect(md).toContain('1 task finished · 3 agent turns on 2 tasks · 3 files changed (+16 −3)')
    expect(md).toContain('## Finished\n\n- **C** Task C - Merged into main')
    expect(md).toContain('  > Added the tests.')
    expect(md).toContain('## Needs you')
    expect(md).toContain('## Next up')
  })
})
