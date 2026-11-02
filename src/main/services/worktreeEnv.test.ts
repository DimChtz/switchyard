import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({ tasks: [] as Record<string, unknown>[], kv: {} as Record<string, unknown> }))
vi.mock('./store', () => ({
  getPrefs: () => ({ worktreePortBase: 4100 }),
  getTasks: () => state.tasks,
  kvGet: (k: string) => state.kv[k],
  kvSet: (k: string, v: unknown) => (state.kv[k] = JSON.parse(JSON.stringify(v)))
}))

import { envFor, slotOf, taskAt, worktreeInfo } from './worktreeEnv'

const root = join(tmpdir(), 'sy-wtenv')
const task = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, key: id.toUpperCase(), col: 'progress', worktreePath: join(root, id), ...extra })

describe("tasks' slots", () => {
  it('gives each open task the lowest free slot, keeps it, and takes it back when done', () => {
    state.kv = {}
    state.tasks = [task('a'), task('b')]
    expect(slotOf('a')).toBe(1)
    expect(slotOf('b')).toBe(2)
    expect(slotOf('a')).toBe(1)
    state.tasks = [task('a', { col: 'done' }), task('b'), task('c')]
    expect(slotOf('c')).toBe(1)
    expect(slotOf('b')).toBe(2)
  })

  it("knows a process's task by its folder - not one working in the repository itself", () => {
    state.kv = {}
    state.tasks = [task('a'), task('m', { worktreePath: join(root, 'repo'), inPlace: true }), task('x', { worktreePath: join(root, '_multi', 'X', 'api'), taskDir: join(root, '_multi', 'X') })]
    expect(taskAt(join(root, 'a', 'src'))?.id).toBe('a')
    expect(taskAt(join(root, 'repo'))).toBeNull()
    expect(taskAt(join(root, '_multi', 'X'))?.id).toBe('x')
    expect(taskAt(join(root, 'elsewhere'))).toBeNull()
    expect(worktreeInfo(join(root, 'elsewhere'))).toEqual({ slot: 0, port: 4100, task: null })
    const env = envFor(join(root, 'a'), { PORT: '{port}', DB: 'app_{task}' })
    expect(env).toMatchObject({ PORT: '4110', DB: 'app_a', SWITCHYARD_SLOT: '1', SWITCHYARD_TASK: 'A' })
  })
})
