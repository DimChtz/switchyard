import { describe, expect, it } from 'vitest'
import { prefsFor, projectIdForPath } from './projectPrefs'
import { DEFAULT_PREFS } from '@shared/constants'
import type { Project, Task } from '@shared/types'

const project = (id: string, repoPath: string, prefs?: Project['prefs']): Project => ({ id, name: id, repo: id, repoPath, prefix: 'X', prefs }) as Project

describe('prefsFor', () => {
  it("puts the project's own preferences over the user's", () => {
    const state = { prefs: { ...DEFAULT_PREFS, editorTabSize: 2, termFontSize: 14 }, projects: [project('a', '/r/a', { editorTabSize: 4 })] }
    expect(prefsFor(state, 'a')).toMatchObject({ editorTabSize: 4, termFontSize: 14 })
    expect(prefsFor(state, 'other')).toBe(state.prefs)
    expect(prefsFor(state, null)).toBe(state.prefs)
  })

  it('returns the same object until something changes (editors memoize on it)', () => {
    const own = { editorTabSize: 4 }
    const state = { prefs: DEFAULT_PREFS, projects: [project('a', '/r/a', own)] }
    expect(prefsFor(state, 'a')).toBe(prefsFor(state, 'a'))
    const changedUser = { ...state, prefs: { ...DEFAULT_PREFS, sound: true } }
    expect(prefsFor(changedUser, 'a')).not.toBe(prefsFor(state, 'a'))
    expect(prefsFor(changedUser, 'a').sound).toBe(true)
  })
})

describe('projectIdForPath', () => {
  const state = {
    projects: [project('a', 'C:\\code\\a'), project('b', '/home/me/b')],
    tasks: [{ id: 't', projectId: 'b', worktreePath: 'C:/worktrees/b/feature-x' } as Task]
  }

  it("finds a task's worktree first, then a repository, whatever the slashes and case", () => {
    expect(projectIdForPath(state, 'C:\\worktrees\\b\\feature-x\\src')).toBe('b')
    expect(projectIdForPath(state, 'c:/code/a')).toBe('a')
    expect(projectIdForPath(state, 'C:\\code\\a\\lib')).toBe('a')
  })

  it("doesn't match a folder that only starts with the same name", () => {
    expect(projectIdForPath(state, 'C:\\code\\abc')).toBeNull()
    expect(projectIdForPath(state, undefined)).toBeNull()
  })
})
