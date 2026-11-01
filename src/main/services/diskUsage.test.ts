import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({ projects: [] as { id: string; repoPath: string }[], tasks: [] as { worktreePath?: string; taskDir?: string }[], prefs: { worktreeRoot: '', lowDiskGb: 10 } }))
vi.mock('./store', () => ({ getPrefs: () => state.prefs, getProjects: () => state.projects, getTasks: () => state.tasks }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('./windows', () => ({ mainWindow: () => null }))
vi.mock('electron', () => ({ shell: {}, BrowserWindow: { getAllWindows: () => [] } }))

import { clearGenerated, deleteLeftover, leftoverFolders, measureWorktree } from './diskUsage'
import { formatBytes, generatedKind, idleForClearing } from '@shared/diskSpace'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const write = (p: string, bytes: number): void => {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, Buffer.alloc(bytes, 1))
}

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'sy-disk-'))
  git(d, 'init', '-q', '-b', 'main')
  writeFileSync(join(d, '.gitignore'), 'node_modules/\ndist/\n')
  write(join(d, 'vendor', 'lib.rb'), 100)
  git(d, 'add', '.')
  git(d, 'commit', '-qm', 'i')
  return d
}

describe('disk space', () => {
  it('names generated folders, sizes and idle worktrees', () => {
    expect(generatedKind('node_modules')).toBe('deps')
    expect(generatedKind('.next')).toBe('build')
    expect(generatedKind('__pycache__')).toBe('cache')
    expect(generatedKind('src')).toBeNull()
    expect(generatedKind('constructor')).toBeNull()
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB')
    expect(formatBytes(312_000_000)).toBe('312 MB')
    const now = Date.now()
    expect(idleForClearing(null)).toBe(true)
    expect(idleForClearing({ st: 'working', col: 'progress', lastActivityAt: 0 })).toBe(false)
    expect(idleForClearing({ st: 'idle', col: 'progress', lastActivityAt: now - 60_000 }, now)).toBe(false)
    expect(idleForClearing({ st: 'idle', col: 'progress', lastActivityAt: now - 4 * 86_400_000 }, now)).toBe(true)
    expect(idleForClearing({ st: null, col: 'parked', lastActivityAt: now }, now)).toBe(true)
    expect(idleForClearing({ st: 'idle', col: 'parked', queued: { at: 1 }, lastActivityAt: 0 }, now)).toBe(false)
  })

  it("measures a worktree: what git ignores is generated, a committed vendor/ is code - and clears only that", async () => {
    const d = repo()
    try {
      const wt = join(d, '.worktrees', 'task')
      git(d, 'worktree', 'add', '-q', '-b', 'task', wt)
      write(join(wt, 'node_modules', 'a', 'index.js'), 5000)
      write(join(wt, 'packages', 'ui', 'node_modules', 'b.js'), 3000)
      write(join(wt, 'dist', 'app.js'), 2000)
      const s = await measureWorktree(wt, true)
      expect(s.deps).toBeGreaterThanOrEqual(8000)
      expect(s.build).toBeGreaterThanOrEqual(2000)
      expect(s.generated.map((g) => g.rel).sort()).toEqual(['dist', 'node_modules', 'packages/ui/node_modules'])
      // vendor/ is committed: code, not dependencies.
      expect(s.generated.some((g) => g.rel === 'vendor')).toBe(false)
      expect(s.code).toBeGreaterThanOrEqual(100)
      // Not the committed folder, nor a path outside the worktree.
      await clearGenerated(wt, ['vendor', '../../x', ...s.generated.map((g) => g.rel)])
      expect(existsSync(join(wt, 'vendor', 'lib.rb'))).toBe(true)
      expect(existsSync(join(wt, 'node_modules'))).toBe(false)
      expect(existsSync(join(wt, 'packages', 'ui', 'node_modules'))).toBe(false)
      expect(existsSync(join(wt, 'dist'))).toBe(false)
      expect((await measureWorktree(wt)).generated).toEqual([])
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('finds folders git forgot in .worktrees - not live worktrees, task folders or repositories of their own', async () => {
    const d = repo()
    try {
      const live = join(d, '.worktrees', 'live')
      git(d, 'worktree', 'add', '-q', '-b', 'live', live)
      write(join(d, '.worktrees', 'gone', 'node_modules', 'x.js'), 4000)
      mkdirSync(join(d, '.worktrees', 'clone', '.git'), { recursive: true })
      mkdirSync(join(d, '.worktrees', '_multi', 'SY-1'), { recursive: true })
      mkdirSync(join(d, '.worktrees', '_multi', 'SY-2'), { recursive: true })
      state.projects = [{ id: 'p', repoPath: d }]
      state.tasks = [{ taskDir: join(d, '.worktrees', '_multi', 'SY-1') }]
      const found = await leftoverFolders()
      expect(found.map((f) => f.path.split(/[\\/]/).pop()).sort()).toEqual(['SY-2', 'gone'])
      expect(found.find((f) => f.path.endsWith('gone'))!.bytes).toBeGreaterThanOrEqual(4000)
      await deleteLeftover(join(d, '.worktrees', 'gone'))
      expect(existsSync(join(d, '.worktrees', 'gone'))).toBe(false)
      await expect(deleteLeftover(live)).rejects.toThrow(/not a folder left behind/)
      expect(existsSync(live)).toBe(true)
    } finally {
      state.projects = []
      state.tasks = []
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('never takes a repository for leftovers when the worktree root holds it', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sy-root-'))
    try {
      const d = join(parent, 'app')
      mkdirSync(d)
      git(d, 'init', '-q', '-b', 'main')
      write(join(d, 'src', 'a.ts'), 10)
      // The root is the repositories' parent: <root>/app is the repository itself.
      state.prefs.worktreeRoot = parent
      state.projects = [{ id: 'p', repoPath: d }]
      expect(await leftoverFolders()).toEqual([])
    } finally {
      state.prefs.worktreeRoot = ''
      state.projects = []
      rmSync(parent, { recursive: true, force: true })
    }
  })
})
