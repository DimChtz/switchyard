import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types'
import { dueForPark, summaryDue } from './autoPark'

const DAY = 24 * 60 * 60 * 1000
const now = 100 * DAY
const t = (id: string, over: Partial<Task> = {}): Task => ({ id, key: id, projectId: 'p', title: id, col: 'progress', agentKind: 'claude', st: 'paused', worktreeId: null, worktreePath: '/w', branch: 'b', ask: null, doneNote: null, firstMessage: null, createdAt: 0, startedAt: 0, lastActivityAt: now - 20 * DAY, ...over })

describe('dueForPark', () => {
  it('parks what nothing happened to for the days set - In Progress or in Review', () => {
    const tasks = [t('old'), t('review', { col: 'review' }), t('fresh', { lastActivityAt: now - 2 * DAY }), t('ready', { col: 'ready' }), t('done', { col: 'done' })]
    expect(dueForPark(tasks, () => 14, now).map((x) => x.id)).toEqual(['old', 'review'])
  })
  it('never a pinned one, or one whose agent works, waits in the queue or sleeps; nor with the setting off', () => {
    const tasks = [t('scratch', { scratch: true }), t('pinned', { pinnedAt: 1 }), t('working', { st: 'working' }), t('queued', { queued: { agentKind: 'claude', branch: 'b', message: '', at: 1 } }), t('asleep', { sleeping: { until: now + DAY } as Task['sleeping'] })]
    expect(dueForPark(tasks, () => 14, now)).toEqual([])
    expect(dueForPark([t('old')], () => 0, now)).toEqual([])
  })
  it("by each task's project", () => {
    expect(dueForPark([t('a', { projectId: 'x' }), t('b', { projectId: 'y' })], (p) => (p === 'x' ? 7 : 30), now).map((x) => x.id)).toEqual(['a'])
  })
})

describe('summaryDue', () => {
  it('once a week, with something parked', () => {
    expect(summaryDue(3, now - 8 * DAY, now)).toBe(true)
    expect(summaryDue(3, now - 2 * DAY, now)).toBe(false)
    expect(summaryDue(0, 0, now)).toBe(false)
  })
})
