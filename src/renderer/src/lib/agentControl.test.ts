import { describe, expect, it } from 'vitest'
import { pickUpMessage } from './agentControl'
import type { Task } from '@shared/types'

const task = (over: Partial<Task> = {}): Task =>
  ({ id: 'T-1', key: 'T-1', projectId: 'p', title: 'Fix the login', desc: 'It breaks on Safari.', firstMessage: 'T-1: Fix the login - it breaks on Safari.', ...over }) as Task

describe('a new session on a task under way', () => {
  it('gets the task, and is told the work so far is in its worktree', () => {
    const msg = pickUpMessage(task({ baseBranch: 'develop' }), { defaultBranch: 'main' })
    expect(msg.startsWith('T-1: Fix the login - it breaks on Safari.')).toBe(true)
    expect(msg).toContain('git log develop..HEAD')
    expect(msg).toMatch(/don't start over/)
  })
  it("rebuilds the task's message when it has none, and leaves git log out working in place", () => {
    const msg = pickUpMessage(task({ firstMessage: null, inPlace: true, desc: 'See [spec](/tmp/spec.pdf)' }), { defaultBranch: 'main' })
    expect(msg).toContain('T-1: Fix the login')
    expect(msg).toContain('[file: spec - /tmp/spec.pdf]')
    expect(msg).not.toContain('git log')
  })
})
