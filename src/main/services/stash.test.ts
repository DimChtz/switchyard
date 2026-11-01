import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('./store', () => ({ getPrefs: () => ({}) }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

import { getDiffFiles, stashList, stashPush, stashRestoreFile } from './git'

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env })
const repo = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sy-stash-'))
  git(d, 'init', '-q', '-b', 'main')
  git(d, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(d, 'a.txt'), 'one\n')
  writeFileSync(join(d, 'gone.txt'), 'x\n')
  git(d, 'add', '.')
  git(d, 'commit', '-qm', 'i')
  return d
}

describe('stashes', () => {
  it("shows a stash's changes - its new files too - and brings back one file", async () => {
    const d = repo()
    try {
      writeFileSync(join(d, 'a.txt'), 'two\n')
      writeFileSync(join(d, 'new.txt'), 'fresh\n')
      rmSync(join(d, 'gone.txt'))
      await stashPush(d, 'wip on a')
      const [s] = await stashList(d)
      expect(s).toMatchObject({ ref: 'stash@{0}', message: 'wip on a' })
      expect(s.sha).toMatch(/^[0-9a-f]{40}$/)
      const files = await getDiffFiles(d, 'main', { commit: s.sha, stash: true })
      expect(files.map((f) => `${f.path}:${f.status}`)).toEqual(['a.txt:modified', 'gone.txt:deleted', 'new.txt:added'])
      // One file back - the stash stays.
      await stashRestoreFile(d, s.sha, 'new.txt')
      expect(readFileSync(join(d, 'new.txt'), 'utf8')).toBe('fresh\n')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('one\n')
      await stashRestoreFile(d, s.sha, 'a.txt')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('two\n')
      await stashRestoreFile(d, s.sha, 'gone.txt')
      expect(existsSync(join(d, 'gone.txt'))).toBe(false)
      expect(await stashList(d)).toHaveLength(1)
      // (Left unstaged, as any change in the worktree.)
      expect(git(d, 'diff', '--cached', '--name-only').trim()).toBe('')
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('keeps the changes when asked - a copy put aside', async () => {
    const d = repo()
    try {
      writeFileSync(join(d, 'a.txt'), 'kept\n')
      await stashPush(d, 'a copy', undefined, true)
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('kept\n')
      expect((await stashList(d))[0].message).toBe('a copy')
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it("lists the branch's own, or all of them", async () => {
    const d = repo()
    try {
      writeFileSync(join(d, 'a.txt'), 'on main\n')
      await stashPush(d, 'from main')
      git(d, 'checkout', '-q', '-b', 'feature')
      writeFileSync(join(d, 'a.txt'), 'on feature\n')
      await stashPush(d, 'from feature')
      expect((await stashList(d, 'feature')).map((s) => s.message)).toEqual(['from feature'])
      expect((await stashList(d)).map((s) => `${s.branch}:${s.message}`)).toEqual(['feature:from feature', 'main:from main'])
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
