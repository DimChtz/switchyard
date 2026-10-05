import { describe, expect, it } from 'vitest'
import { checkManifest, cleanBadges } from './plugins'
import { AGENTS, setPluginAgents } from './constants'
import { readBindings } from './keybindings'

const ok = { id: 'hello', name: 'Hello', version: '1.0.0', main: 'main.js' }

describe('plugin.json', () => {
  it('takes a good one, with its commands and agents', () => {
    const r = checkManifest({ ...ok, commands: [{ id: 'say-hi', title: 'Say hi', key: 'ctrl+alt+h' }], agents: [{ kind: 'goose', name: 'Goose', bin: 'goose', resumeArgs: ['session', '--resume'] }] }, 'hello')
    expect('manifest' in r && r.manifest.commands).toEqual([{ id: 'say-hi', title: 'Say hi', key: 'ctrl+alt+h', when: undefined }])
    expect('manifest' in r && r.manifest.agents?.[0]).toMatchObject({ kind: 'goose', bin: 'goose', short: 'goose', note: 'From the Hello plugin' })
  })

  it('says what is wrong', () => {
    const err = (raw: unknown, folder = 'hello'): string => {
      const r = checkManifest(raw, folder)
      return 'error' in r ? r.error : ''
    }
    expect(err({ ...ok, id: 'Hello' }, 'Hello')).toMatch(/lowercase/)
    expect(err(ok, 'other')).toMatch(/match its folder/)
    expect(err({ ...ok, main: '../evil.js' })).toMatch(/inside the plugin/)
    expect(err({ ...ok, main: 'C:\\evil.js' })).toMatch(/inside the plugin/)
    expect(err({ ...ok, main: undefined })).toMatch(/neither/)
    expect(err({ ...ok, commands: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] })).toMatch(/twice/)
    expect(err({ ...ok, agents: [{ kind: 'claude', name: 'Mine', bin: 'x' }] })).toMatch(/built in/)
    // A program name only - nothing a shell would read as more.
    expect(err({ ...ok, agents: [{ kind: 'x', name: 'X', bin: 'x & del *' }] })).toMatch(/program's name/)
    expect(err([])).toMatch(/object/)
  })

  it('cleans badges: text kept short, odd tones made "info", at most three', () => {
    expect(cleanBadges([{ text: '  3d ', tone: 'warn' }, { text: '' }, { text: 'x'.repeat(40), tone: 'neon' }, { text: 'a' }, { text: 'b' }])).toEqual([
      { text: '3d', tone: 'warn', tooltip: undefined },
      { text: 'x'.repeat(24), tone: 'info', tooltip: undefined },
      { text: 'a', tone: 'info', tooltip: undefined }
    ])
    expect(cleanBadges('nope')).toBeNull()
  })

  it("adds plugins' agents after the built-in ones, replacing the last set", () => {
    const builtIn = AGENTS.length
    setPluginAgents([{ kind: 'goose', name: 'Goose', short: 'goose', bin: 'goose', note: '', plugin: 'p' }, { kind: 'claude', name: 'Fake', short: 'c', bin: 'x', note: '' }])
    expect(AGENTS.length).toBe(builtIn + 1)
    expect(AGENTS[builtIn].kind).toBe('goose')
    setPluginAgents([])
    expect(AGENTS.length).toBe(builtIn)
  })

  it("keeps a plugin command's key in keybindings.json, even while the plugin is off", () => {
    const r = readBindings([{ key: 'ctrl+alt+h', command: 'hello.say-hi' }, { key: 'ctrl+alt+j', command: 'nonsense' }], [])
    expect(r.bindings).toEqual([{ key: 'ctrl+alt+h', command: 'hello.say-hi' }])
    expect(r.problems).toHaveLength(1)
  })
})
