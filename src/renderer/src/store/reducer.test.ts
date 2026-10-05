import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './reducer'
import type { AppState } from './types'
import type { Project, Task } from '@shared/types'

const project = { id: 'p', name: 'p', repo: 'p', repoPath: '/p', prefix: 'P' } as Project
const task = (n: number, over: Partial<Task> = {}): Task => ({ id: `P-${n}`, key: `P-${n}`, projectId: 'p', title: `t${n}`, col: 'backlog', agentKind: null, st: null, worktreeId: null, worktreePath: null, branch: null, ask: null, doneNote: null, firstMessage: null, createdAt: 0, startedAt: null, lastActivityAt: 0, ...over })

function start(tasks: Task[], keyHigh: Record<string, number> = {}): AppState {
  return reducer(initialState(), { type: 'HYDRATE', projects: [project], tasks, prefs: initialState().prefs, keyHigh })
}

function add(s: AppState, title: string): AppState {
  let next = reducer({ ...s, projectId: 'p' }, { type: 'BEGIN_ADD_TASK' })
  next = reducer(next, { type: 'SET_NEW_TASK_TITLE', title })
  return reducer(next, { type: 'COMMIT_ADD_TASK' })
}

describe('task keys', () => {
  it("never gives a deleted task's key out again", () => {
    let s = add(start([task(1), task(2)]), 'new')
    expect(s.tasks[0].key).toBe('P-3')
    s = reducer(s, { type: 'DELETE_TASK', taskId: 'P-3', toast: '' })
    s = add(s, 'again')
    expect(s.tasks[0].key).toBe('P-4')
  })

  it('remembers keys from before (the store says how high they went)', () => {
    expect(add(start([task(1)], { p: 9 }), 'x').tasks[0].key).toBe('P-10')
  })

  it('is pure: the same update twice gives the same key (React runs reducers twice in development)', () => {
    const s = { ...start([task(1)]), projectId: 'p', addingTask: true, newTaskTitle: 'x' }
    const a = reducer(s, { type: 'COMMIT_ADD_TASK' })
    const b = reducer(s, { type: 'COMMIT_ADD_TASK' })
    expect([a.tasks[0].key, b.tasks[0].key]).toEqual(['P-2', 'P-2'])
  })

  it('goes back and forward through the places visited, past ones that are gone', () => {
    let s = start([task(1, { worktreePath: '/w' }), task(2, { worktreePath: '/w2' })])
    s = reducer(s, { type: 'NAV', view: 'board', projectId: 'p' })
    s = reducer(s, { type: 'OPEN_TASK', taskId: 'P-1', tab: 'files' })
    expect(s.wsIntent).toEqual({ tab: 'files', n: 1 })
    s = reducer(s, { type: 'NAV', view: 'agents' })
    s = reducer(s, { type: 'SET_BOARD_FOCUS', id: 'P-1' }) // not a move
    s = reducer(s, { type: 'GO', dir: -1 })
    expect([s.view, s.taskId]).toEqual(['workspace', 'P-1'])
    // Going back doesn't ask the workspace for anything again.
    expect(s.wsIntent?.n).toBe(1)
    s = reducer(s, { type: 'GO', dir: -1 })
    expect([s.view, s.projectId]).toEqual(['board', 'p'])
    s = reducer(s, { type: 'GO', dir: 1 })
    s = reducer(s, { type: 'GO', dir: 1 })
    expect(s.view).toBe('agents')
    expect(s.nav.forward).toEqual([])
    // Going somewhere new drops the way forward; a deleted task's place is skipped.
    s = reducer(s, { type: 'GO', dir: -1 })
    s = reducer(s, { type: 'OPEN_TASK', taskId: 'P-2' })
    expect(s.nav.forward).toEqual([])
    s = reducer(s, { type: 'DELETE_TASK', taskId: 'P-1', toast: '' })
    s = reducer(s, { type: 'GO', dir: -1 })
    expect([s.view, s.projectId]).toEqual(['board', 'p'])
  })

  it('keeps pinned tasks on top, the latest pinned first', async () => {
    const { pinnedFirst } = await import('../lib/boardFilter')
    let s = start([task(1), task(2), task(3)])
    s = reducer(s, { type: 'PIN_TASK', taskId: 'P-3', pinned: true })
    expect(pinnedFirst(s.tasks).map((t) => t.id)).toEqual(['P-3', 'P-1', 'P-2'])
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'P-3' ? { ...t, pinnedAt: 1 } : t)) }
    s = reducer(s, { type: 'PIN_TASK', taskId: 'P-2', pinned: true })
    expect(pinnedFirst(s.tasks).map((t) => t.id)).toEqual(['P-2', 'P-3', 'P-1'])
    s = reducer(s, { type: 'PIN_TASK', taskId: 'P-2', pinned: false })
    expect(pinnedFirst(s.tasks).map((t) => t.id)).toEqual(['P-3', 'P-1', 'P-2'])
  })

  it('archives finished tasks instead of removing them, and brings them back', () => {
    let s = start([task(1, { col: 'done' }), task(2)])
    s = reducer(s, { type: 'CLEAR_DONE', projectId: 'p', count: 1 })
    expect(s.tasks.find((t) => t.id === 'P-1')?.archivedAt).toBeGreaterThan(0)
    s = reducer(s, { type: 'UNARCHIVE_TASK', taskId: 'P-1' })
    expect(s.tasks.find((t) => t.id === 'P-1')?.archivedAt).toBeNull()
  })
})
