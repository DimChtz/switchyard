import { describe, expect, it } from 'vitest'
import { matchSettings, type SettingEntry } from './settingsIndex'

const e = (page: string, group: string, label: string, sub = ''): SettingEntry => ({ section: page.toLowerCase(), page, group, label, sub })
const all = [
  e('Terminal & editor', 'Terminal', 'Font size', 'Of the terminals'),
  e('File editor', 'Text', 'Font size'),
  e('General', 'Notifications', 'Play a sound', 'When an agent waits for you'),
  e('General', 'Startup', 'Open on launch', 'The font of nothing in particular')
]

describe('matchSettings', () => {
  it('finds a setting by its name, every word', () => {
    expect(matchSettings(all, 'font size').map((s) => s.page)).toEqual(['Terminal & editor', 'File editor'])
  })
  it('by its group and name together', () => {
    expect(matchSettings(all, 'notification sound').map((s) => s.label)).toEqual(['Play a sound'])
  })
  it('names before descriptions', () => {
    expect(matchSettings(all, 'font').map((s) => s.label)).toEqual(['Font size', 'Font size', 'Open on launch'])
  })
  it('nothing for nothing', () => {
    expect(matchSettings(all, '  ')).toEqual([])
    expect(matchSettings(all, 'zzzz')).toEqual([])
  })
})
