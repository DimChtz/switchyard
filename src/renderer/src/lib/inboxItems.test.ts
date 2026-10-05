import { describe, expect, it } from 'vitest'
import { buildInbox } from './inboxItems'
import type { Notice, ReviewComment, Task, TeamMessage } from '@shared/types'

const task = (id: string, o: Partial<Task>): Task => ({ id, key: id, title: id, projectId: 'p', col: 'progress', agentKind: 'claude', st: null, lastActivityAt: 1, ...o }) as Task

describe('inbox', () => {
  it('collects what waits on you, most urgent first', () => {
    const tasks = [
      task('T-1', { st: 'waiting', askKind: 'input', activity: 'Done the form' }),
      task('T-2', { st: 'waiting', askKind: 'permission', ask: 'Run npm install?' }),
      task('T-3', { st: 'failed', ask: 'Exited with code 1' }),
      task('T-4', { st: 'waiting', askKind: 'input', sleeping: { until: 5, reason: 'usage limit reached', since: 2 } }),
      task('T-5', { st: 'working', lastTest: { status: 'failed', exitCode: 1, at: 3 } }),
      task('T-6', { col: 'done', st: 'failed' })
    ]
    const comments: ReviewComment[] = [
      { id: 'c1', taskId: 'T-1', path: 'a.ts', line: 0, text: 'why?', createdAt: 0, ref: 2, thread: [{ from: 'agent', text: 'Because.', at: 4 }] },
      { id: 'c2', taskId: 'T-1', path: 'a.ts', line: 0, text: 'ok', createdAt: 0, resolved: true, thread: [{ from: 'agent', text: 'x', at: 4 }] }
    ]
    const notices = [{ id: 'n1', kind: 'agent-question', taskId: 'T-5', taskKey: 'T-5', taskTitle: '', projectId: 'p', text: 'asks', detail: 'Which DB?', at: 6, read: false }] as Notice[]
    const team = [{ id: 'm1', at: 7, from: 'T-1', to: 'T-5', text: 'hi', state: 'held' }] as TeamMessage[]
    const conflicts = { at: 8, mergeCheck: true, pairs: [{ repoId: 'p', a: 'T-1', b: 'T-5', files: ['a.ts', 'b.ts'], conflicts: ['a.ts'] }, { repoId: 'p', a: 'T-3', b: null, files: ['c.ts'], conflicts: [] }] }
    const items = buildInbox({ tasks, comments, notices, team, conflicts })
    expect(items.map((i) => `${i.kind}:${i.taskId}`)).toEqual(['approval:T-2', 'question:T-5', 'failed:T-3', 'limit:T-4', 'conflict:T-1', 'tests:T-5', 'review:T-1', 'team:T-5', 'waiting:T-1'])
    // A sleeping agent is its limit, not "your turn"; the same thing keeps its id.
    expect(items.find((i) => i.kind === 'limit')?.detail).toBe('usage limit reached')
    expect(buildInbox({ tasks, comments, notices, team, conflicts }).map((i) => i.id)).toEqual(items.map((i) => i.id))
  })
})
