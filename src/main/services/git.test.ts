import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('./store', () => ({ getPrefs: () => ({ worktreeRoot: '', syncMode: 'rebase' }) }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

import { addWorktree, defaultBranchOf, getDiffFiles, mergeWithoutCheckout, parseUnifiedDiff } from './git'

let dir = ''
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim()
function repo(branch = 'main'): string {
  const r = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', branch, r])
  git(r, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(r, 'a.txt'), 'one\ntwo\n')
  git(r, 'add', '-A')
  git(r, 'commit', '-qm', 'init')
  return r
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sy-git-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseUnifiedDiff', () => {
  it('keeps removed "--" and added "++" lines (SQL comments, YAML separators, ++i)', () => {
    const lines = parseUnifiedDiff(['diff --git a/q.sql b/q.sql', '--- a/q.sql', '+++ b/q.sql', '@@ -1,3 +1,3 @@', '--- old comment', ' select 1;', '+++i;', ' ---'].join('\n'))
    expect(lines.map((l) => [l.kind, l.text, l.oldLine, l.newLine])).toEqual([
      ['@', '@@ -1,3 +1,3 @@', null, null],
      ['-', '-- old comment', 1, null],
      [' ', 'select 1;', 2, 1],
      ['+', '++i;', null, 2],
      [' ', '---', 3, 3]
    ])
  })
})

describe('git settings', () => {
  it('reads diffs whatever diff.noprefix / diff.mnemonicPrefix say', async () => {
    const r = repo()
    git(r, 'config', 'diff.mnemonicPrefix', 'true')
    git(r, 'config', 'diff.noprefix', 'true')
    writeFileSync(join(r, 'a.txt'), 'one\n2\n')
    const files = await getDiffFiles(r, 'main')
    expect(files.map((f) => [f.path, f.added, f.deleted])).toEqual([['a.txt', 1, 1]])
  })
})

describe('defaultBranchOf', () => {
  it("is main (or master), not the branch that's checked out", async () => {
    const r = repo()
    git(r, 'checkout', '-qb', 'feature/x')
    expect(await defaultBranchOf(r)).toBe('main')
  })
})

describe('worktrees', () => {
  it("keeps .worktrees/ out of git status through .git/info/exclude, leaving .gitignore alone", async () => {
    const r = repo()
    await addWorktree(r, join(r, '.worktrees', 'x'), 'x')
    expect(existsSync(join(r, '.gitignore'))).toBe(false)
    expect(readFileSync(join(r, '.git', 'info', 'exclude'), 'utf-8')).toContain('/.worktrees/')
    expect(git(r, 'status', '--porcelain')).toBe('')
  })
})

describe('mergeWithoutCheckout', () => {
  it('fast-forwards a branch nobody has checked out', async () => {
    const r = repo()
    git(r, 'branch', 'task')
    git(r, 'checkout', '-q', 'task')
    writeFileSync(join(r, 'b.txt'), 'b\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'b')
    await mergeWithoutCheckout(r, 'task', 'main')
    expect(git(r, 'rev-parse', 'main')).toBe(git(r, 'rev-parse', 'task'))
    expect(git(r, 'branch', '--show-current')).toBe('task')
  })

  it('makes a merge commit when both moved, files untouched', async () => {
    const r = repo()
    git(r, 'checkout', '-qb', 'task')
    writeFileSync(join(r, 'b.txt'), 'b\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'b')
    git(r, 'checkout', '-q', 'main')
    writeFileSync(join(r, 'c.txt'), 'c\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'c')
    git(r, 'checkout', '-qb', 'elsewhere')
    await mergeWithoutCheckout(r, 'task', 'main', 'Merge SYT-1 (closes #3)')
    expect(git(r, 'log', '-1', '--format=%s', 'main')).toBe('Merge SYT-1 (closes #3)')
    expect(git(r, 'show', 'main:b.txt')).toBe('b')
    expect(git(r, 'show', 'main:c.txt')).toBe('c')
    expect(git(r, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  it('refuses a conflicting merge and changes nothing', async () => {
    const r = repo()
    git(r, 'checkout', '-qb', 'task')
    writeFileSync(join(r, 'a.txt'), 'one\nTASK\n')
    git(r, 'commit', '-qam', 'task')
    git(r, 'checkout', '-q', 'main')
    writeFileSync(join(r, 'a.txt'), 'one\nMAIN\n')
    git(r, 'commit', '-qam', 'main')
    const before = git(r, 'rev-parse', 'main')
    git(r, 'checkout', '-qb', 'elsewhere')
    await expect(mergeWithoutCheckout(r, 'task', 'main')).rejects.toThrow(/conflicts in a\.txt/)
    expect(git(r, 'rev-parse', 'main')).toBe(before)
    expect(git(r, 'worktree', 'list').split('\n')).toHaveLength(1)
  })
})
