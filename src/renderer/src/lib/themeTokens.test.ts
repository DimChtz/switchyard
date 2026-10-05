import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { THEME_TOKENS } from '@shared/themes'

// The page's colors come from the theme: a hex color in the code would stay
// the same in every theme (say, dark text on the light theme).
const ROOT = join(__dirname, '..')
// Language badges keep their brand colors in every theme.
// Colors drawn into the previewed page and its screenshot (not the app's), and languages' own colors.
const ALLOWED = new Set(['lib/fileLang.ts', 'lib/elementPicker.ts', 'screens/workspace/PointAndFix.tsx'])
const OTHER_VARS = new Set(['font-ui', 'font-mono'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx|css)$/.test(n) && !n.endsWith('.test.ts') ? [p] : []
  })
}

describe('theme tokens', () => {
  const files = sources(ROOT).map((p) => ({ rel: relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf-8') }))

  it('no hardcoded colors outside the theme', () => {
    const found = files
      .filter((f) => !ALLOWED.has(f.rel) && f.rel !== 'tokens.css')
      .flatMap((f) => [...f.text.matchAll(/#[0-9A-Fa-f]{6}\b|rgba?\(\s*\d+\s*,/g)].map((m) => `${f.rel}: ${m[0]}`))
    expect(found).toEqual([])
  })

  it('every CSS variable used is a theme token', () => {
    const unknown = files.flatMap((f) => [...f.text.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]).filter((v) => !(v in THEME_TOKENS) && !OTHER_VARS.has(v)).map((v) => `${f.rel}: --${v}`))
    expect([...new Set(unknown)]).toEqual([])
  })
})
