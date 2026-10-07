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

describe('moving a card within its column', () => {
  const ids = (s: AppState): string[] => s.tasks.filter((t) => t.col === 'backlog').map((t) => t.id)
  it('puts it in front of the card it was dropped on, or at the end', () => {
    let s = start([task(1), task(2), task(3)])
    s = reducer(s, { type: 'MOVE_TASK', id: 'P-3', col: 'backlog', before: 'P-1' })
    expect(ids(s)).toEqual(['P-3', 'P-1', 'P-2'])
    s = reducer(s, { type: 'MOVE_TASK', id: 'P-3', col: 'backlog', before: null })
    expect(ids(s)).toEqual(['P-1', 'P-2', 'P-3'])
  })
  it('changes nothing else - and nothing at all without a place', () => {
    const s = start([task(1), task(2)])
    expect(reducer(s, { type: 'MOVE_TASK', id: 'P-2', col: 'backlog' })).toBe(s)
    const moved = reducer(s, { type: 'MOVE_TASK', id: 'P-2', col: 'backlog', before: 'P-1' })
    expect(moved.tasks.find((t) => t.id === 'P-2')).toBe(s.tasks.find((t) => t.id === 'P-2'))
  })
  it('lands where it was dropped in another column too', () => {
    let s = start([task(1), task(2, { col: 'ready' }), task(3, { col: 'ready' })])
    s = reducer(s, { type: 'MOVE_TASK', id: 'P-1', col: 'ready', before: 'P-3' })
    expect(s.tasks.filter((t) => t.col === 'ready').map((t) => t.id)).toEqual(['P-2', 'P-1', 'P-3'])
  })
})

describe('working in the project folder', () => {
  it('starts with no branch or worktree of its own - in the project checkout', () => {
    let s = start([task(1, { col: 'ready' })])
    s = reducer(s, { type: 'OPEN_START_MODAL', taskId: 'P-1' })
    s = reducer(s, { type: 'SET_START_OPTIONS', patch: { inPlace: true } })
    s = reducer(s, { type: 'LAUNCH_START' })
    s = reducer(s, { type: 'SET_START_WORKTREE_PATH', path: '/p' })
    s = reducer(s, { type: 'FINISH_START' })
    const t = s.tasks.find((x) => x.id === 'P-1')!
    expect([t.col, t.branch, t.worktreePath, t.inPlace]).toEqual(['progress', null, '/p', true])
    // Still a started task: its agent's news counts, and it doesn't ask to be started again.
    s = reducer(s, { type: 'AGENT_STATUS', update: { taskId: 'P-1', st: 'waiting', ask: 'Go on?', askKind: 'message' } as never })
    expect(s.tasks.find((x) => x.id === 'P-1')!.st).toBe('waiting')
  })

  it('opens the scratchpad, making it once - off the board, in the project folder', () => {
    let s = reducer(start([task(1)]), { type: 'OPEN_SCRATCH', projectId: 'p' })
    s = reducer(s, { type: 'OPEN_SCRATCH', projectId: 'p' })
    const pads = s.tasks.filter((t) => t.scratch)
    expect(pads.length).toBe(1)
    expect([s.view, s.taskId, pads[0].worktreePath, pads[0].inPlace, pads[0].branch]).toEqual(['workspace', 'scratch-p', '/p', true, null])
    // Its key doesn't use up a task number.
    expect(add(s, 'next').tasks[0].key).toBe('P-2')
  })
})

describe('board settings', () => {
  const withPrefs = (tasks: Task[], prefs: Partial<AppState['prefs']>): AppState => {
    const s = start(tasks)
    return { ...s, prefs: { ...s.prefs, ...prefs } }
  }

  it('refuses a move into a full column - or only says so', () => {
    const tasks = [task(1, { col: 'review', agentKind: 'claude', st: 'done', branch: 'b1' }), task(2, { col: 'progress', agentKind: 'claude', st: 'working', branch: 'b2' })]
    let s = reducer(withPrefs(tasks, { wipLimits: { progress: 1 }, wipBlock: true }), { type: 'MOVE_TASK', id: 'P-1', col: 'progress' })
    expect(s.tasks.find((t) => t.id === 'P-1')!.col).toBe('review')
    expect(s.toast?.text).toMatch(/In Progress is full/)
    s = reducer(withPrefs(tasks, { wipLimits: { progress: 1 }, wipBlock: false }), { type: 'MOVE_TASK', id: 'P-1', col: 'progress' })
    expect(s.tasks.find((t) => t.id === 'P-1')!.col).toBe('progress')
    expect(s.toast?.text).toMatch(/over its limit: 2 cards for 1/)
  })

  it('puts new tasks where Settings say - and notes when a card came into its column', () => {
    let s: AppState = { ...withPrefs([], { newTaskColumn: 'ready' }), projectId: 'p', addingTask: true, newTaskTitle: 'x' }
    s = reducer(s, { type: 'COMMIT_ADD_TASK' })
    expect(s.tasks[0].col).toBe('ready')
    expect(s.tasks[0].colAt).toBeGreaterThan(0)
    // Hidden, Backlog isn't where they go.
    s = { ...withPrefs([], { newTaskColumn: 'backlog', boardHidden: ['backlog'] }), projectId: 'p', addingTask: true, newTaskTitle: 'y' }
    expect(reducer(s, { type: 'COMMIT_ADD_TASK' }).tasks[0].col).toBe('ready')
  })
})
