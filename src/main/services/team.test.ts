import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task, TeamMessage } from '@shared/types'

const data = vi.hoisted(() => ({
  team: [] as TeamMessage[],
  delivered: [] as { to: string; text: string }[],
  ready: new Set<string>(),
  introduce: true
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./store', () => ({
  getTeam: () => data.team,
  setTeam: (m: TeamMessage[]) => (data.team = m),
  getPrefs: () => ({ teamIntroduce: data.introduce }),
  getTasks: () =>
    [
      { id: 'A-1', key: 'A-1', title: 'Parser', agentKind: 'claude', col: 'progress', branch: 'a-1' },
      { id: 'A-2', key: 'A-2', title: 'Lexer', agentKind: 'codex', col: 'progress', branch: 'a-2' },
      { id: 'A-3', key: 'A-3', title: 'Idle', agentKind: null, col: 'backlog' }
    ] as unknown as Task[]
}))
vi.mock('./inbox', () => ({
  deliver: (to: string, text: string, done?: () => void) => {
    if (!data.ready.has(to)) return 'queued'
    data.delivered.push({ to, text })
    done?.()
    return 'now'
  }
}))

import { introduce, readFor, release, send } from './team'

beforeEach(() => {
  data.team = []
  data.delivered = []
  data.ready = new Set()
})

describe('team channel', () => {
  it('delivers to an agent between turns, queues for a busy one, says who it is from', () => {
    data.ready.add('A-2')
    const m = send('A-1', 'a-2', 'I am renaming parse() to parseAll()')
    expect(m.state).toBe('delivered')
    expect(data.delivered[0].text).toContain('from the agent on A-1 "Parser" (Claude Code, branch a-1)')
    expect(data.delivered[0].text).toContain('to: "A-1"')
    expect(send('user', 'A-1', 'Please wait for A-2').state).toBe('queued')
    expect(() => send('A-1', 'A-3', 'hi')).toThrow('has no agent')
    expect(() => send('A-1', 'A-1', 'hi')).toThrow('your own task')
  })

  it('holds a back-and-forth between two agents after 8 in an hour; you can let one through', () => {
    for (let i = 0; i < 8; i++) send(i % 2 ? 'A-2' : 'A-1', i % 2 ? 'A-1' : 'A-2', `msg ${i}`)
    const held = send('A-1', 'A-2', 'one more')
    expect(held.state).toBe('held')
    // You and Switchyard are never held.
    expect(send('user', 'A-2', 'stop').state).toBe('queued')
    data.ready.add('A-2')
    release(held.id)
    expect(data.team.find((m) => m.id === held.id)?.state).toBe('delivered')
  })

  it('reading marks what was waiting as read', () => {
    send('A-2', 'A-1', 'hello')
    expect(readFor('A-1').map((m) => m.text)).toEqual(['hello'])
    expect(data.team[0].state).toBe('read')
  })

  it('introduces two agents whose changes clash, once', () => {
    const pair = { repoId: 'r', a: 'A-1', b: 'A-2', files: ['src/x.ts'], conflicts: ['src/x.ts'] }
    introduce([pair, { ...pair, b: null }])
    introduce([pair])
    expect(data.team.map((m) => [m.from, m.to])).toEqual([
      ['switchyard', 'A-1'],
      ['switchyard', 'A-2']
    ])
    expect(data.team[0].text).toContain('A-2 "Lexer" (Codex, branch a-2)')
  })
})
