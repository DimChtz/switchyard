import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// (Settings a test changes: reset after each.)
const prefs = vi.hoisted(() => ({ worktreeRoot: '', syncMode: 'rebase', deleteBranchOnFinish: true }))
vi.mock('./store', () => ({ getPrefs: () => prefs }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

import { gitAt, gitFailure, refClash } from './gitEnv'
import {
  addWorktree,
  branchLeft,
  closeCheck,
  commitFiles,
  commitSelection,
  createBranch,
  listBranches,
  prTemplate,
  closeWithPr,
  commitsAfter,
  defaultBranchOf,
  mergeAndPrune,
  getDiffFiles,
  getWorktreeStatus,
  mergeWithoutCheckout,
  parseUnifiedDiff,
  revertFile,
  revertHunk,
  rebaseOnto,
  syncState,
  continueSync,
  markResolved,
  takeSide,
  abortSync,
  fileHistory,
  blame
} from './git'

let dir = ''
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim()
function repo(branch = 'main'): string {
  const r = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', branch, r])
  git(r, 'config', 'core.autocrlf', 'false')
  // Its own identity: the code under test makes commits (merges) too, and a build machine has no global one.
  git(r, 'config', 'user.name', 't')
  git(r, 'config', 'user.email', 't@t')
  writeFileSync(join(r, 'a.txt'), 'one\ntwo\n')
  git(r, 'add', '-A')
  git(r, 'commit', '-qm', 'init')
  return r
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sy-git-'))
})
afterEach(() => {
  prefs.deleteBranchOnFinish = true
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

describe('the Changes diff', () => {
  it('shows a big new file in full, and UTF-16 text as text', async () => {
    const r = repo()
    // ~770 KB of markdown: over the size new files used to be skipped at.
    writeFileSync(join(r, 'big.md'), Array.from({ length: 7000 }, (_, i) => `- line ${i} ${'x'.repeat(100)}`).join('\n') + '\n')
    writeFileSync(join(r, 'wide.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo\r\nworld\r\n', 'utf16le')]))
    const files = await getDiffFiles(r, 'main')
    const big = files.find((f) => f.path === 'big.md')!
    expect([big.added, big.lines.length, big.lines[6999].text]).toEqual([7000, 7000, `- line 6999 ${'x'.repeat(100)}`])
    expect(files.find((f) => f.path === 'wide.txt')!.lines.map((l) => l.text)).toEqual(['héllo', 'world'])
  })

  it('compares with the base, origin, or the last commit', async () => {
    const up = repo()
    const down = join(dir, 'down')
    git(dir, 'clone', '-q', up, down)
    git(down, 'checkout', '-qb', 'task')
    writeFileSync(join(down, 'pushed.txt'), 'p\n')
    git(down, 'add', '-A')
    git(down, 'commit', '-qm', 'pushed')
    git(down, 'push', '-qu', 'origin', 'task')
    writeFileSync(join(down, 'local.txt'), 'l\n')
    git(down, 'add', '-A')
    git(down, 'commit', '-qm', 'local')
    writeFileSync(join(down, 'a.txt'), 'one\nchanged\n')
    const paths = async (scope: 'branch' | 'unpushed' | 'uncommitted'): Promise<string[]> => (await getDiffFiles(down, 'main', scope)).map((f) => f.path)
    expect(await paths('branch')).toEqual(['a.txt', 'local.txt', 'pushed.txt'])
    expect(await paths('unpushed')).toEqual(['a.txt', 'local.txt'])
    expect(await paths('uncommitted')).toEqual(['a.txt'])
    // Never pushed: everything since it left the base.
    git(down, 'checkout', '-qb', 'fresh')
    expect(await paths('unpushed')).toEqual(['a.txt', 'local.txt', 'pushed.txt'])
    // One commit: just what it changed.
    const sha = git(down, 'rev-parse', 'HEAD~1')
    expect((await getDiffFiles(down, 'main', { commit: sha })).map((f) => [f.path, f.uncommitted])).toEqual([['pushed.txt', false]])
  })

  it('shows a move as one file, and whitespace changes only when asked', async () => {
    const r = repo()
    writeFileSync(join(r, 'b.txt'), 'x\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'b')
    git(r, 'checkout', '-qb', 'task')
    git(r, 'mv', 'b.txt', 'c.txt')
    writeFileSync(join(r, 'a.txt'), 'one\n  two\n')
    const files = await getDiffFiles(r, 'main')
    expect(files.map((f) => [f.path, f.oldPath, f.lines.length])).toEqual([
      ['a.txt', undefined, 4],
      ['c.txt', 'b.txt', 0]
    ])
    expect((await getDiffFiles(r, 'main', 'branch', { ignoreSpace: true })).map((f) => f.path)).toEqual(['c.txt'])
  })

  it('commits just the picked files', async () => {
    const r = repo()
    writeFileSync(join(r, 'a.txt'), 'changed\n')
    writeFileSync(join(r, 'new.txt'), 'new\n')
    writeFileSync(join(r, 'later.txt'), 'later\n')
    await commitFiles(r, ['a.txt', 'new.txt'], 'some')
    expect(git(r, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['a.txt', 'new.txt'])
    expect(git(r, 'status', '--porcelain')).toBe('?? later.txt')
  })

  it('commits only the picked lines, leaving the rest - and what was staged - as they were', async () => {
    const r = repo()
    writeFileSync(join(r, 'long.txt'), Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') + '\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'long')
    writeFileSync(join(r, 'long.txt'), Array.from({ length: 30 }, (_, i) => (i === 2 ? 'TOP' : i === 26 ? 'BOTTOM' : `l${i}`)).join('\n') + '\n')
    writeFileSync(join(r, 'fresh.txt'), 'keep\nskip\n')
    // Staged by someone else: stays staged, out of this commit.
    writeFileSync(join(r, 'staged.txt'), 's\n')
    git(r, 'add', 'staged.txt')
    const files = await getDiffFiles(r, 'main', 'uncommitted')
    const long = files.find((f) => f.path === 'long.txt')!
    const top = long.lines.flatMap((l, i) => (l.kind !== ' ' && l.kind !== '@' && (l.text === 'TOP' || l.text === 'l2') ? [i] : []))
    const fresh = files.find((f) => f.path === 'fresh.txt')!
    await commitSelection(r, [
      { path: 'long.txt', lines: long.lines, include: top },
      { path: 'fresh.txt', lines: fresh.lines, include: [0] }
    ], 'some lines')
    expect(git(r, 'show', 'HEAD:long.txt').split('\n').slice(0, 3)).toEqual(['l0', 'l1', 'TOP'])
    expect(git(r, 'show', 'HEAD:long.txt').split('\n')[26]).toBe('l26')
    expect(git(r, 'show', 'HEAD:fresh.txt')).toBe('keep')
    // The worktree keeps everything; the rest shows as still to commit.
    expect(readFileSync(join(r, 'long.txt'), 'utf-8').split('\n')[26]).toBe('BOTTOM')
    expect(git(r, 'status', '--porcelain').split('\n').map((s) => s.trim()).sort()).toEqual(['A  staged.txt', 'M fresh.txt', 'M long.txt'])
  })

  it('undoes one hunk, or a whole file back to the base', async () => {
    const r = repo()
    writeFileSync(join(r, 'long.txt'), Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') + '\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'long')
    git(r, 'checkout', '-qb', 'task')
    const changed = Array.from({ length: 30 }, (_, i) => (i === 2 ? 'TOP' : i === 26 ? 'BOTTOM' : `l${i}`))
    writeFileSync(join(r, 'long.txt'), changed.join('\n') + '\n')
    git(r, 'commit', '-qam', 'both')
    writeFileSync(join(r, 'a.txt'), 'one\ntwo')
    let file = (await getDiffFiles(r, 'main')).find((f) => f.path === 'long.txt')!
    const second = file.lines.findIndex((l, i) => i > 0 && l.kind === '@')
    await revertHunk(r, 'long.txt', file.lines.slice(second))
    expect(readFileSync(join(r, 'long.txt'), 'utf-8').split('\n')[26]).toBe('l26')
    expect(readFileSync(join(r, 'long.txt'), 'utf-8').split('\n')[2]).toBe('TOP')
    // A hunk ending without a newline.
    file = (await getDiffFiles(r, 'main')).find((f) => f.path === 'a.txt')!
    expect(file.lines.some((l) => l.noEol)).toBe(true)
    await revertHunk(r, 'a.txt', file.lines)
    expect(readFileSync(join(r, 'a.txt'), 'utf-8')).toBe('one\ntwo\n')
    // The whole file back to main: an uncommitted change.
    await revertFile(r, 'main', 'branch', 'long.txt')
    expect(readFileSync(join(r, 'long.txt'), 'utf-8').split('\n')[2]).toBe('l2')
    expect(git(r, 'status', '--porcelain')).toBe('M long.txt')
    // A file the branch added: gone.
    writeFileSync(join(r, 'added.txt'), 'x\n')
    await revertFile(r, 'main', 'branch', 'added.txt')
    expect(existsSync(join(r, 'added.txt'))).toBe(false)
  })
})

describe('a file’s history', () => {
  it('lists its commits across a move, and who wrote each line', async () => {
    const r = repo()
    writeFileSync(join(r, 'a.txt'), 'one\nTWO\n')
    git(r, 'commit', '-qam', 'SYT-3: shout')
    git(r, 'mv', 'a.txt', 'b.txt')
    git(r, 'commit', '-qm', 'move')
    writeFileSync(join(r, 'b.txt'), 'one\nTWO\nthree\n')
    expect((await fileHistory(r, 'b.txt')).map((c) => c.subject)).toEqual(['move', 'SYT-3: shout', 'init'])
    const b = await blame(r, 'b.txt')
    expect(b.lines.map((sha) => (/^0+$/.test(sha) ? 'not committed' : b.commits[sha].subject))).toEqual(['init', 'SYT-3: shout', 'not committed'])
    expect(b.commits[b.lines[0]].author).toBe('t')
  })
})

describe('a sync that stops on conflicts', () => {
  /** main and task both changed a.txt's second line; task has two commits. */
  function clashing(): string {
    const r = repo()
    git(r, 'checkout', '-qb', 'task')
    writeFileSync(join(r, 'a.txt'), 'one\ntask\n')
    git(r, 'commit', '-qam', 'task one')
    writeFileSync(join(r, 't.txt'), 't\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'task two')
    git(r, 'checkout', '-q', 'main')
    writeFileSync(join(r, 'a.txt'), 'one\nmain\n')
    git(r, 'commit', '-qam', 'main')
    git(r, 'checkout', '-q', 'task')
    return r
  }
  afterEach(() => {
    prefs.syncMode = 'rebase'
  })

  it('backs out by default, or stays to be resolved and continued (rebase)', async () => {
    const r = clashing()
    await expect(rebaseOnto(r, 'main')).rejects.toThrow('CONFLICT:a.txt')
    expect(await syncState(r)).toBe(null)
    await expect(rebaseOnto(r, 'main', true)).rejects.toThrow('CONFLICT:a.txt')
    const st = (await syncState(r))!
    expect([st.op, st.onto, st.step, st.files]).toEqual(['rebase', 'main', [1, 2], [{ path: 'a.txt', kind: 'both' }]])
    expect(st.commit).toMatch(/task one$/)
    await expect(continueSync(r)).rejects.toThrow('Resolve a.txt first')
    writeFileSync(join(r, 'a.txt'), 'one\nmain and task\n')
    await markResolved(r, 'a.txt')
    expect(await continueSync(r)).toBe(null)
    expect(git(r, 'log', '--format=%s', '-3').split('\n')).toEqual(['task two', 'task one', 'main'])
    expect(readFileSync(join(r, 'a.txt'), 'utf-8')).toBe('one\nmain and task\n')
  })

  it('takes one side whole, or gives up (merge)', async () => {
    prefs.syncMode = 'merge'
    const r = clashing()
    await expect(rebaseOnto(r, 'main', true)).rejects.toThrow('CONFLICT:a.txt')
    expect((await syncState(r))!.op).toBe('merge')
    await abortSync(r)
    expect(await syncState(r)).toBe(null)
    expect(readFileSync(join(r, 'a.txt'), 'utf-8')).toBe('one\ntask\n')
    await expect(rebaseOnto(r, 'main', true)).rejects.toThrow('CONFLICT')
    expect((await syncState(r))!.onto).toBe('main')
    await takeSide(r, 'a.txt', 'theirs')
    expect(await continueSync(r)).toBe(null)
    expect(readFileSync(join(r, 'a.txt'), 'utf-8')).toBe('one\nmain\n')
    expect(git(r, 'log', '-1', '--format=%p').split(' ').length).toBe(2)
  })
})

describe('a fetch that fails on a branch name clash', () => {
  it('says the error, not the last ref it listed - and a prune clears it', async () => {
    const up = repo()
    git(up, 'branch', 'foo')
    const down = join(dir, 'down')
    git(dir, 'clone', '-q', up, down)
    // foo deleted upstream and foo/bar made: the stale origin/foo is in origin/foo/bar's way.
    git(up, 'branch', '-D', 'foo')
    git(up, 'branch', 'foo/bar')
    git(up, 'branch', 'zzz-new')
    const err = await gitAt(down)
      .fetch(['origin', '--progress'])
      .then(() => null)
      .catch((e: unknown) => e)
    expect(err).not.toBe(null)
    expect(refClash(String((err as Error).message))).toBe(true)
    const said = gitFailure(err)
    // (Older git names the ref; newer git only says some refs failed - and what to run.)
    expect(said).toMatch(/^error: (cannot lock ref 'refs\/remotes\/origin\/foo\/bar'|some local refs could not be updated; try running 'git remote prune origin')/)
    expect(said).toContain('git remote prune origin')
    expect(said).not.toContain('zzz-new')
    await gitAt(down).raw(['remote', 'prune', 'origin'])
    await gitAt(down).fetch(['origin', '--prune'])
    expect(git(down, 'branch', '-r')).toContain('origin/foo/bar')
  })

  it("puts newer git's wrapped advice on one line, after the specific error", () => {
    const out = [
      'error: some local refs could not be updated; try running',
      " 'git remote prune origin' to remove any old, conflicting branches",
      ' ! [new branch]      foo/bar    -> origin/foo/bar  (unable to update local ref)',
      ' * [new branch]      zzz-new    -> origin/zzz-new'
    ].join('\n')
    expect(gitFailure(new Error(out))).toBe("error: some local refs could not be updated; try running 'git remote prune origin' to remove any old, conflicting branches")
    expect(gitFailure(new Error(`error: cannot lock ref 'refs/remotes/origin/a/b': 'refs/remotes/origin/a' exists; cannot create 'refs/remotes/origin/a/b'\n${out}`))).toMatch(/^error: cannot lock ref .* · error: some local refs/)
  })

  it('keeps the last line when there is no error line', () => {
    expect(gitFailure(new Error('Something\nfatal: could not read from remote repository.'))).toBe('fatal: could not read from remote repository.')
    expect(gitFailure(new Error('just this'))).toBe('just this')
  })
})

describe('starting on a branch that is there already', () => {
  it('lists local branches and ones only on origin, with where each is checked out', async () => {
    const up = repo()
    git(up, 'branch', 'theirs')
    const down = join(dir, 'down')
    git(dir, 'clone', '-q', up, down)
    git(down, 'branch', 'mine')
    const wt = join(dir, 'mine-wt')
    git(down, 'worktree', 'add', '-q', wt, 'mine')
    const list = await listBranches(down, 'main')
    const by = Object.fromEntries(list.map((b) => [b.name, b]))
    expect(Object.keys(by).sort()).toEqual(['mine', 'theirs'])
    expect([by.mine.local, by.mine.remote, !!by.mine.worktree, by.mine.mainCheckout]).toEqual([true, false, true, false])
    expect([by.theirs.local, by.theirs.remote, by.theirs.worktree]).toEqual([false, true, null])
  })

  it("checks a branch that's only on origin out from there, not new from main", async () => {
    const up = repo()
    git(up, 'checkout', '-q', '-b', 'theirs')
    writeFileSync(join(up, 't.txt'), 'theirs\n')
    git(up, 'add', '-A')
    git(up, 'commit', '-qm', 'their work')
    git(up, 'checkout', '-q', 'main')
    const down = join(dir, 'down')
    git(dir, 'clone', '-q', up, down)
    const r = await createBranch(down, 'theirs', 'main')
    expect([r.existed, r.fromOrigin]).toEqual([true, true])
    expect(git(down, 'log', '-1', '--format=%s', 'theirs')).toBe('their work')
    expect(git(down, 'rev-parse', '--abbrev-ref', 'theirs@{upstream}')).toBe('origin/theirs')
  })
})

describe('pull request templates', () => {
  it("finds the repository's template where GitHub looks - .github first, any case, or a folder of them", async () => {
    const r = repo()
    expect(await prTemplate(r)).toBe(null)
    writeFileSync(join(r, 'PULL_REQUEST_TEMPLATE.md'), '## Root\n')
    expect(await prTemplate(r)).toBe('## Root\n')
    mkdirSync(join(r, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true })
    writeFileSync(join(r, '.github', 'PULL_REQUEST_TEMPLATE', 'b.md'), '## B\n')
    writeFileSync(join(r, '.github', 'PULL_REQUEST_TEMPLATE', 'a.md'), '## A\n')
    expect(await prTemplate(r)).toBe('## A\n')
    writeFileSync(join(r, '.github', 'pull_request_template.md'), '## Summary\n\n## Testing\n')
    expect(await prTemplate(r)).toBe('## Summary\n\n## Testing\n')
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

describe('closing a task whose pull request was merged on GitHub', () => {
  // origin (bare), the user's clone with the task's worktree pushed, and GitHub's
  // side: the PR squash-merged into main and its branch deleted, then a fetch --prune.
  function mergedOnGitHub(): { r: string; wt: string } {
    const origin = join(dir, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    const r = repo()
    git(r, 'remote', 'add', 'origin', origin)
    git(r, 'push', '-q', '-u', 'origin', 'main')
    const wt = join(dir, 'wt')
    git(r, 'worktree', 'add', '-q', '-b', 'feature', wt)
    writeFileSync(join(wt, 'a.txt'), 'one\ntwo\nthree\n')
    git(wt, 'commit', '-qam', 'three')
    writeFileSync(join(wt, 'b.txt'), 'new\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'b')
    git(wt, 'push', '-q', '-u', 'origin', 'feature')
    const site = join(dir, 'site')
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', origin, site])
    git(site, 'merge', '-q', '--squash', 'origin/feature')
    git(site, 'commit', '-qm', 'Feature (#7)')
    git(site, 'push', '-q', 'origin', 'main')
    git(site, 'push', '-q', 'origin', '--delete', 'feature')
    git(r, 'fetch', '-q', '--prune', 'origin')
    return { r, wt }
  }

  it("finishes: nothing is lost though origin/feature is gone and main doesn't have the commits", async () => {
    const { r, wt } = mergedOnGitHub()
    expect(await closeCheck(wt, 'feature', 'main')).toBeNull()
    await closeWithPr(r, wt, 'feature', 'main', true)
    expect(existsSync(wt)).toBe(false)
    expect(git(r, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(git(r, 'branch', '--list', 'feature')).toBe('')
  })

  it("refuses while there's a commit made after the merge (it's nowhere else)", async () => {
    const { r, wt } = mergedOnGitHub()
    writeFileSync(join(wt, 'c.txt'), 'later\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'later')
    expect(await closeCheck(wt, 'feature', 'main')).toMatch(/1 commit isn't in the pull request/)
    await expect(closeWithPr(r, wt, 'feature', 'main', true)).rejects.toThrow(/push it first/)
    expect(existsSync(join(wt, 'c.txt'))).toBe(true)
  })

  it('finishes a task whose worktree folder is already gone', async () => {
    const { r, wt } = mergedOnGitHub()
    rmSync(wt, { recursive: true, force: true })
    expect(await closeCheck(wt, 'feature', 'main')).toBeNull()
    await closeWithPr(r, wt, 'feature', 'main', true)
    expect(git(r, 'worktree', 'list').split('\n')).toHaveLength(1)
  })
})

describe('commitsAfter (what a pull request is missing)', () => {
  it("is 0 at or behind the PR's head, and counts the commits made after it", async () => {
    const r = repo()
    const head = git(r, 'rev-parse', 'HEAD')
    expect(await commitsAfter(r, head)).toBe(0)
    writeFileSync(join(r, 'later.txt'), 'later\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'after the PR')
    expect(await commitsAfter(r, head)).toBe(1)
    git(r, 'reset', '-q', '--hard', head)
    expect(await commitsAfter(r, head)).toBe(0)
    expect(await commitsAfter(r, 'f'.repeat(40))).toBeNull()
  })
})

describe('merging a finished task', () => {
  const setup = (): { r: string; wt: string } => {
    const r = repo()
    const wt = join(dir, 'task-wt')
    git(r, 'worktree', 'add', '-q', '-b', 'task', wt)
    return { r, wt }
  }
  const mainMovesOn = (r: string): void => {
    writeFileSync(join(r, 'm.txt'), 'main\n')
    git(r, 'add', '-A')
    git(r, 'commit', '-qm', 'main moves on')
  }

  it('makes no merge commit for a branch with no work of its own', async () => {
    const { r, wt } = setup()
    mainMovesOn(r)
    const before = git(r, 'rev-parse', 'main')
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: false })
    expect(git(r, 'rev-parse', 'main')).toBe(before)
    expect(existsSync(wt)).toBe(false)
  })

  it('makes no merge commit when the work is in main already (squashed there)', async () => {
    const { r, wt } = setup()
    writeFileSync(join(wt, 'a.txt'), 'one\ntwo\nthree\n')
    git(wt, 'commit', '-qam', 'three')
    git(r, 'merge', '-q', '--squash', 'task')
    git(r, 'commit', '-qm', 'Task (#1)')
    const before = git(r, 'rev-parse', 'main')
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: false })
    expect(git(r, 'rev-parse', 'main')).toBe(before)
    expect(git(r, 'branch', '--list', 'task')).toBe('')
  })

  it('still merges real work', async () => {
    const { r, wt } = setup()
    writeFileSync(join(wt, 'n.txt'), 'new\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'work')
    mainMovesOn(r)
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: true })
    expect(readFileSync(join(r, 'n.txt'), 'utf-8')).toBe('new\n')
  })

  it('finishes a task whose worktree folder was deleted - its committed work is merged', async () => {
    const { r, wt } = setup()
    writeFileSync(join(wt, 'n.txt'), 'new\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'work')
    rmSync(wt, { recursive: true, force: true })
    expect(await branchLeft(r, 'task', 'main')).toBe(1)
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: true })
    expect(readFileSync(join(r, 'n.txt'), 'utf-8')).toBe('new\n')
    expect(git(r, 'worktree', 'list')).not.toContain('task-wt')
  })

  it('keeps the branch when Settings say so (the worktree still goes)', async () => {
    const { r, wt } = setup()
    writeFileSync(join(wt, 'n.txt'), 'new\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'work')
    prefs.deleteBranchOnFinish = false
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: true })
    expect(existsSync(wt)).toBe(false)
    expect(git(r, 'branch', '--list', 'task')).toContain('task')
  })

  it('finishes a task whose worktree and branch are both gone', async () => {
    const { r, wt } = setup()
    rmSync(wt, { recursive: true, force: true })
    git(r, 'worktree', 'prune')
    git(r, 'branch', '-D', 'task')
    expect(await branchLeft(r, 'task', 'main')).toBe(null)
    expect(await mergeAndPrune(r, wt, 'task', 'main')).toEqual({ merged: false })
  })
})

describe('a task rebased onto origin while the local base lags', () => {
  it("shows only the task's own changes, not what main got meanwhile", async () => {
    const r = repo()
    const origin = join(dir, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    git(r, 'remote', 'add', 'origin', origin)
    git(r, 'push', '-q', '-u', 'origin', 'main')
    // Others push to main; this checkout's main doesn't pull them.
    const up = join(dir, 'up')
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', origin, up])
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(up, `up${i}.txt`), `${i}\n`)
      git(up, 'add', '-A')
      git(up, 'commit', '-qm', `up ${i}`)
    }
    git(up, 'push', '-q', 'origin', 'main')
    git(r, 'fetch', '-q', 'origin')
    // The task: one file, then git pull --rebase (onto origin/main).
    const wt = join(dir, 'task-wt')
    git(r, 'worktree', 'add', '-q', '-b', 'task', wt)
    writeFileSync(join(wt, 't.txt'), 'task\n')
    git(wt, 'add', '-A')
    git(wt, 'commit', '-qm', 'task')
    git(wt, 'rebase', '-q', 'origin/main')

    expect((await getDiffFiles(wt, 'main')).map((f) => f.path)).toEqual(['t.txt'])
    expect(await getWorktreeStatus(wt, 'main')).toMatchObject({ ahead: 1, behind: 0 })
  })
})
