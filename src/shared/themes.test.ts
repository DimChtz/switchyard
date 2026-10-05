import { describe, expect, it } from 'vitest'
import { THEME_TOKENS, pickTheme, resolveThemes, themeToFile } from './themes'

const file = (name: string, data: unknown) => ({ file: `${name}.json`, name, data })

describe('themes', () => {
  it('ships dark, light and retro, each with every token', () => {
    const { themes, problems } = resolveThemes([])
    expect(themes.map((t) => t.id)).toEqual(['dark', 'light', 'retro'])
    expect(problems).toEqual([])
    for (const t of themes) expect(Object.keys(t.colors).sort()).toEqual(Object.keys(THEME_TOKENS).sort())
    const retro = themes.find((t) => t.id === 'retro')!
    // Its font ships with the app: nothing to load from the network.
    expect([retro.effects.scanlines, retro.fonts.load, retro.fonts.mono.startsWith("'IBM Plex Mono'")]).toEqual([true, [], true])
  })

  it('a file adds a theme, starting from dark or light by its type', () => {
    const { themes } = resolveThemes([file('paper', { name: 'Paper', type: 'light', colors: { 'bg-app': '#fffef0' } })])
    const t = themes.find((x) => x.id === 'paper')!
    const light = themes.find((x) => x.id === 'light')!
    expect([t.name, t.type, t.source, t.colors['bg-app'], t.colors.t1]).toEqual(['Paper', 'light', 'user', '#fffef0', light.colors.t1])
  })

  it('a file with a built-in id changes just what it lists', () => {
    const { themes } = resolveThemes([file('my-dark', { id: 'dark', colors: { 'c-blue': '#ff8a5b' } })])
    const dark = themes.find((x) => x.id === 'dark')!
    expect([themes.length, dark.name, dark.source, dark.colors['c-blue'], dark.colors['bg-app']]).toEqual([3, 'Dark', 'override', '#ff8a5b', '#0F1012'])
  })

  it('extends another file, and reports what is wrong without dropping the rest', () => {
    const { themes, problems } = resolveThemes([
      file('base', { colors: { 'bg-app': '#101010' } }),
      file('child', { extends: 'base', colors: { t1: '#fafafa', nope: '#000', 'c-red': 'red; background: url(x)' } }),
      file('lost', { extends: 'missing' }),
      { file: 'broken.json', name: 'broken', error: 'Unexpected token } in JSON at position 12' }
    ])
    const child = themes.find((x) => x.id === 'child')!
    expect([child.colors['bg-app'], child.colors.t1, child.colors['c-red']]).toEqual(['#101010', '#fafafa', '#E86A5F'])
    expect(themes.some((x) => x.id === 'lost')).toBe(true)
    expect(problems).toEqual([
      'broken.json: Unexpected token } in JSON at position 12',
      'child.json: unknown color "nope"',
      'child.json: "c-red" isn\'t a color (red; background: url(x))',
      'lost.json: "extends" names a theme that isn\'t there (missing)'
    ])
  })

  it('catches a circle of extends', () => {
    const { problems } = resolveThemes([file('a', { extends: 'b' }), file('b', { extends: 'a' })])
    expect(problems.some((p) => p.includes('circle'))).toBe(true)
  })

  it('"system" follows the OS; an unknown id falls back to dark', () => {
    const { themes } = resolveThemes([])
    expect(pickTheme(themes, 'system', false).id).toBe('light')
    expect(pickTheme(themes, 'system', true).id).toBe('dark')
    expect(pickTheme(themes, 'gone', true).id).toBe('dark')
  })

  it('a duplicate spells every value out', () => {
    const { themes } = resolveThemes([])
    const f = themeToFile(themes[2], 'my-retro', 'My Retro')
    expect([f.id, f.type, Object.keys(f.colors!).length, f.effects?.scanlines]).toEqual(['my-retro', 'dark', Object.keys(THEME_TOKENS).length, true])
  })
})
