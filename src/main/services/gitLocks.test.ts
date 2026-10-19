import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
vi.mock('./store', () => ({ getPrefs: () => ({}) }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

import { GIT_ENV, gitBusy, isLockError, oneAtATime, retryOnLock } from './gitEnv'
import { brokenWorktree, closeWithPr } from './git'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const repo = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sy-locks-'))
  git(d, 'init', '-q', '-b', 'main')
  writeFileSync(join(d, 'a.txt'), 'a')
  git(d, 'add', '.')
  git(d, 'commit', '-qm', 'i')
  return d
}

describe("Switchyard's git, beside yours", () => {
  it('status takes no index lock', () => {
    expect(GIT_ENV.GIT_OPTIONAL_LOCKS).toBe('0')
  })

  it('tells lock failures from others', () => {
    expect(isLockError(new Error("fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository"))).toBe(true)
    expect(isLockError(new Error("error: cannot lock ref 'refs/heads/x': is at abc but expected def"))).toBe(true)
    expect(isLockError(new Error('fatal: not a git repository'))).toBe(false)
  })

  it('tries again while a lock is held, and gives up on anything else', async () => {
    let n = 0
    expect(await retryOnLock(async () => (++n < 3 ? Promise.reject(new Error('index.lock: File exists')) : 'ok'))).toBe('ok')
    expect(n).toBe(3)
    await expect(retryOnLock(async () => Promise.reject(new Error('fatal: bad revision')))).rejects.toThrow('bad revision')
  })

  it("runs one repository's changes one at a time", async () => {
    const order: string[] = []
    const step = (name: string, ms: number) => () => new Promise<void>((r) => setTimeout(() => (order.push(name), r()), ms))
    await Promise.all([oneAtATime('/r', step('slow', 40)), oneAtATime('/r', step('fast', 1)), oneAtATime('/other', step('elsewhere', 1))])
    expect(order).toEqual(['elsewhere', 'slow', 'fast'])
  })

  it('knows when git is at work in a repository - not for a lock left long ago', async () => {
    const d = repo()
    try {
      expect(await gitBusy(d)).toBeNull()
      writeFileSync(join(d, '.git', 'index.lock'), '')
      expect(await gitBusy(d)).toMatch(/index\.lock/)
      const old = new Date(Date.now() - 60 * 60_000)
      utimesSync(join(d, '.git', 'index.lock'), old, old)
      expect(await gitBusy(d)).toBeNull()
      rmSync(join(d, '.git', 'index.lock'))
      // A rebase going on in one of its worktrees.
      const wt = join(d, '.worktrees', 'task')
      git(d, 'worktree', 'add', '-q', '-b', 'task', wt)
      mkdirSync(join(d, '.git', 'worktrees', 'task', 'rebase-merge'))
      expect(await gitBusy(d)).toMatch(/rebase-merge/)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

describe('finishing with a worktree git lost track of', () => {
  it('finishes, leaving the folder (unchecked) where it is', async () => {
    const d = repo()
    try {
      const wt = join(d, '.worktrees', 'task')
      git(d, 'worktree', 'add', '-q', '-b', 'task', wt)
      writeFileSync(join(wt, 'mine.txt'), 'not committed')
      // An earlier finish got half way: git's record of the worktree is gone.
      rmSync(join(d, '.git', 'worktrees', 'task'), { recursive: true, force: true })
      expect(await brokenWorktree(wt)).toBe(true)
      expect(await brokenWorktree(d)).toBe(false)
      const r = await closeWithPr(d, wt, 'task', 'main', true)
      expect(r.leftFolder).toBe(wt)
      // The branch of the merged PR goes; the folder and what's in it stay.
      expect(git(d, 'branch', '--list', 'task').trim()).toBe('')
      expect(execFileSync('node', ['-e', `process.stdout.write(String(require('fs').existsSync(${JSON.stringify(join(wt, 'mine.txt'))})))`], { encoding: 'utf8' })).toBe('true')
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
