import { describe, expect, it } from 'vitest'
import { cleanOutput, descFromOutput, taskForPath, titleFromOutput } from './terminalTask'
import type { Task } from '@shared/types'

describe('a task from terminal output', () => {
  const out = '\x1b[32m$ npm test\x1b[0m\r\n\r\n> app@1.0.0 test\r\n\x1b[31mTypeError: Cannot read properties of undefined (reading "id")\x1b[0m\r\n    at login (src/auth.ts:42:7)\r\n\r\n'

  it('cleans colours and blank edges', () => {
    expect(cleanOutput(out)).toBe('$ npm test\n\n> app@1.0.0 test\nTypeError: Cannot read properties of undefined (reading "id")\n    at login (src/auth.ts:42:7)')
    expect(cleanOutput(Array.from({ length: 250 }, (_, i) => `l${i}`).join('\n')).split('\n')).toHaveLength(201)
  })

  it('titles it by the line that says what went wrong', () => {
    expect(titleFromOutput(out)).toBe('Fix: TypeError: Cannot read properties of undefined (reading "id")')
    expect(titleFromOutput('$ ls\nREADME.md')).toBe('README.md')
    // Not the command that was typed (a prompt line), nor a stack frame: the error itself.
    const cmd = `C:\\r\\wt>node -e "throw new TypeError('Cannot read id')"\n[eval]:1\nTypeError: Cannot read id\n    at [eval]:1:7\nNode.js v22\n\nC:\\r\\wt>`
    expect(titleFromOutput(cmd)).toBe('Fix: TypeError: Cannot read id')
    expect(titleFromOutput('user@box:~/app$ npm test\nnpm ERR! Test failed.')).toBe('Fix: npm ERR! Test failed.')
    expect(titleFromOutput(`Error: ${'x'.repeat(200)}`).length).toBeLessThanOrEqual(95)
  })

  it('says where it was seen, with the output fenced', () => {
    const from = { key: 'SYT-4', title: 'Login page' } as Task
    const d = descFromOutput(out, '/r/.worktrees/syt-4', from)
    expect(d).toContain('Seen in a terminal - `/r/.worktrees/syt-4`, while working on SYT-4 (Login page):')
    expect(d).toContain('```\n$ npm test')
    expect(descFromOutput('a ``` b', undefined, null)).toContain('~~~\na ``` b\n~~~')
  })

  it("finds the task whose worktree it's in", () => {
    const tasks = [{ id: 'a', col: 'progress', worktreePath: 'C:\\r\\.worktrees\\a' }, { id: 'b', col: 'done', worktreePath: '/r/b' }] as Task[]
    expect(taskForPath(tasks, 'c:/r/.worktrees/a/src')?.id).toBe('a')
    expect(taskForPath(tasks, '/r/b')).toBeNull()
  })
})
