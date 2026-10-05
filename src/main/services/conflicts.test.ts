import { afterAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Project, Task } from '@shared/types'

const data = vi.hoisted(() => ({ projects: [] as Project[], tasks: [] as Task[] }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./store', () => ({ getProjects: () => data.projects, getTasks: () => data.tasks, getCheckpoints: () => [], setCheckpoints: () => {}, getPrefs: () => ({ teamIntroduce: false }), getTeam: () => [], setTeam: () => {} }))

import { preview, scan } from './conflicts'

const root = mkdtempSync(join(tmpdir(), 'switchyard-conflicts-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const write = (dir: string, file: string, text: string): void => {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), text)
}

// A repository, main with three files; three tasks in worktrees.
const repo = join(root, 'app')
mkdirSync(repo)
git(repo, 'init', '-q', '-b', 'main')
git(repo, 'config', 'user.email', 't@t')
git(repo, 'config', 'user.name', 't')
git(repo, 'config', 'core.autocrlf', 'false')
write(repo, 'src/a.ts', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n')
write(repo, 'src/b.ts', 'export const b = 1\n')
write(repo, 'src/c.ts', 'export const c = 1\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-qm', 'init')
const wt = (key: string): string => {
  const p = join(root, key)
  git(repo, 'worktree', 'add', '-q', p, '-b', key.toLowerCase())
  return p
}
const task = (key: string, path: string): Task => ({ id: key, key, projectId: 'app', title: key, col: 'progress', worktreePath: path, branch: key.toLowerCase(), taskDir: null }) as unknown as Task

describe('conflict radar', () => {
  it('tells overlapping files that merge from ones that clash - uncommitted changes too - and a base that moved on', async () => {
    const one = wt('T-1')
    const two = wt('T-2')
    const three = wt('T-3')
    // T-1 and T-2 change a.ts far apart (merges), and b.ts the same line differently (clashes, uncommitted).
    write(one, 'src/a.ts', 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n')
    git(one, 'commit', '-qam', 'a')
    write(two, 'src/a.ts', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\nEIGHT\n')
    write(one, 'src/b.ts', 'export const b = 2\n')
    write(two, 'src/b.ts', 'export const b = 3\n')
    // T-3 only touches c.ts - which main then changes too.
    write(three, 'src/c.ts', 'export const c = 3\n')
    write(repo, 'src/c.ts', 'export const c = 99\n')
    git(repo, 'commit', '-qam', 'c on main')
    data.projects = [{ id: 'app', name: 'app', repoPath: repo, defaultBranch: 'main' } as Project]
    data.tasks = [task('T-1', one), task('T-2', two), task('T-3', three)]

    const r = await scan()
    const pairs = r.pairs.map((p) => [p.a, p.b, p.files.join(','), p.conflicts.join(',')])
    expect(pairs).toEqual([
      ['T-1', 'T-2', 'src/a.ts,src/b.ts', 'src/b.ts'],
      ['T-3', null, 'src/c.ts', 'src/c.ts']
    ])
    // Nothing in the worktrees changed: T-2's edit is still uncommitted, nothing staged.
    expect(git(two, 'status', '--short').split('\n').filter(Boolean).sort()).toEqual([' M src/a.ts', ' M src/b.ts'])

    const merged = await preview('app', 'T-1', 'T-2', 'src/b.ts')
    expect(merged).toMatch(/<<<<<<< T-1\nexport const b = 2\n=======\nexport const b = 3\n>>>>>>> T-2/)
  }, 30_000)
})
