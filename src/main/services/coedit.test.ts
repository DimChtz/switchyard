import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import type { Task } from '@shared/types'

const root = join(process.cwd(), 'wt', 'T-1')
const data = vi.hoisted(() => ({ told: [] as string[], notes: [] as unknown[] }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_c: string, _id: number, r: unknown) => data.notes.push(r) } }] } }))
vi.mock('./store', () => ({ getTasks: () => [{ id: 'T-1', key: 'T-1', col: 'progress', worktreePath: root, taskDir: null }] as unknown as Task[] }))
vi.mock('./pty', () => ({ exists: (id: string) => id === 'agent-T-1' }))
vi.mock('./inbox', () => ({ deliver: (_id: string, text: string) => data.told.push(text) }))

import { beforeTool, changedLines, reset, userSaved } from './coedit'

beforeEach(() => {
  reset()
  data.told = []
  data.notes = []
})

describe('editing alongside the agent', () => {
  it('says which lines changed', () => {
    expect(changedLines('a\nb\nc\nd', 'a\nB\nC\nd')).toBe('lines 2-3')
    expect(changedLines('a\nb\nc', 'a\nb\nx\nc')).toBe('line 3')
    expect(changedLines('a\nb', 'a\nb')).toBe('no change')
    expect(changedLines(null, 'x')).toBe('a new file')
    expect(changedLines('a\nb\nc', 'a\nc')).toBe('removed lines after line 1')
  })

  it('tells the agent, and refuses its edit of the file until it has read it again', () => {
    const file = join(root, 'src', 'form.tsx')
    userSaved(file, 'one\ntwo\n', 'one\nTWO\n')
    expect(data.told[0]).toBe('Heads-up from Switchyard: the user just edited src/form.tsx (line 2) in the editor. Keep their changes - read the file again before you change it.')
    const deny = beforeTool('T-1', 'Edit', { file_path: file }) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain('src/form.tsx (line 2)')
    // A relative path from its folder is the same file; other tools pass.
    expect(beforeTool('T-1', 'Write', { file_path: 'src/form.tsx' })).not.toBeNull()
    expect(beforeTool('T-1', 'Bash', { command: 'ls' })).toBeNull()
    // Reading it lifts the guard.
    expect(beforeTool('T-1', 'Read', { file_path: file })).toBeNull()
    expect(beforeTool('T-1', 'Edit', { file_path: file })).toBeNull()
  })

  it('leaves files outside a running task alone', () => {
    userSaved(join(process.cwd(), 'elsewhere', 'a.ts'), 'a', 'b')
    userSaved(join(root, 'a.ts'), 'same', 'same')
    expect(data.told).toEqual([])
  })
})
