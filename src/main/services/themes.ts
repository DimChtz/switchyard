import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { watch, type FSWatcher } from 'chokidar'
import { THEME_TOKENS, pickTheme, resolveThemes, themeToFile, type Theme, type UserThemeFile } from '@shared/themes'
import type { ThemesState } from '@shared/types'
import { getPrefs } from './store'

/**
 * Themes the user adds or changes: JSON files (comments allowed) in the
 * themes folder next to settings.json. Edits there apply at once.
 */

export function themesDir(): string {
  return join(app.getPath('userData'), 'themes')
}

function readFiles(): UserThemeFile[] {
  let names: string[]
  try {
    names = readdirSync(themesDir()).filter((n) => n.toLowerCase().endsWith('.json'))
  } catch {
    return []
  }
  return names.sort().map((n): UserThemeFile => {
    const file = join(themesDir(), n)
    const name = n.slice(0, -5)
    try {
      const text = readFileSync(file, 'utf-8')
      const errors: ParseError[] = []
      const data = parse(text, errors, { allowTrailingComma: true })
      if (errors.length) return { file: n, name, error: `isn't valid JSON - ${printParseErrorCode(errors[0].error)} at line ${text.slice(0, errors[0].offset).split('\n').length}` }
      return { file: n, name, data }
    } catch (err) {
      return { file: n, name, error: (err as Error).message }
    }
  })
}

let state: ThemesState | null = null

export function getThemes(): ThemesState {
  if (!state) state = { ...resolveThemes(readFiles()), dir: themesDir() }
  return state
}

/** The theme the window opens with (before the page applies it): for its background and title bar. */
export function startupTheme(): Theme {
  const pref = getPrefs().theme || 'dark'
  if (pref === 'system') nativeTheme.themeSource = 'system'
  const t = pickTheme(getThemes().themes, pref, nativeTheme.shouldUseDarkColors)
  if (pref !== 'system') nativeTheme.themeSource = t.type
  return t
}

/** The window's own parts follow the theme: its background, the title bar buttons, native menus and scrollbars. */
export function applyChrome(win: BrowserWindow | null, c: { type: 'dark' | 'light'; system: boolean; background: string; chrome: string; symbols: string }): void {
  nativeTheme.themeSource = c.system ? 'system' : c.type
  if (!win || win.isDestroyed()) return
  try {
    win.setBackgroundColor(c.background)
  } catch {
    // not a color Electron reads (e.g. color-mix): keep the last one
  }
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: c.chrome, symbolColor: c.symbols, height: 36 })
    } catch {
      // no overlay on this window
    }
  }
}

let watcher: FSWatcher | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/** Changes in the themes folder reach the page at once. */
export function watchThemes(): void {
  watcher?.close()
  mkdirSync(themesDir(), { recursive: true })
  ensureReadme()
  watcher = watch(themesDir(), { depth: 0, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 } })
  watcher.on('all', (_ev, path) => {
    if (!basename(path).toLowerCase().endsWith('.json')) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      state = null
      const s = getThemes()
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('themes:changed', s)
    }, 80)
  })
}

function freeFile(base: string): string {
  let name = `${base}.json`
  for (let i = 2; existsSync(join(themesDir(), name)); i++) name = `${base}-${i}.json`
  return join(themesDir(), name)
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'theme'
  )
}

const HEADER = '// A Switchyard theme. Every color is a token; see README.md in this folder for what each one colors.\n// Save to apply. Leave tokens out to keep the values of the theme it extends.\n'

/** A copy of a theme as a new file, every value spelled out, to edit. Resolves with the file. */
export function duplicateTheme(t: Theme, name: string): string {
  mkdirSync(themesDir(), { recursive: true })
  const id = slug(name)
  const path = freeFile(id)
  const f = themeToFile(t, basename(path, '.json'), name)
  writeFileSync(path, HEADER + JSON.stringify(f, null, 2) + '\n', 'utf-8')
  state = null
  return path
}

/** Asks for theme files and copies them into the folder. Resolves with how many, or null when cancelled. */
export async function importThemes(win: BrowserWindow | null): Promise<{ count: number; problems: string[] } | null> {
  const opts: Electron.OpenDialogOptions = { title: 'Install themes', buttonLabel: 'Install', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Switchyard themes', extensions: ['json'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths.length) return null
  mkdirSync(themesDir(), { recursive: true })
  const problems: string[] = []
  let count = 0
  for (const src of res.filePaths) {
    const text = readFileSync(src, 'utf-8')
    const errors: ParseError[] = []
    const data = parse(text, errors, { allowTrailingComma: true })
    if (errors.length || !data || typeof data !== 'object' || !('colors' in data)) {
      problems.push(`${basename(src)}: not a theme file`)
      continue
    }
    writeFileSync(freeFile(slug(basename(src, '.json'))), text, 'utf-8')
    count++
  }
  state = null
  return { count, problems }
}

/** README.md in the folder: how themes work, and every token. */
function ensureReadme(): void {
  const path = join(themesDir(), 'README.md')
  const rows = Object.entries(THEME_TOKENS)
    .map(([k, v]) => `| \`${k}\` | ${v} |`)
    .join('\n')
  const text = `# Switchyard themes

Each \`.json\` file here is a theme (comments are allowed). Save a file and the app picks it up at once;
choose themes in Settings → Appearance.

\`\`\`json
{
  "name": "My Dark",
  "type": "dark",
  "extends": "dark",
  "colors": { "c-blue": "#FF8A5B", "bg-app": "#101114" },
  "fonts": { "ui": "Inter, sans-serif", "mono": "'JetBrains Mono', monospace", "load": ["Inter", "JetBrains Mono"] },
  "effects": { "scanlines": false, "glow": false }
}
\`\`\`

- **id** - the file name when left out. A theme with the id \`dark\`, \`light\` or \`retro\` replaces that built-in theme
  (and only needs the colors it changes).
- **extends** - the theme to start from; defaults to \`dark\` or \`light\` by **type**.
- **colors** - any CSS color: \`#RRGGBB\`, \`rgb()\`, \`hsl()\`, \`oklch()\`…
- **fonts.load** - Google Fonts families to load (the app is online for these only).

## Tokens

| Token | Colors |
|---|---|
${rows}
`
  try {
    if (!existsSync(path) || readFileSync(path, 'utf-8') !== text) writeFileSync(path, text, 'utf-8')
  } catch {
    // read-only: the settings page documents them too
  }
}
