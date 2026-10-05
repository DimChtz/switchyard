import { useEffect, useSyncExternalStore } from 'react'
import { THEME_TOKENS, pickTheme, resolveThemes, type Theme } from '@shared/themes'
import type { ThemesState } from '@shared/types'

/**
 * The page's theme: its tokens as CSS variables on <html>, its fonts and
 * effects, and the window's title bar to match. Follows the preference
 * (a theme, or "system") and the themes folder as they change.
 */

let themes: ThemesState = { ...resolveThemes([]), dir: '' }
let active: Theme = themes.themes[0]
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const dark = window.matchMedia('(prefers-color-scheme: dark)')
const loadedFonts = new Set<string>()

/** Puts the theme on the page. */
export function applyTheme(t: Theme, system: boolean): void {
  const root = document.documentElement
  for (const k of Object.keys(THEME_TOKENS) as (keyof typeof THEME_TOKENS)[]) root.style.setProperty(`--${k}`, t.colors[k])
  root.style.setProperty('--font-ui', t.fonts.ui)
  root.style.setProperty('--font-mono', t.fonts.mono)
  root.style.colorScheme = t.type
  root.dataset.theme = t.id
  root.dataset.themeType = t.type
  root.classList.toggle('fx-scanlines', t.effects.scanlines)
  root.classList.toggle('fx-glow', t.effects.glow)
  // Only a theme file that asks for other fonts (fonts.load) reaches Google Fonts; the built-in ones ship with the app.
  for (const family of t.fonts.load) {
    if (loadedFonts.has(family)) continue
    loadedFonts.add(family)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600&display=swap`
    document.head.append(link)
  }
  // The window's title bar takes only plain colors: whatever the theme wrote (color-mix, oklch…) as #RRGGBB.
  window.api.themes.chrome({ type: t.type, system, background: solidColor(t.colors['bg-app']), chrome: solidColor(t.colors['bg-chrome']), symbols: solidColor(t.colors.t2) })
  const changed = active.id !== t.id || active !== t
  active = t
  if (changed) {
    emit()
    window.dispatchEvent(new CustomEvent('switchyard:theme', { detail: t }))
  }
}

/** Any CSS color as #RRGGBB (opaque: what shows through a see-through one is the page's background). */
export function solidColor(css: string): string {
  const probe = document.createElement('span')
  probe.style.color = css
  probe.style.display = 'none'
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  const hex = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  const nums = (s: string): number[] => (s.match(/-?[\d.]+(e-?\d+)?/gi) ?? []).map(Number)
  if (/^rgba?\(/.test(resolved)) {
    const [r, g, b] = nums(resolved)
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  if (/^color\(srgb /.test(resolved)) {
    const [r, g, b] = nums(resolved.slice(10))
    return `#${hex(r * 255)}${hex(g * 255)}${hex(b * 255)}`
  }
  // Other color spaces (oklch, lab…): let a canvas convert them.
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d')
  if (!ctx) return css
  ctx.fillStyle = resolved
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

let pref = 'dark'
const refresh = (): void => applyTheme(pickTheme(themes.themes, pref, dark.matches), pref === 'system')

/** Loads the themes and applies the preferred one - before the first render, so nothing flashes. */
export async function initTheme(preferred: string): Promise<void> {
  pref = preferred || 'dark'
  try {
    themes = await window.api.themes.get()
  } catch {
    // the built-ins
  }
  refresh()
  dark.addEventListener('change', () => pref === 'system' && refresh())
  window.api.themes.onChanged((s) => {
    themes = s
    emit()
    refresh()
  })
}

/** Keeps the page's theme on the preference. */
export function useThemePref(preferred: string): void {
  useEffect(() => {
    const next = preferred || 'dark'
    if (next === pref) return
    pref = next
    refresh()
  }, [preferred])
}

export function useThemes(): ThemesState {
  return useSyncExternalStore(subscribe, () => themes)
}

export function useActiveTheme(): Theme {
  return useSyncExternalStore(subscribe, () => active)
}

/** A token's current value (for what can't use CSS variables - the terminal). */
export function tokenValue(k: keyof typeof THEME_TOKENS): string {
  return active.colors[k]
}
