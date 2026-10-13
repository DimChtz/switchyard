/** The commands run from the palette lately (newest first): listed on top, and ranked first when searching. */

const KEY = 'sy.recentCommands'
const MAX = 12

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

let recent = read()

export function recentCommands(): string[] {
  return recent
}

export function rememberCommand(id: string): void {
  recent = [id, ...recent.filter((x) => x !== id)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(recent))
  } catch {
    // (Remembered for this run only.)
  }
}

/** The recent ones first (newest first), then the rest in their own order. */
export function recentFirst<T extends { id: string }>(items: T[], recentIds: string[]): T[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]))
  const hits = items.filter((c) => rank.has(c.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...hits, ...items.filter((c) => !rank.has(c.id))]
}
