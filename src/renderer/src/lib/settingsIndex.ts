/**
 * The settings, for the command palette: every row of the preference pages
 * (read off the pages themselves, rendered once out of sight), and a way to
 * open Settings on one of them - scrolled to and lit up - or on a search.
 */

export interface SettingEntry {
  /** The page ("terminal"), and its name ("Terminal & editor"). */
  section: string
  page: string
  group: string
  label: string
  sub: string
}

let index: SettingEntry[] | null = null
const listeners = new Set<() => void>()

export const settingsIndex = (): SettingEntry[] | null => index
export function setSettingsIndex(entries: SettingEntry[]): void {
  index = entries
  for (const l of listeners) l()
}
export function onSettingsIndex(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * The settings every word typed is in - by the row's name, its group and page
 * first, then by what its description says. At most `limit`.
 */
export function matchSettings(entries: SettingEntry[], query: string, limit = 8): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const has = (t: string): boolean => {
    const s = t.toLowerCase()
    return words.every((w) => s.includes(w))
  }
  const named = entries.filter((e) => has(`${e.page} ${e.group} ${e.label}`))
  const described = entries.filter((e) => !named.includes(e) && has(`${e.page} ${e.group} ${e.label} ${e.sub}`))
  // (The row's own name before its group's or page's.)
  const own = (e: SettingEntry): number => (has(e.label) ? 0 : 1)
  return [...named.sort((a, b) => own(a) - own(b)), ...described].slice(0, limit)
}

/** What Settings should show once it's open: a row, or a search. */
export type Reveal = { label: string } | { query: string }
let pending: { r: Reveal; at: number } | null = null
const revealers = new Set<(r: Reveal) => void>()

export function revealSetting(r: Reveal): void {
  if (revealers.size) for (const f of revealers) f(r)
  else pending = { r, at: Date.now() }
}
/** Settings, when it opens, takes what was asked just before it was there. */
export function takeReveal(): Reveal | null {
  const p = pending
  pending = null
  return p && Date.now() - p.at < 3000 ? p.r : null
}
export function onReveal(f: (r: Reveal) => void): () => void {
  revealers.add(f)
  return () => revealers.delete(f)
}
