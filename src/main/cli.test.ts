import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = mkdtempSync(join(tmpdir(), 'sy-cli-'))
const api = join(root, 'api')
const wt = join(root, 'wt', 'API-3')
mkdirSync(join(api, 'src'), { recursive: true })
mkdirSync(wt, { recursive: true })

vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: () => {} } }))
vi.mock('./services/log', () => ({ log: { info: () => {}, warn: () => {} } }))
vi.mock('./services/store', () => ({
  getProjects: () => [
    { id: 'api', name: 'API', repoPath: api },
    { id: 'web', name: 'web', repoPath: join(root, 'web') }
  ],
  getTasks: () => [{ id: 'API-3', projectId: 'api', worktreePath: wt }]
}))

import { parseArgs } from './cli'

describe('switchyard new', () => {
  it('takes the title, its options, and the project the command runs in', () => {
    expect(parseArgs(['C:\\Switchyard\\switchyard.exe', 'new', 'Fix', 'the', 'login', '--agent', 'claude', '--start'], join(api, 'src'))).toEqual({
      title: 'Fix the login',
      desc: '',
      agent: 'claude',
      start: true,
      projectId: 'api'
    })
  })

  it('finds the project from a task worktree, or by name - and --x=y works too', () => {
    expect(parseArgs(['sw', 'new', 'Polish', '--desc=More padding'], wt)).toMatchObject({ title: 'Polish', desc: 'More padding', projectId: 'api', agent: null, start: false })
    expect(parseArgs(['sw', 'new', 'Hi', '--project', 'WEB'], tmpdir())?.projectId).toBe('web')
    expect(parseArgs(['sw', 'new', 'Hi'], tmpdir())?.projectId).toBe(null)
  })

  it('skips electron’s own arguments, and asks for nothing without a title', () => {
    expect(parseArgs(['electron', '.', '--inspect', 'new', 'x'], '')?.title).toBe('x')
    expect(parseArgs(['sw', 'new'], '')).toBe(null)
    expect(parseArgs(['sw'], '')).toBe(null)
  })

  it('reads switchyard:// links', () => {
    expect(parseArgs(['sw', 'switchyard://new?title=Fix%20it&agent=codex&start=1&project=api'], '')).toEqual({ title: 'Fix it', desc: '', agent: 'codex', start: true, projectId: 'api' })
    expect(parseArgs(['switchyard://new?agent=codex'], '')).toBe(null)
    expect(parseArgs(['switchyard://other?title=x'], '')).toBe(null)
  })
})
