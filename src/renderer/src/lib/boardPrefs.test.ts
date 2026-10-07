import { describe, expect, it } from 'vitest'
import { cardShow, columnName, dueForArchive, isStale, sortColumn, visibleColumns, wipLimit } from './boardPrefs'
import type { Task } from '@shared/types'

const DAY = 24 * 60 * 60 * 1000
const t = (id: string, over: Partial<Task> = {}): Task => ({ id, key: id, projectId: 'p', title: id, col: 'progress', agentKind: null, st: null, worktreeId: null, worktreePath: null, branch: null, ask: null, doneNote: null, firstMessage: null, createdAt: 0, startedAt: null, lastActivityAt: 0, ...over })

describe('board settings', () => {
  it('names and hides columns - In Progress always shows', () => {
    expect(columnName({ boardNames: { ready: 'Todo', done: '  ' } }, 'ready')).toBe('Todo')
    expect(columnName({ boardNames: { done: '  ' } }, 'done')).toBe('Done')
    expect(visibleColumns({ boardHidden: ['backlog', 'progress', 'review'] })).toEqual(['ready', 'progress', 'done'])
  })

  it('reads limits and what cards show, partial settings included', () => {
    expect(wipLimit({ wipLimits: { progress: 3 } }, 'progress')).toBe(3)
    expect(wipLimit({ wipLimits: { progress: 0 } }, 'progress')).toBe(0)
    expect(wipLimit({ wipLimits: {} }, 'review')).toBe(0)
    expect(cardShow({ cardShow: { cost: false } as never })).toMatchObject({ cost: false, branch: true })
  })

  it('sorts a column, pinned cards first', () => {
    const list = [t('a', { createdAt: 1, lastActivityAt: 9 }), t('b', { createdAt: 3, lastActivityAt: 1, st: 'waiting' }), t('c', { createdAt: 2, pinnedAt: 5, lastActivityAt: 2 }), t('d', { createdAt: 4, st: 'failed' })]
    expect(sortColumn(list, 'manual').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(sortColumn(list, 'newest').map((x) => x.id)).toEqual(['c', 'd', 'b', 'a'])
    expect(sortColumn(list, 'activity').map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(sortColumn(list, 'needs').map((x) => x.id)).toEqual(['c', 'd', 'b', 'a'])
  })

  it('finds stale cards and done ones due for the archive', () => {
    const now = 10 * DAY
    expect(isStale(t('a', { colAt: now - 3 * DAY }), 2, now)).toBe(true)
    expect(isStale(t('a', { colAt: now - DAY }), 2, now)).toBe(false)
    expect(isStale(t('a', { col: 'done', colAt: 0 }), 2, now)).toBe(false)
    expect(isStale(t('a', { colAt: 0 }), 0, now)).toBe(false)
    const done = [t('old', { col: 'done', colAt: now - 8 * DAY }), t('new', { col: 'done', colAt: now - DAY }), t('kept', { col: 'done', colAt: 0, archivedAt: 1 })]
    expect(dueForArchive(done, 7, now).map((x) => x.id)).toEqual(['old'])
    expect(dueForArchive(done, 0, now)).toEqual([])
  })
})
