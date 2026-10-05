import { afterAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Project, Task } from '@shared/types'

const data = vi.hoisted(() => ({ projects: [] as Project[], tasks: [] as Task[] }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./store', () => ({ getProjects: () => data.projects, getTasks: () => data.tasks, getPrefs: () => ({ worktreeRoot: '', syncMode: 'rebase' }) }))

import { claudeProjectDir, scan } from './outside'

const root = mkdtempSync(join(tmpdir(), 'switchyard-outside-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const write = (dir: string, file: string, text: string): void => {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), text)
}

// A repository: a worktree a task holds, one nothing holds (with a Claude Code conversation in it),
// a branch with commits of its own, one without, and conversations in the main checkout.
const repo = join(root, 'app')
mkdirSync(repo)
git(repo, 'init', '-q', '-b', 'main')
git(repo, 'config', 'user.email', 't@t')
git(repo, 'config', 'user.name', 't')
write(repo, 'a.ts', 'a\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-qm', 'init')
const held = join(root, 'held')
git(repo, 'worktree', 'add', '-q', held, '-b', 'held')
const loose = join(root, 'loose')
git(repo, 'worktree', 'add', '-q', loose, '-b', 'feature/loose')
write(loose, 'b.ts', 'b\n')
git(loose, 'add', '-A')
git(loose, 'commit', '-qm', 'Add b')
write(loose, 'c.ts', 'not committed\n')
git(repo, 'branch', 'feature/side')
git(repo, 'checkout', '-q', 'feature/side')
write(repo, 'side.ts', 's\n')
git(repo, 'add', '-A')
git(repo, 'commit', '-qm', 'Side work')
git(repo, 'checkout', '-q', 'main')
git(repo, 'branch', 'empty')

const claude = join(root, 'claude-home')
const codex = join(root, 'codex-home')
process.env.CLAUDE_CONFIG_DIR = claude
process.env.CODEX_HOME = codex
const line = (o: unknown): string => JSON.stringify(o)
const claudeSession = (cwd: string, id: string, ask: string, answer: string): void => {
  const dir = join(claude, 'projects', claudeProjectDir(cwd))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${id}.jsonl`),
    [
      line({ type: 'user', sessionId: id, cwd, gitBranch: 'feature/loose', message: { role: 'user', content: '<command-name>/clear</command-name>' }, isMeta: true }),
      line({ type: 'user', sessionId: id, cwd, message: { role: 'user', content: ask } }),
      line({ type: 'assistant', sessionId: id, cwd, message: { role: 'assistant', content: [{ type: 'text', text: answer }] } })
    ].join('\n') + '\n'
  )
}
claudeSession(loose, 'sess-loose', 'Add a b module', 'Added b.ts.')
claudeSession(repo, 'sess-main', 'Why is the login slow?', 'The session lookup runs twice.')
claudeSession(repo, 'sess-taken', 'Old one', 'Already a task.')
const d = new Date()
const day = join(codex, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
mkdirSync(day, { recursive: true })
writeFileSync(
  join(day, 'rollout-1.jsonl'),
  [
    line({ type: 'session_meta', payload: { id: 'codex-1', cwd: repo, git: { branch: 'main' } } }),
    line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }] } }),
    line({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the config loader' }] } }),
    line({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed it to loadConfig.' }] } })
  ].join('\n') + '\n'
)

describe('outside work', () => {
  it('finds worktrees, branches and conversations no task holds', async () => {
    data.projects = [{ id: 'app', name: 'app', repoPath: repo, defaultBranch: 'main' } as Project]
    data.tasks = [{ id: 'T-1', key: 'T-1', projectId: 'app', col: 'progress', worktreePath: held, branch: 'held', session: { id: 'sess-taken', transcript: '' } } as unknown as Task]
    const items = await scan('app')
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(Object.keys(byId).sort()).toEqual(['br:app:feature/side', `cs:codex-1`, 'cs:sess-main', `wt:${git(loose, 'rev-parse', '--show-toplevel').trim()}`].sort())

    const wt = items.find((i) => i.kind === 'worktree')!
    expect(wt).toMatchObject({ branch: 'feature/loose', ahead: 1, dirty: 1, subject: 'Add b' })
    expect(wt.sessions.map((s) => [s.agentKind, s.id, s.first, s.last])).toEqual([['claude', 'sess-loose', 'Add a b module', 'Added b.ts.']])

    expect(byId['br:app:feature/side']).toMatchObject({ kind: 'branch', ahead: 1, subject: 'Side work' })
    expect(byId['cs:sess-main'].sessions[0]).toMatchObject({ first: 'Why is the login slow?', last: 'The session lookup runs twice.' })
    expect(byId['cs:codex-1'].sessions[0]).toMatchObject({ agentKind: 'codex', first: 'Rename the config loader', last: 'Renamed it to loadConfig.', branch: 'main' })
  })
})
