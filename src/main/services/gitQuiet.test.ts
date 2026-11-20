import { afterAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const agents = vi.hoisted(() => ({ at: [] as string[] }))
vi.mock('./agentStatus', () => ({ workingIn: () => agents.at }))
vi.mock('./store', () => ({ getPrefs: () => ({}), getProjects: () => [], getTasks: () => [] }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

import { housekeep, repoAtWork, whenQuiet } from './gitQuiet'

const root = mkdtempSync(join(tmpdir(), 'sy-quiet-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const repo = join(root, 'repo')
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString()

describe("Switchyard's git chores wait for a quiet moment", () => {
  it('knows when an agent is mid-turn in one of the repository’s worktrees', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    writeFileSync(join(repo, 'a.txt'), 'a')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'i')
    const wt = join(root, 'tasks', 'T-1', 'repo')
    git(repo, 'worktree', 'add', '-q', '-b', 't1', wt)

    agents.at = []
    expect(await repoAtWork(repo)).toBeNull()
    agents.at = [wt]
    expect(await repoAtWork(repo)).toMatch(/agent is at work/)
    // A task in several repositories: the agent works in the folder that holds them.
    agents.at = [join(root, 'tasks', 'T-1')]
    expect(await repoAtWork(repo)).toMatch(/agent is at work/)
    // An agent somewhere else entirely doesn't count.
    agents.at = [tmpdir()]
    expect(await repoAtWork(repo)).toBeNull()
  })

  it('waits until it is quiet - or gives up after a while', async () => {
    agents.at = [repo]
    expect(await whenQuiet(repo, 30, 10)).toBe(false)
    setTimeout(() => (agents.at = []), 20)
    expect(await whenQuiet(repo, 2000, 10)).toBe(true)
  })

  it("does git's housekeeping only when nobody is at work", async () => {
    agents.at = [repo]
    expect(await housekeep(repo)).toBe(false)
    agents.at = []
    expect(await housekeep(repo)).toBe(true)
  })
})
