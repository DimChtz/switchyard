import { describe, expect, it, vi } from 'vitest'
import type { ReviewComment, Task } from '@shared/types'

const data = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
  changed: [] as unknown[]
}))
vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} } }))
vi.mock('./store', () => ({
  getTasks: () => [{ id: 'T-1', key: 'T-1', title: 'Fix login', desc: 'The redirect loops', projectId: 'app', col: 'progress', branch: 't-1', worktreePath: '/wt/T-1', taskDir: null }] as unknown as Task[],
  getProjects: () => [{ id: 'app', name: 'app', repoPath: '/repo/app', defaultBranch: 'main', testCmd: 'npm test' }],
  getComments: () => data.comments,
  updateComments: (patches: { id: string; patch: Partial<ReviewComment> }[]) => {
    data.comments = data.comments.map((c) => ({ ...c, ...(patches.find((p) => p.id === c.id)?.patch ?? {}) }))
  }
}))
vi.mock('./pty', () => ({ list: () => [], exists: () => false, getBuffer: () => '', spawn: () => {} }))
vi.mock('./ports', () => ({ freePort: async () => 4000 }))
vi.mock('./review', () => ({ commentsChanged: (c: unknown) => data.changed.push(c) }))
vi.mock('./conflicts', () => ({
  checkoutPath: () => '/wt/T-1',
  scan: async () => ({ at: 1, mergeCheck: true, pairs: [{ repoId: 'app', a: 'T-2', b: 'T-1', files: ['src/a.ts'], conflicts: ['src/a.ts'] }] })
}))

import { handleMcp } from './agentTools'

const call = (name: string, args: Record<string, unknown> = {}): Promise<{ result: { content: { text: string }[]; isError?: boolean } }> =>
  handleMcp('T-1', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }) as never

describe('agent tools (MCP)', () => {
  it('speaks the protocol: initialize, tools, notifications, batches, unknown methods', async () => {
    const init = (await handleMcp('T-1', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect([init.result.protocolVersion, init.result.serverInfo.name]).toEqual(['2025-03-26', 'switchyard'])
    expect(await handleMcp('T-1', { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    const list = (await handleMcp('T-1', { jsonrpc: '2.0', id: 2, method: 'tools/list' })) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['preview_screenshot', 'run_tests', 'check_conflicts', 'review_comments', 'reply_to_review_comment', 'create_task', 'ask_user']))
    const batch = (await handleMcp('T-1', [{ jsonrpc: '2.0', id: 3, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }])) as unknown[]
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 3, result: {} }])
    expect(await handleMcp('T-1', { jsonrpc: '2.0', id: 4, method: 'nope' })).toMatchObject({ error: { code: -32601 } })
  })

  it('knows its task; reads and answers the review', async () => {
    expect((await call('task_info')).result.content[0].text).toContain('T-1: Fix login')
    data.comments = [
      { id: 'c1', taskId: 'T-1', path: 'src/a.ts', line: 0, newLine: 4, text: 'Rename this', createdAt: 0, ref: 3, awaiting: true, sentAt: 1 },
      { id: 'c2', taskId: 'T-1', path: 'src/a.ts', line: 0, newLine: 9, text: 'Draft', createdAt: 0, pending: true }
    ]
    expect((await call('review_comments')).result.content[0].text).toBe('[3] src/a.ts line 4: Rename this')
    expect((await call('reply_to_review_comment', { ref: 3, text: 'Renamed it.' })).result.content[0].text).toBe('Answered [3].')
    expect(data.comments[0]).toMatchObject({ awaiting: false, thread: [{ from: 'agent', text: 'Renamed it.' }] })
    expect(data.changed).toEqual([{ taskId: 'T-1', replies: 1 }])
    expect((await call('reply_to_review_comment', { ref: 8, text: 'x' })).result).toMatchObject({ isError: true })
  })

  it('reports conflicts from the task’s side; says what it can’t do', async () => {
    expect((await call('check_conflicts')).result.content[0].text).toContain("won't merge cleanly with yours: src/a.ts")
    // No dev server and no dev command: a plain answer, not a crash.
    const shot = await call('preview_screenshot')
    expect(shot.result.isError).toBe(true)
    expect(shot.result.content[0].text).toContain('no dev command')
    expect((await call('create_task', { title: 'Later' })).result).toMatchObject({ isError: true, content: [{ text: 'Switchyard’s window is closed.' }] })
  })
})
