import { afterAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./store', () => ({ getCheckpoints: () => [], setCheckpoints: () => {}, getPrefs: () => ({}), getProjects: () => [], getTasks: () => [] }))

import { dropRefs, snapshotCommit } from './checkpoints'

const root = mkdtempSync(join(tmpdir(), 'switchyard-snap-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'pipe' }).toString()

describe('snapshotCommit', () => {
  it('keeps an edit made in the same second the index was written (same size, same time)', async () => {
    git('init', '-q', '-b', 'main')
    git('config', 'core.autocrlf', 'false')
    // The file's change time doesn't count (as on Linux within a second): size and modified time are all git has to go on.
    git('config', 'core.trustctime', 'false')
    const file = join(root, 'b.ts')
    // A whole second, so every file system keeps it exactly.
    const t = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
    writeFileSync(file, 'export const b = 1\n')
    utimesSync(file, t, t)
    git('add', '-A')
    git('commit', '-qm', 'init')
    // Same size, and dated like the old content and the index itself: only its content says it changed.
    writeFileSync(file, 'export const b = 2\n')
    utimesSync(file, t, t)
    utimesSync(join(root, '.git', 'index'), t, t)

    const snap = await snapshotCommit(root, 'test')
    expect(git('show', `${snap.sha}:b.ts`)).toBe('export const b = 2\n')
  })
})

describe('dropRefs', () => {
  it("deletes a repository's checkpoint refs in one go - packed or loose, and some already gone", async () => {
    const head = git('rev-parse', 'HEAD').trim()
    for (let i = 0; i < 30; i++) git('update-ref', `refs/switchyard/cp/T-1/${i}`, head)
    // Some packed (as git's housekeeping leaves them), some loose.
    git('pack-refs', '--all')
    for (let i = 30; i < 40; i++) git('update-ref', `refs/switchyard/cp/T-1/${i}`, head)
    const gitDir = join(root, '.git')
    await dropRefs(Array.from({ length: 40 }, (_, i) => ({ gitDir, ref: `refs/switchyard/cp/T-1/${i}` })))
    expect(git('for-each-ref', 'refs/switchyard').trim()).toBe('')
    // One that isn't there (deleted already) doesn't keep the others.
    git('update-ref', 'refs/switchyard/cp/T-2/a', head)
    await dropRefs([{ gitDir, ref: 'refs/switchyard/cp/T-2/gone' }, { gitDir, ref: 'refs/switchyard/cp/T-2/a' }])
    expect(git('for-each-ref', 'refs/switchyard').trim()).toBe('')
  })
})
