/**
 * Themes: every color the app draws with is a token (a CSS variable,
 * --name), and a theme gives each token a value. Three ship with the app;
 * more are JSON files in the themes folder - a new one, or one with a
 * built-in's id to change it. `extends` starts from another theme, so a
 * theme only needs the tokens it changes.
 */

export type ThemeType = 'dark' | 'light'

/** A theme as written in its file. */
export interface ThemeFile {
  /** Its id; the file name when left out. The id of a built-in replaces it. */
  id?: string
  name?: string
  type?: ThemeType
  /** The theme it starts from (a built-in's or another file's id). Default: "dark" or "light", by type. */
  extends?: string
  /** Token → CSS color. */
  colors?: Record<string, string>
  fonts?: { ui?: string; mono?: string; /** Google Fonts families to load, e.g. ["IBM Plex Mono"]. */ load?: string[] }
  effects?: { /** Faint CRT scan lines over the window. */ scanlines?: boolean; /** A soft glow on text. */ glow?: boolean }
}

/** A theme ready to apply: every token has a value. */
export interface Theme {
  id: string
  name: string
  type: ThemeType
  colors: Record<ThemeToken, string>
  fonts: { ui: string; mono: string; load: string[] }
  effects: { scanlines: boolean; glow: boolean }
  /** Built in, a user's own, or a user's file replacing a built-in. */
  source: 'builtin' | 'user' | 'override'
  /** The file it came from (user themes). */
  file?: string
}

/**
 * The tokens, with what each colors. Grouped as they're documented; the
 * dark theme's values are the app's original colors.
 */
export const THEME_TOKENS = {
  // Backgrounds
  'bg-app': 'Main background',
  'bg-chrome': 'Title bar, sidebar',
  'bg-panel': 'Panels and cards',
  'bg-panel-2': 'Secondary panels, code blocks',
  'bg-panel-3': 'Search fields, inset panels',
  'bg-console': 'Consoles, editors, the note editor',
  'bg-input': 'Inputs',
  'bg-sunken': 'Sunken lists (the notes list)',
  'bg-hover': 'Hovered rows and buttons',
  'bg-menu': 'Menus and popups',
  // Borders
  'bd-1': 'Dividers',
  'bd-2': 'Borders',
  'bd-3': 'Input and button borders',
  'bd-4': 'Stronger borders',
  'bd-5': 'Hovered borders',
  'bd-6': 'Checkbox outlines',
  'bd-row': 'Lines between rows',
  // Text
  t1: 'Primary text',
  't-body': 'Body text (notes)',
  t2: 'Secondary text',
  't-icon': 'Icons, toolbar glyphs',
  't-dim': 'Dimmed text',
  t3: 'Tertiary text, hints',
  t4: 'Faint text, section labels',
  t5: 'Faintest text, shortcut keys',
  't-max': 'Hovered primary buttons',
  // Accents and status
  'c-green': 'Working, success, additions',
  'c-amber': 'Needs you, warnings',
  'c-red': 'Failed, errors, deletions',
  'c-red-soft': 'Error text on tinted backgrounds',
  'c-blue': 'Accent: links, focus, selection',
  'c-blue-hover': 'Hovered links',
  'c-code': 'Inline code',
  'c-pin': 'Pins',
  'c-hit': 'Search matches',
  // Overlays - hover tints are this color at low opacity; shadows and backdrops
  ov: 'Hover tint base (white on dark themes, black on light)',
  sh: 'Shadow color',
  backdrop: 'Behind dialogs',
  // Code
  'syn-keyword': 'Code: keywords',
  'syn-string': 'Code: strings',
  'syn-number': 'Code: numbers, constants',
  'syn-comment': 'Code: comments',
  'syn-function': 'Code: function names',
  'syn-type': 'Code: types, classes',
  'syn-property': 'Code: properties, attributes',
  'syn-tag': 'Code: tags, decorators',
  // Terminal
  'term-bg': 'Terminal background',
  'term-fg': 'Terminal text',
  'term-cursor': 'Terminal cursor',
  'term-selection': 'Terminal selection',
  'ansi-black': 'Terminal black',
  'ansi-red': 'Terminal red',
  'ansi-green': 'Terminal green',
  'ansi-yellow': 'Terminal yellow',
  'ansi-blue': 'Terminal blue',
  'ansi-magenta': 'Terminal magenta',
  'ansi-cyan': 'Terminal cyan',
  'ansi-white': 'Terminal white',
  'ansi-bright-black': 'Terminal bright black',
  'ansi-bright-red': 'Terminal bright red',
  'ansi-bright-green': 'Terminal bright green',
  'ansi-bright-yellow': 'Terminal bright yellow',
  'ansi-bright-blue': 'Terminal bright blue',
  'ansi-bright-magenta': 'Terminal bright magenta',
  'ansi-bright-cyan': 'Terminal bright cyan',
  'ansi-bright-white': 'Terminal bright white'
} as const

export type ThemeToken = keyof typeof THEME_TOKENS

const DARK: Record<ThemeToken, string> = {
  'bg-app': '#0F1012',
  'bg-chrome': '#0B0C0E',
  'bg-panel': '#15161A',
  'bg-panel-2': '#131418',
  'bg-panel-3': '#121317',
  'bg-console': '#0C0D0F',
  'bg-input': '#111215',
  'bg-sunken': '#0D0E10',
  'bg-hover': '#1A1C20',
  'bg-menu': '#17181C',
  'bd-1': '#1F2126',
  'bd-2': '#23252B',
  'bd-3': '#2A2C31',
  'bd-4': '#2E3037',
  'bd-5': '#3A3C43',
  'bd-6': '#4A4D55',
  'bd-row': '#1B1D21',
  t1: '#E8E8E6',
  't-body': '#C9CBD0',
  t2: '#A4A7AE',
  't-icon': '#8A8D95',
  't-dim': '#7E818A',
  t3: '#6E717A',
  t4: '#5A5D66',
  t5: '#4E5159',
  't-max': '#FFFFFF',
  'c-green': '#6BCB8B',
  'c-amber': '#E3B25A',
  'c-red': '#E86A5F',
  'c-red-soft': '#F07F75',
  'c-blue': '#95B4E8',
  'c-blue-hover': '#C3D5F5',
  'c-code': '#E5C98F',
  'c-pin': '#C9A45F',
  'c-hit': '#F0D59E',
  ov: '#FFFFFF',
  sh: '#000000',
  backdrop: 'rgba(6,7,8,0.62)',
  'syn-keyword': '#C99BE0',
  'syn-string': '#9FCB8A',
  'syn-number': '#E0A36A',
  'syn-comment': '#5E636E',
  'syn-function': '#86B4F0',
  'syn-type': '#E5C98F',
  'syn-property': '#D8A0A6',
  'syn-tag': '#7FC4CF',
  'term-bg': '#0C0D0F',
  'term-fg': '#E8E8E6',
  'term-cursor': '#95B4E8',
  'term-selection': 'rgba(149,180,232,0.25)',
  'ansi-black': '#2E3436',
  'ansi-red': '#CC0000',
  'ansi-green': '#4E9A06',
  'ansi-yellow': '#C4A000',
  'ansi-blue': '#3465A4',
  'ansi-magenta': '#75507B',
  'ansi-cyan': '#06989A',
  'ansi-white': '#D3D7CF',
  'ansi-bright-black': '#555753',
  'ansi-bright-red': '#EF2929',
  'ansi-bright-green': '#8AE234',
  'ansi-bright-yellow': '#FCE94F',
  'ansi-bright-blue': '#729FCF',
  'ansi-bright-magenta': '#AD7FA8',
  'ansi-bright-cyan': '#34E2E2',
  'ansi-bright-white': '#EEEEEC'
}

const LIGHT: Record<ThemeToken, string> = {
  'bg-app': '#F7F7F5',
  'bg-chrome': '#EEEEEB',
  'bg-panel': '#FFFFFF',
  'bg-panel-2': '#F2F2EF',
  'bg-panel-3': '#FFFFFF',
  'bg-console': '#FCFCFB',
  'bg-input': '#FFFFFF',
  'bg-sunken': '#F3F3F0',
  'bg-hover': '#EAEAE6',
  'bg-menu': '#FFFFFF',
  'bd-1': '#E3E3DF',
  'bd-2': '#DCDCD7',
  'bd-3': '#D2D2CC',
  'bd-4': '#C8C8C2',
  'bd-5': '#B4B4AE',
  'bd-6': '#9C9C96',
  'bd-row': '#EBEBE7',
  t1: '#1B1C1F',
  't-body': '#2F3136',
  t2: '#4B4E55',
  't-icon': '#5C5F66',
  't-dim': '#686B72',
  t3: '#777A81',
  t4: '#8E9197',
  t5: '#A4A6AB',
  't-max': '#000000',
  'c-green': '#2A8F50',
  'c-amber': '#B07212',
  'c-red': '#CF3F33',
  'c-red-soft': '#B8352A',
  'c-blue': '#3565C8',
  'c-blue-hover': '#244C9E',
  'c-code': '#8A4F0E',
  'c-pin': '#B07212',
  'c-hit': '#6B4300',
  ov: '#000000',
  sh: 'rgba(0,0,0,0.3)',
  backdrop: 'rgba(40,40,44,0.28)',
  'syn-keyword': '#A626A4',
  'syn-string': '#4F9A48',
  'syn-number': '#986801',
  'syn-comment': '#9EA0A6',
  'syn-function': '#3F6FDB',
  'syn-type': '#B07A00',
  'syn-property': '#C8473C',
  'syn-tag': '#0A7FA8',
  'term-bg': '#FCFCFB',
  'term-fg': '#1B1C1F',
  'term-cursor': '#3565C8',
  'term-selection': 'rgba(53,101,200,0.2)',
  'ansi-black': '#1B1C1F',
  'ansi-red': '#C8372D',
  'ansi-green': '#2F8A3B',
  'ansi-yellow': '#9A6A00',
  'ansi-blue': '#2F5FC4',
  'ansi-magenta': '#9A3AA8',
  'ansi-cyan': '#0F7F8C',
  'ansi-white': '#6E7178',
  'ansi-bright-black': '#5A5D64',
  'ansi-bright-red': '#E0463B',
  'ansi-bright-green': '#3AA34A',
  'ansi-bright-yellow': '#B88400',
  'ansi-bright-blue': '#4A78DE',
  'ansi-bright-magenta': '#B24DC0',
  'ansi-bright-cyan': '#1797A6',
  'ansi-bright-white': '#8A8D93'
}

/** Green phosphor on black, amber for what needs you - an old terminal. */
const RETRO: Partial<Record<ThemeToken, string>> = {
  'bg-app': '#050A06',
  'bg-chrome': '#030704',
  'bg-panel': '#0A140C',
  'bg-panel-2': '#08110A',
  'bg-panel-3': '#07100A',
  'bg-console': '#040805',
  'bg-input': '#07100A',
  'bg-sunken': '#040906',
  'bg-hover': '#0F2014',
  'bg-menu': '#0A160D',
  'bd-1': '#12301A',
  'bd-2': '#163A20',
  'bd-3': '#1C4828',
  'bd-4': '#215430',
  'bd-5': '#2C6E3E',
  'bd-6': '#3A8A50',
  'bd-row': '#0F2616',
  t1: '#9CFFB0',
  't-body': '#86E89A',
  t2: '#6CCB82',
  't-icon': '#5DB272',
  't-dim': '#529E65',
  t3: '#468A57',
  t4: '#3A744A',
  t5: '#30603D',
  't-max': '#D6FFDF',
  'c-green': '#5CFF7A',
  'c-amber': '#FFB000',
  'c-red': '#FF5F56',
  'c-red-soft': '#FF7A70',
  'c-blue': '#FFB000',
  'c-blue-hover': '#FFCB4D',
  'c-code': '#FFD27A',
  'c-pin': '#FFB000',
  'c-hit': '#FFE3A3',
  ov: '#5CFF7A',
  sh: '#000000',
  backdrop: 'rgba(0,8,2,0.7)',
  'syn-keyword': '#FFB000',
  'syn-string': '#B6FF9E',
  'syn-number': '#FFD27A',
  'syn-comment': '#3A744A',
  'syn-function': '#9CFFB0',
  'syn-type': '#FFCB4D',
  'syn-property': '#7CE0A0',
  'syn-tag': '#5CFFD0',
  'term-bg': '#040805',
  'term-fg': '#9CFFB0',
  'term-cursor': '#5CFF7A',
  'term-selection': 'rgba(92,255,122,0.25)',
  'ansi-black': '#0A140C',
  'ansi-red': '#FF5F56',
  'ansi-green': '#5CFF7A',
  'ansi-yellow': '#FFB000',
  'ansi-blue': '#5CC8FF',
  'ansi-magenta': '#D98CFF',
  'ansi-cyan': '#5CFFD0',
  'ansi-white': '#9CFFB0',
  'ansi-bright-black': '#3A744A',
  'ansi-bright-red': '#FF8A80',
  'ansi-bright-green': '#9CFFB0',
  'ansi-bright-yellow': '#FFCB4D',
  'ansi-bright-blue': '#8AD8FF',
  'ansi-bright-magenta': '#E6B0FF',
  'ansi-bright-cyan': '#9CFFE6',
  'ansi-bright-white': '#D6FFDF'
}

// Geist ships with the app (as the Variable families); themes may load others.
const UI_FONT = "'Geist Variable', Geist, system-ui, sans-serif"
const MONO_FONT = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace"

export const BUILTIN_THEMES: ThemeFile[] = [
  { id: 'dark', name: 'Dark', type: 'dark', colors: DARK },
  { id: 'light', name: 'Light', type: 'light', colors: LIGHT },
  {
    id: 'retro',
    name: 'Retro',
    type: 'dark',
    extends: 'dark',
    colors: RETRO,
    // IBM Plex Mono ships with the app too.
    fonts: { ui: "'IBM Plex Mono', 'Geist Mono Variable', ui-monospace, monospace", mono: "'IBM Plex Mono', 'Geist Mono Variable', ui-monospace, monospace", load: [] },
    effects: { scanlines: true, glow: true }
  }
]

export const DEFAULT_THEME = 'dark'

/** A theme file read from the themes folder: its contents, or why it couldn't be used. */
export interface UserThemeFile {
  file: string
  /** The file name without .json: the id when the file gives none. */
  name: string
  data?: unknown
  error?: string
}

/** Whether a value is safe to put in a CSS variable (no ";", "{" or url() - just a color). */
function isColor(v: unknown): v is string {
  return typeof v === 'string' && v.length < 80 && !/[;{}<>]|url\s*\(|expression\s*\(/i.test(v) && /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\(.*\)|[a-z]+)$/i.test(v.trim())
}

function isFont(v: unknown): v is string {
  return typeof v === 'string' && v.length < 200 && !/[;{}<>]|url\s*\(/i.test(v)
}

/**
 * All themes: the built-ins, then the user's files over them. A file with
 * a built-in's id replaces it. What's wrong in a file is reported (the
 * file is skipped, or just its bad values).
 */
export function resolveThemes(files: UserThemeFile[]): { themes: Theme[]; problems: string[] } {
  const problems: string[] = []
  const raw = new Map<string, { data: ThemeFile; source: Theme['source']; file?: string }>()
  for (const b of BUILTIN_THEMES) raw.set(b.id!, { data: b, source: 'builtin' })
  for (const f of files) {
    if (f.error) {
      problems.push(`${f.file}: ${f.error}`)
      continue
    }
    const d = f.data
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      problems.push(`${f.file}: not a theme (expected an object with "colors")`)
      continue
    }
    const data = d as ThemeFile
    const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : f.name
    const builtin = BUILTIN_THEMES.some((b) => b.id === id)
    raw.set(id, { data: { ...data, id }, source: builtin ? 'override' : 'user', file: f.file })
  }

  const done = new Map<string, Theme>()
  const resolving = new Set<string>()
  const resolve = (id: string): Theme | null => {
    const hit = done.get(id)
    if (hit) return hit
    const r = raw.get(id)
    if (!r) return null
    if (r.source === 'builtin') return fromBuiltin(id)
    if (resolving.has(id)) {
      problems.push(`${r.file ?? id}: "extends" goes round in a circle`)
      return null
    }
    resolving.add(id)
    const d = r.data
    const where = r.file ?? id
    const type: ThemeType = d.type === 'light' || d.type === 'dark' ? d.type : 'dark'
    if (d.type !== undefined && d.type !== 'light' && d.type !== 'dark') problems.push(`${where}: "type" must be "dark" or "light"`)
    // A built-in replaced by a file starts from the original (so the file can hold just changes).
    let base: Theme | null = null
    const parent = typeof d.extends === 'string' ? d.extends : r.source === 'override' ? null : type
    if (r.source === 'override') base = fromBuiltin(id)
    else if (parent && parent !== id) {
      base = resolve(parent)
      if (!base) problems.push(`${where}: "extends" names a theme that isn't there (${parent})`)
    }
    if (!base) base = fromBuiltin(type)
    const colors = { ...(base?.colors ?? DARK) } as Record<ThemeToken, string>
    for (const [k, v] of Object.entries(d.colors ?? {})) {
      if (!(k in THEME_TOKENS)) problems.push(`${where}: unknown color "${k}"`)
      else if (!isColor(v)) problems.push(`${where}: "${k}" isn't a color (${String(v).slice(0, 40)})`)
      else colors[k as ThemeToken] = v.trim()
    }
    const fonts = { ...(base?.fonts ?? { ui: UI_FONT, mono: MONO_FONT, load: [] }) }
    for (const k of ['ui', 'mono'] as const) {
      const v = d.fonts?.[k]
      if (v === undefined) continue
      if (isFont(v)) fonts[k] = v
      else problems.push(`${where}: fonts.${k} isn't a font list`)
    }
    if (Array.isArray(d.fonts?.load)) fonts.load = d.fonts.load.filter((x): x is string => typeof x === 'string' && /^[\w -]{1,60}$/.test(x))
    const effects = { scanlines: !!(d.effects?.scanlines ?? base?.effects.scanlines), glow: !!(d.effects?.glow ?? base?.effects.glow) }
    const theme: Theme = {
      id,
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : (base && r.source === 'override' ? base.name : id),
      type: d.type === undefined && base ? base.type : type,
      colors,
      fonts,
      effects,
      source: r.source,
      ...(r.file ? { file: r.file } : {})
    }
    resolving.delete(id)
    done.set(id, theme)
    return theme
  }

  const fromBuiltin = (id: string): Theme | null => {
    const b = BUILTIN_THEMES.find((x) => x.id === id)
    if (!b) return null
    const key = `builtin:${id}`
    const hit = done.get(key)
    if (hit) return hit
    const parent = b.extends && b.extends !== id ? fromBuiltin(b.extends) : null
    const t: Theme = {
      id,
      name: b.name ?? id,
      type: b.type ?? 'dark',
      colors: { ...(parent?.colors ?? DARK), ...(b.colors as Record<ThemeToken, string>) },
      fonts: { ui: b.fonts?.ui ?? UI_FONT, mono: b.fonts?.mono ?? MONO_FONT, load: b.fonts?.load ?? [] },
      effects: { scanlines: !!b.effects?.scanlines, glow: !!b.effects?.glow },
      source: 'builtin'
    }
    done.set(key, t)
    return t
  }

  const themes: Theme[] = []
  for (const id of raw.keys()) {
    const t = raw.get(id)!.source === 'builtin' ? fromBuiltin(id) : resolve(id)
    if (t) themes.push(t)
  }
  return { themes, problems }
}

/** The theme to show for a preference ("system": light or dark, as the OS is). */
export function pickTheme(themes: Theme[], pref: string, systemDark: boolean): Theme {
  const id = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
  return themes.find((t) => t.id === id) ?? themes.find((t) => t.id === DEFAULT_THEME) ?? themes[0]
}

/** A theme as a file to start a custom one from: every value spelled out. */
export function themeToFile(t: Theme, id: string, name: string): ThemeFile {
  return { id, name, type: t.type, colors: { ...t.colors }, fonts: { ...t.fonts }, effects: { ...t.effects } }
}
