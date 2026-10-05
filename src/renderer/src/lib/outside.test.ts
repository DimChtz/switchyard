import { describe, expect, it } from 'vitest'
import { sessionBrief, suggestAgent, suggestColumn, suggestTitle, titleFromBranch } from './outside'
import type { OutsideItem, OutsideSession } from '@shared/types'

const session: OutsideSession = { agentKind: 'codex', id: 's1', path: '/x.jsonl', cwd: '/repo', at: 0, first: 'Rename the config loader. Keep the old name exported.', last: 'Renamed it.', branch: 'main' }
const item = (over: Partial<OutsideItem>): OutsideItem => ({ id: 'x', kind: 'worktree', projectId: 'p', sessions: [], at: 0, ...over })

describe('bringing in outside work', () => {
  it('names a task from its conversation, its commit or its branch', () => {
    expect(titleFromBranch('feature/add-login-form')).toBe('Add login form')
    expect(titleFromBranch('fix/SYT-12-flaky_test')).toBe('Flaky test')
    expect(suggestTitle(item({ branch: 'feature/x', sessions: [session] }))).toBe('Rename the config loader.')
    expect(suggestTitle(item({ kind: 'branch', branch: 'feature/x', subject: 'Side work' }))).toBe('Side work')
    expect(suggestTitle(item({ branch: 'feature/dark-mode' }))).toBe('Dark mode')
  })

  it('picks its agent and column', () => {
    expect(suggestAgent(item({ sessions: [session] }), 'claude')).toBe('codex')
    expect(suggestAgent(item({}), 'claude')).toBe('claude')
    expect(suggestColumn(item({ ahead: 2, dirty: 0 }))).toBe('review')
    expect(suggestColumn(item({ ahead: 2, dirty: 3 }))).toBe('progress')
    expect(suggestColumn(item({ kind: 'session', sessions: [session] }))).toBe('backlog')
  })

  it('turns a conversation into a description', () => {
    const d = sessionBrief(session)
    expect(d).toMatch(/^From a Codex conversation in the main checkout \(.+, on main\)\./)
    expect(d).toContain('**Asked:** Rename the config loader.')
    expect(d).toContain('**Its last answer:** Renamed it.')
  })
})
