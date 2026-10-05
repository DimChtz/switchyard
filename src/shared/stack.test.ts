import { describe, expect, it } from 'vitest'
import { baseFor, childrenOf, liveParent, parentFinished, stacked, waitsFor, wouldLoop } from './stack'
import type { Task } from './types'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  key: id,
  projectId: 'p',
  title: id,
  col: 'backlog',
  agentKind: null,
  st: null,
  worktreeId: null,
  worktreePath: null,
  branch: null,
  ask: null,
  doneNote: null,
  firstMessage: null,
  createdAt: 0,
  startedAt: null,
  lastActivityAt: 0,
  ...over
})
const project = { id: 'p', defaultBranch: 'main' }

describe('tasks building on each other', () => {
  it('branches from the parent while it is unmerged, then from the default branch', () => {
    const a = task('A', { col: 'progress', branch: 'feat-a' })
    const b = task('B', { buildsOn: 'A' })
    expect(baseFor(b, project, [a, b])).toBe('feat-a')
    expect(baseFor(b, project, [{ ...a, col: 'done' }, b])).toBe('main')
    expect(baseFor(task('C'), project, [a])).toBe('main')
  })

  it('only counts a parent in the same repository', () => {
    const a = task('A', { projectId: 'q', col: 'progress', branch: 'feat-a' })
    const b = task('B', { buildsOn: 'A' })
    expect(liveParent(b, 'p', [a, b])).toBeUndefined()
    expect(baseFor(b, project, [a, b])).toBe('main')
    expect(baseFor(b, project, [{ ...a, repos: ['p'] }, b])).toBe('feat-a')
  })

  it('waits for a parent without a branch, and queues until it is in Review', () => {
    const a = task('A')
    const b = task('B', { buildsOn: 'A' })
    expect(waitsFor(b, [a, b])?.id).toBe('A')
    expect(parentFinished(b, [a, b])).toBe(false)
    const started = { ...a, col: 'progress' as const, branch: 'feat-a' }
    expect(waitsFor(b, [started, b])).toBeUndefined()
    expect(parentFinished(b, [started, b])).toBe(false)
    expect(parentFinished(b, [{ ...started, col: 'review' }, b])).toBe(true)
  })

  it('finds loops and stacks', () => {
    const a = task('A')
    const b = task('B', { buildsOn: 'A' })
    const c = task('C', { buildsOn: 'B' })
    const all = [a, b, c]
    expect(wouldLoop('A', 'C', all)).toBe(true)
    expect(wouldLoop('C', 'A', all)).toBe(false)
    expect(stacked(a, c, all)).toBe(true)
    expect(stacked(b, task('D'), [...all, task('D')])).toBe(false)
    expect(childrenOf(a, all).map((t) => t.id)).toEqual(['B'])
  })
})
